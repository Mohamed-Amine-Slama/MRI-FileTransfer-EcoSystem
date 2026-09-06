import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createAppointment,
  createPatient,
  createStudy,
  createUser,
  grantConsent,
  linkStudy,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { EventBus } from '../../shared/events/event-bus';
// Public API only — reaching into modules/audit/internal/ would fail the P1.4
// boundary check, and rightly so.
import { AuditService, AuditSubscriber } from '../audit';
import { SignedUrlService } from '../../shared/storage/signed-url.service';
import { StudyAccessService } from './internal/study-access.service';

/**
 * BUILD_SPEC P8.2 — DICOMweb access through the API.
 *
 * Gate: "No path exists from the browser to Orthanc that bypasses the API."
 * The three verifications are:
 *   - unlinked study -> 404, AND an audit row records the denied attempt
 *   - a signed URL still works at 4 minutes and is rejected at 20
 *   - the frontend bundle contains no Orthanc credentials
 *
 * The third is a separate check (scripts/check-bundle-secrets.mjs) because it
 * inspects build output rather than runtime behaviour.
 */

let h: Harness;
let db: DatabaseService;
let bus: EventBus;
let access: StudyAccessService;

/** Controllable clock so URL expiry is tested without waiting 20 minutes. */
let now = Date.UTC(2026, 0, 1, 12, 0, 0);
const clock = (): number => now;

const SECRET = 'test-signing-key-at-least-32-characters-long';

const signedUrls = (): SignedUrlService =>
  new SignedUrlService(
    { SIGNED_URL_TTL_SECONDS: 600, SIGNED_URL_SECRET: SECRET } as AppConfig,
    clock,
  );

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  triageBeforePayment: false,
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'p8-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);
  bus = new EventBus();
  // Wire the real audit subscriber: the gate is that access produces an audit
  // row, so stubbing the subscriber would test nothing.
  new AuditSubscriber(bus, new AuditService(db)).onModuleInit();
  access = new StudyAccessService(db, bus, signedUrls());
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
  now = Date.UTC(2026, 0, 1, 12, 0, 0);
});

async function scenario(opts: { withConsent: boolean; status?: 'confirmed' | 'pending' }) {
  const libyaDoctor = await createUser(h.owner, 'libya_doctor');
  const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
  const patient = await createPatient(h.owner, libyaDoctor);
  const studyId = await createStudy(h.owner, patient, libyaDoctor);
  const appt = await createAppointment(h.owner, patient, tunisDoctor, opts.status ?? 'confirmed');
  await linkStudy(h.owner, appt, studyId);
  if (opts.withConsent) await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

  const uid = await h.owner.query<{ study_instance_uid: string }>(
    'SELECT study_instance_uid FROM imaging_studies WHERE id = $1',
    [studyId],
  );
  return {
    libyaDoctor,
    tunisDoctor,
    patient,
    studyId,
    studyUid: uid.rows[0]?.study_instance_uid as string,
  };
}

