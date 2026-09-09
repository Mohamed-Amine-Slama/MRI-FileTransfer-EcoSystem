import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createPatient,
  createStudy,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { InMemoryOrthancClient } from './internal/orthanc.client';
import { TwinService } from './internal/twin.service';

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
