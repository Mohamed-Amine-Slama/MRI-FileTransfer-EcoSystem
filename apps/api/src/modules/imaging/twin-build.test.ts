import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createCase,
  createPatient,
  createStudy,
  createUser,
  linkStudy,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { InMemoryOrthancClient } from './internal/orthanc.client';
import { TwinService, reapTwins } from './internal/twin.service';

let h: Harness;
let db: DatabaseService;
let orthanc: InMemoryOrthancClient;
let twins: TwinService;

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 10 } as AppConfig);
  orthanc = new InMemoryOrthancClient();
  twins = new TwinService(db, orthanc);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
  orthanc = new InMemoryOrthancClient();
  twins = new TwinService(db, orthanc);
});

/**
 * A study as ingest leaves it: uploaded, complete, awaiting its twin.
 *
 * The uploader is also the patient's creator, which is not a convenience of the
 * fixture — `studies_uploader_insert` requires it, which is why the twin job
 * can run under the uploader's own identity rather than a privileged one.
 */
async function pendingStudy(
  overrides: { status?: string; dateOfBirth?: string; sex?: 'M' | 'F' | 'O' } = {},
): Promise<{ studyId: string; actorId: string }> {
  const doctor = await createUser(h.owner, 'libya_doctor');
  const patient = await createPatient(h.owner, doctor, {
    ...(overrides.dateOfBirth === undefined ? {} : { dateOfBirth: overrides.dateOfBirth }),
    ...(overrides.sex === undefined ? {} : { sex: overrides.sex }),
  });
  const studyId = await createStudy(h.owner, patient, doctor, {
    status: overrides.status ?? 'processing',
    twinStudyUid: '',
  });
  // createStudy defaults to a released study with a twin; this one has neither.
  await h.owner.query(
    `UPDATE imaging_studies SET twin_study_uid = NULL, study_date = DATE '2025-01-14' WHERE id = $1`,
    [studyId],
  );
  return { studyId, actorId: doctor };
}

async function studyRow(id: string): Promise<{
  status: string;
  twin_study_uid: string | null;
  twin_orthanc_id: string | null;
}> {
  const res = await h.owner.query<{
    status: string;
    twin_study_uid: string | null;
    twin_orthanc_id: string | null;
  }>('SELECT status, twin_study_uid, twin_orthanc_id FROM imaging_studies WHERE id = $1', [id]);
  const row = res.rows[0];
  if (row === undefined) throw new Error('study vanished');
  return row;
}

describe('TwinService.build', () => {
  it('anonymises the study and releases it', async () => {
    const { studyId, actorId } = await pendingStudy();

    await twins.build({ studyId, actorId });

    const row = await studyRow(studyId);
    expect(row.status).toBe('ready');
    expect(row.twin_study_uid).not.toBeNull();
    expect(row.twin_orthanc_id).not.toBeNull();
    expect(orthanc.anonymised).toHaveLength(1);
  });

  it('sends the age at the time of the scan, and the sex', async () => {
    // Born 1980, scanned 2025-01-14 — 45 at the time of the study, which is
    // what PatientAge means in DICOM. Not the age today.
    const { studyId, actorId } = await pendingStudy({ dateOfBirth: '1980-06-15', sex: 'F' });

    await twins.build({ studyId, actorId });

    expect(orthanc.lastRequest).toMatchObject({
      Replace: { PatientAge: '044Y' },
      KeepPrivateTags: false,
    });
    expect((orthanc.lastRequest as { Keep: string[] }).Keep).toContain('PatientSex');
  });

  it('caps the age it sends at 90', async () => {
    const { studyId, actorId } = await pendingStudy({ dateOfBirth: '1900-01-01' });
    await twins.build({ studyId, actorId });
    expect(orthanc.lastRequest).toMatchObject({ Replace: { PatientAge: '090Y' } });
  });

  it('builds no twin for a quarantined study and leaves it quarantined', async () => {
    const { studyId, actorId } = await pendingStudy({ status: 'quarantined' });

    await twins.build({ studyId, actorId });

    const row = await studyRow(studyId);
    expect(row.status).toBe('quarantined');
    expect(row.twin_study_uid).toBeNull();
    expect(orthanc.anonymised).toHaveLength(0);
  });

  it('is idempotent — a redelivered job does not build a second twin', async () => {
    const { studyId, actorId } = await pendingStudy();

    await twins.build({ studyId, actorId });
    const first = await studyRow(studyId);
    await twins.build({ studyId, actorId });
    const second = await studyRow(studyId);

    expect(orthanc.anonymised).toHaveLength(1);
    expect(second.twin_study_uid).toBe(first.twin_study_uid);
  });

  it('refuses to release a study Orthanc only partly anonymised', async () => {
    // Some slices still carry the patient. That is worse than no twin: the
    // doctor would open a study believing it de-identified.
    const { studyId, actorId } = await pendingStudy();
    orthanc.failedInstances = 2;

    await expect(twins.build({ studyId, actorId })).rejects.toThrow(/failed to anonymise/i);

    const row = await studyRow(studyId);
    expect(row.status).toBe('processing');
    expect(row.twin_study_uid).toBeNull();
  });

  it('leaves the study unreleased when Orthanc does not know the uid', async () => {
    const { studyId, actorId } = await pendingStudy();
    const res = await h.owner.query<{ study_instance_uid: string }>(
      'SELECT study_instance_uid FROM imaging_studies WHERE id = $1',
      [studyId],
    );
    orthanc.missingStudies.add(res.rows[0]?.study_instance_uid ?? '');

    await expect(twins.build({ studyId, actorId })).rejects.toThrow(/not in orthanc/i);
    expect((await studyRow(studyId)).status).toBe('processing');
  });
});