describe('P8.2 study access authorization', () => {
  it('grants access to a linked, consented study and audits it', async () => {
    const s = await scenario({ withConsent: true });

    const result = await runWithContext(ctx(s.tunisDoctor, 'tunisia_doctor'), () =>
      access.authoriseStudyAccess(s.studyUid, 'metadata'),
    );

    expect(result.studyId).toBe(s.studyId);

    const audit = await h.owner.query<{
      action: string;
      actor_id: string;
      subject_id: string;
      metadata: { granted: boolean; accessKind: string };
    }>('SELECT action, actor_id, subject_id, metadata FROM audit_events');

    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.action).toBe('StudyAccessed');
    expect(audit.rows[0]?.actor_id).toBe(s.tunisDoctor);
    expect(audit.rows[0]?.subject_id).toBe(s.studyId);
    expect(audit.rows[0]?.metadata.granted).toBe(true);
  });

  it('refuses an unlinked study with 404 AND records the denied attempt (the gate)', async () => {
    // Appointment exists but NO consent — the study must be invisible.
    const s = await scenario({ withConsent: false });

    await expect(
      runWithContext(ctx(s.tunisDoctor, 'tunisia_doctor'), () =>
        access.authoriseStudyAccess(s.studyUid, 'pixel_data'),
      ),
    ).rejects.toThrow(/not found/i);

    const audit = await h.owner.query<{
      action: string;
      actor_id: string;
      metadata: { granted: boolean };
    }>('SELECT action, actor_id, metadata FROM audit_events');

    // The refusal is on the record. Without this, the reconnaissance phase of
    // an account compromise leaves no trace.
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.action).toBe('StudyAccessed');
    expect(audit.rows[0]?.actor_id).toBe(s.tunisDoctor);
    expect(audit.rows[0]?.metadata.granted).toBe(false);
  });

  it('refuses a study belonging to a completely unrelated doctor', async () => {
    const s = await scenario({ withConsent: true });
    const stranger = await createUser(h.owner, 'tunisia_doctor');

    await expect(
      runWithContext(ctx(stranger, 'tunisia_doctor'), () =>
        access.authoriseStudyAccess(s.studyUid, 'metadata'),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('applies the D3 triage gate — an unanswered referral is refused by default', async () => {
    const s = await scenario({ withConsent: true, status: 'pending' });

    await expect(
      runWithContext(ctx(s.tunisDoctor, 'tunisia_doctor'), () =>
        access.authoriseStudyAccess(s.studyUid, 'pixel_data'),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('records one audit row per access, not one per session', async () => {
    // Every read is a separate disclosure and must be separately recorded.
    const s = await scenario({ withConsent: true });

    await runWithContext(ctx(s.tunisDoctor, 'tunisia_doctor'), async () => {
      await access.authoriseStudyAccess(s.studyUid, 'metadata');
      await access.authoriseStudyAccess(s.studyUid, 'pixel_data');
      await access.authoriseStudyAccess(s.studyUid, 'thumbnail');
    });

    const audit = await h.owner.query<{ metadata: { accessKind: string } }>(
      'SELECT metadata FROM audit_events ORDER BY occurred_at',
    );
    expect(audit.rowCount).toBe(3);
    expect(audit.rows.map((r) => r.metadata.accessKind)).toEqual([
      'metadata',
      'pixel_data',
      'thumbnail',
    ]);
  });
});

describe('P8.2 signed URLs', () => {
  it('works at 4 minutes and is rejected at 20 (the spec gate, verbatim)', async () => {
    const s = await scenario({ withConsent: true });
    const svc = signedUrls();

    const { token } = await runWithContext(ctx(s.tunisDoctor, 'tunisia_doctor'), async () => {
      const issued = svc.sign(`/dicom-web/studies/${s.studyUid}`, s.tunisDoctor);
      return issued;
    });

    // t + 4 minutes -> still valid
    now += 4 * 60_000;
    expect(svc.verify(token, s.tunisDoctor).valid).toBe(true);

    // t + 20 minutes -> expired (TTL is 10 minutes)
    now += 16 * 60_000;
    const late = svc.verify(token, s.tunisDoctor);
    expect(late.valid).toBe(false);
    if (!late.valid) expect(late.reason).toBe('expired');
  });

  it('is bound to the subject — a leaked URL is useless to another account', async () => {
    const svc = signedUrls();
    const { token } = svc.sign('/dicom-web/studies/1.2.3', 'doctor-a');

    expect(svc.verify(token, 'doctor-a').valid).toBe(true);

    const stolen = svc.verify(token, 'doctor-b');
    expect(stolen.valid).toBe(false);
    if (!stolen.valid) expect(stolen.reason).toBe('wrong_subject');
  });

  it('rejects a tampered payload', async () => {
    const svc = signedUrls();
    const { token } = svc.sign('/dicom-web/studies/1.2.3', 'doctor-a');
    const [payload, sig] = token.split('.');

    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
      resource: string;
      userId: string;
      expiresAt: number;
    };
    // Extend the expiry by a year and keep the original signature.
    claims.expiresAt += 365 * 24 * 3600;
    const forged = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');

    const result = svc.verify(`${forged}.${sig}`, 'doctor-a');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad_signature');
  });

  it('rejects a URL signed with a different key', async () => {
    const a = signedUrls();
    const b = new SignedUrlService(
      { SIGNED_URL_TTL_SECONDS: 600, SIGNED_URL_SECRET: 'a-completely-different-32-char-key!!' } as AppConfig,
      clock,
    );

    const { token } = a.sign('/dicom-web/studies/1.2.3', 'doctor-a');
    expect(b.verify(token, 'doctor-a').valid).toBe(false);
  });

  it('refuses to issue a URL whose TTL is outside the 5-15 minute window', async () => {
    // A deployment must not be able to widen the window, even if the config
    // check were somehow bypassed.
    const tooLong = new SignedUrlService(
      { SIGNED_URL_TTL_SECONDS: 86_400, SIGNED_URL_SECRET: SECRET } as AppConfig,
      clock,
    );
    expect(() => tooLong.sign('/x', 'u')).toThrow(/P8\.2/);
  });

  it('does not issue a URL to a caller who is not authorised for the study', async () => {
    const s = await scenario({ withConsent: false });

    await expect(
      runWithContext(ctx(s.tunisDoctor, 'tunisia_doctor'), () =>
        access.issueInstanceUrl(s.studyUid, '1.2.3.4'),
      ),
    ).rejects.toThrow(/not found/i);

    // And the refusal is audited, same as any other denied access.
    const audit = await h.owner.query<{ metadata: { granted: boolean } }>(
      'SELECT metadata FROM audit_events',
    );
    expect(audit.rows[0]?.metadata.granted).toBe(false);
  });

  it('issues a working URL to an authorised caller', async () => {
    const s = await scenario({ withConsent: true });

    const { url, expiresAt } = await runWithContext(ctx(s.tunisDoctor, 'tunisia_doctor'), () =>
      access.issueInstanceUrl(s.studyUid, '1.2.3.4'),
    );

    expect(url).toContain(`/dicom-web/studies/${s.studyUid}/instances/1.2.3.4`);
    expect(url).toContain('token=');
    // 10-minute TTL, inside the required 5-15 minute band.
    expect(expiresAt - Math.floor(now / 1000)).toBe(600);
  });
});