describe('reapTwins', () => {
  /** A study with a twin, linked to one case in the given state. */
  async function twinnedCase(opts: {
    terminalDaysAgo: number | null;
  }): Promise<{ studyId: string; caseId: string }> {
    const lab = await createUser(h.owner, 'libya_doctor');
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, lab);
    const studyId = await createStudy(h.owner, patient, lab);
    await h.owner.query(`UPDATE imaging_studies SET twin_orthanc_id = $2 WHERE id = $1`, [
      studyId,
      `twin-orthanc-${studyId}`,
    ]);
    const caseId = await createCase(h.owner, patient, doctor, 'closed');
    await linkStudy(h.owner, caseId, studyId);
    await h.owner.query(
      `UPDATE cases_cases SET terminal_at = CASE WHEN $2::int IS NULL THEN NULL
                                            ELSE now() - ($2 || ' days')::interval END
       WHERE id = $1`,
      [caseId, opts.terminalDaysAgo],
    );
    return { studyId, caseId };
  }

  const twinOf = async (studyId: string): Promise<string | null> => {
    const res = await h.owner.query<{ twin_orthanc_id: string | null }>(
      'SELECT twin_orthanc_id FROM imaging_studies WHERE id = $1',
      [studyId],
    );
    return res.rows[0]?.twin_orthanc_id ?? null;
  };

  it('reaps a twin whose case closed beyond the window, and keeps a recent one', async () => {
    const old = await twinnedCase({ terminalDaysAgo: 120 });
    const recent = await twinnedCase({ terminalDaysAgo: 10 });

    expect(await reapTwins(db, orthanc, 90)).toBe(1);

    expect(await twinOf(old.studyId)).toBeNull();
    expect(await twinOf(recent.studyId)).not.toBeNull();
    expect(orthanc.deleted).toEqual([`twin-orthanc-${old.studyId}`]);
  });

  it('never reaps a twin whose case is still live, however old the case is', async () => {
    // terminal_at NULL means the case has not finished. A case open for a year
    // is still a case, and its doctor still needs to open the study.
    const live = await twinnedCase({ terminalDaysAgo: null });
    await h.owner.query(`UPDATE cases_cases SET status = 'accepted' WHERE id = $1`, [live.caseId]);

    expect(await reapTwins(db, orthanc, 90)).toBe(0);
    expect(await twinOf(live.studyId)).not.toBeNull();
  });

  it('keeps a twin while ANY linked case is unfinished', async () => {
    const first = await twinnedCase({ terminalDaysAgo: 200 });
    // The same study referred a second time; that case is still running.
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const res = await h.owner.query<{ patient_id: string }>(
      'SELECT patient_id FROM imaging_studies WHERE id = $1',
      [first.studyId],
    );
    const second = await createCase(
      h.owner,
      res.rows[0]?.patient_id as string,
      doctor,
      'accepted',
    );
    await linkStudy(h.owner, second, first.studyId);

    expect(await reapTwins(db, orthanc, 90)).toBe(0);
    expect(await twinOf(first.studyId)).not.toBeNull();
  });

  it('leaves a study that was never referred to anyone', async () => {
    // No case ever ended, so the window never started. It costs storage and
    // loses nothing; deleting on a guess is the failure that matters.
    const lab = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, lab);
    const studyId = await createStudy(h.owner, patient, lab);
    await h.owner.query(`UPDATE imaging_studies SET twin_orthanc_id = 'orphan' WHERE id = $1`, [
      studyId,
    ]);

    expect(await reapTwins(db, orthanc, 90)).toBe(0);
    expect(await twinOf(studyId)).toBe('orphan');
  });
});
