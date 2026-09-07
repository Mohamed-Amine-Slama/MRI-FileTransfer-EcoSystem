import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
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
import { EventBus } from '../../shared/events/event-bus';
import type { DomainEvent, DomainEventType } from '../../shared/events/domain-events';
import { AuditService, scrub } from './internal/audit.service';
import { AUDITED_EVENTS, AuditSubscriber } from './internal/audit.subscriber';

/**
 * BUILD_SPEC P4.4 — the audit module.
 *
 * Gate: "Access produces an immutable record that survives an attempt to
 * tamper with it."
 */

let h: Harness;
let db: DatabaseService;
let audit: AuditService;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  ipAddress: '41.208.1.5',
  userAgent: 'Mozilla/5.0 (test)',
  requestId: 'req-audit-test',
});

const baseEvent = (actorId: string, role: string) => ({
  actorId,
  actorRole: role,
  occurredAt: new Date(),
  requestId: 'req-audit-test',
  ipAddress: '41.208.1.5',
  userAgent: 'Mozilla/5.0 (test)',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);
  audit = new AuditService(db);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

describe('P4.4 audit module', () => {
  it('records exactly one StudyAccessed row with the correct actor and subject', async () => {
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, libyaDoctor);
    const study = await createStudy(h.owner, patient, libyaDoctor);

    const event: DomainEvent = {
      ...baseEvent(doctor, 'tunisia_doctor'),
      type: 'StudyAccessed',
      studyId: study,
      studyInstanceUid: '1.3.6.1.4.1.99999.1.1',
      patientId: patient,
      accessKind: 'pixel_data',
      granted: true,
    };

    await runWithContext(ctx(doctor, 'tunisia_doctor'), async () => {
      await audit.recordEvent(event);
    });

    const rows = await h.owner.query<{
      actor_id: string;
      actor_role: string;
      action: string;
      subject_type: string;
      subject_id: string;
      patient_id: string;
      ip_address: string;
      user_agent: string;
      metadata: Record<string, unknown>;
    }>('SELECT * FROM audit_events');

    expect(rows.rowCount).toBe(1);
    const row = rows.rows[0];
    expect(row?.actor_id).toBe(doctor);
    expect(row?.actor_role).toBe('tunisia_doctor');
    expect(row?.action).toBe('StudyAccessed');
    expect(row?.subject_type).toBe('study');
    expect(row?.subject_id).toBe(study);
    expect(row?.patient_id).toBe(patient);
    expect(row?.ip_address).toBe('41.208.1.5');
    expect(row?.user_agent).toBe('Mozilla/5.0 (test)');
    expect(row?.metadata).toMatchObject({ accessKind: 'pixel_data', granted: true });
  });

  it('records DENIED access attempts too', async () => {
    // A refused attempt is the more interesting security signal of the two —
    // it is what an account compromise looks like early on (P8.2, P4.5).
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, libyaDoctor);
    const study = await createStudy(h.owner, patient, libyaDoctor);

    await runWithContext(ctx(doctor, 'tunisia_doctor'), async () => {
      await audit.recordEvent({
        ...baseEvent(doctor, 'tunisia_doctor'),
        type: 'StudyAccessed',
        studyId: study,
        studyInstanceUid: '1.3.6.1.4.1.99999.1.1',
        patientId: patient,
        accessKind: 'metadata',
        granted: false,
      });
    });

    const rows = await h.owner.query<{ metadata: { granted: boolean } }>(
      'SELECT metadata FROM audit_events',
    );
    expect(rows.rows[0]?.metadata.granted).toBe(false);
  });

  it('the application role cannot UPDATE or DELETE what it wrote (the gate)', async () => {
    const admin = await createUser(h.owner, 'admin');

    await runWithContext(ctx(admin, 'admin'), async () => {
      await audit.record({
        actorId: admin,
        actorRole: 'admin',
        action: 'StudyAccessed',
        subjectType: 'study',
        subjectId: undefined,
        patientId: undefined,
        ipAddress: undefined,
        userAgent: undefined,
        metadata: {},
      });
    });

    // Tamper attempts, using the same connection the application uses.
    await expect(
      db.txAs(ctx(admin, 'admin'), async (tx) => {
        await tx.query("UPDATE audit_events SET action = 'nothing happened'");
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      db.txAs(ctx(admin, 'admin'), async (tx) => {
        await tx.query('DELETE FROM audit_events');
      }),
    ).rejects.toThrow(/permission denied/i);

    // The record survived both.
    const after = await h.owner.query<{ action: string }>('SELECT action FROM audit_events');
    expect(after.rowCount).toBe(1);
    expect(after.rows[0]?.action).toBe('StudyAccessed');
  });

  it('exposes no update or delete method at all', () => {
    // Level 1 of the three-level immutability argument: the code offers no
    // path. (Levels 2 and 3 are GRANTs and Object Lock.)
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(audit));
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('delete');
    expect(methods).not.toContain('remove');

    // The full surface is pinned, not just the forbidden names, so that ADDING
    // a method to this service is a decision someone has to make here rather
    // than something that slips in. `recent` is a READ — it backs the admin
    // review screen (P6) and writes nothing. If a future method belongs in
    // this list, the question to answer first is whether it can mutate a row
    // that has already been written; if it can, it does not belong at all.
    expect(methods.filter((m) => m !== 'constructor').sort()).toEqual([
      'recent',
      'record',
      'recordEvent',
    ]);
  });

  describe('subscriptions', () => {
    it('subscribes to every domain event type — no event goes unaudited', async () => {
      const bus = new EventBus();
      const subscriber = new AuditSubscriber(bus, audit);
      subscriber.onModuleInit();

      // The exhaustive list from §5.2, plus the revocation event the spec's
      // table omits but P5.3 requires, plus the two appointment changes the
      // practice calendar introduced — moving or cancelling someone's
      // appointment is as patient-affecting as making it, and the log is what a
      // patient disputing either would be shown.
      const expected: DomainEventType[] = [
        'PatientCreated',
        'ConsentGranted',
        'ConsentRevoked',
        'StudyUploadCompleted',
        'CaseSubmitted',
        'CaseQuoted',
        'CaseCancelled',
        'CaseDeclined',
        'CaseExpired',
        'CaseAccepted',
        'StudyAccessed',
      ];
      expect([...AUDITED_EVENTS].sort()).toEqual([...expected].sort());

      for (const type of expected) {
        expect(bus.subscriberCount(type)).toBe(1);
      }
    });

    it('an audit failure propagates instead of being swallowed', async () => {
      const bus = new EventBus();
      const failing = {
        recordEvent: async () => {
          throw new Error('audit store unavailable');
        },
      } as unknown as AuditService;
      new AuditSubscriber(bus, failing).onModuleInit();

      // Non-critical subscribers get their errors logged. Audit must not:
      // an action recorded nowhere is indistinguishable from one that never
      // happened.
      await expect(
        bus.publish({
          ...baseEvent('u', 'admin'),
          type: 'PatientCreated',
          patientId: 'p',
          createdByDoctor: 'd',
        }),
      ).rejects.toThrow('audit store unavailable');
    });

    it('a non-critical subscriber failure does not break the emitter', async () => {
      const bus = new EventBus();
      bus.subscribe('StudyUploadCompleted', () => {
        throw new Error('sms gateway down');
      });

      // One broken notification template must not roll back a finished upload.
      await expect(
        bus.publish({
          ...baseEvent('u', 'libya_doctor'),
          type: 'StudyUploadCompleted',
          studyId: 's',
          patientId: 'p',
          fileCount: 120,
          totalBytes: 4_000_000,
          containsLossy: false,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('metadata scrubbing', () => {
    it('redacts identifiers and secrets that must never reach the log', () => {
      const out = scrub({
        studyId: 'ok-to-keep',
        patientName: 'محمد علي',
        date_of_birth: '1985-06-15',
        token: 'eyJhbGciOi...',
        phone_e164: '+218912345678',
        diagnosis: 'suspected fracture',
      });

      expect(out['studyId']).toBe('ok-to-keep');
      expect(out['patientName']).toBe('[redacted]');
      expect(out['date_of_birth']).toBe('[redacted]');
      expect(out['token']).toBe('[redacted]');
      expect(out['phone_e164']).toBe('[redacted]');
      expect(out['diagnosis']).toBe('[redacted]');
    });

    it('scrubs nested objects', () => {
      const out = scrub({ outer: { patientName: 'x', keep: 1 } });
      expect(out['outer']).toEqual({ patientName: '[redacted]', keep: 1 });
    });

    it('is case- and separator-insensitive', () => {
      const out = scrub({ PatientName: 'a', 'full-name': 'b', ACCESS_TOKEN: 'c' });
      expect(out['PatientName']).toBe('[redacted]');
      expect(out['full-name']).toBe('[redacted]');
      expect(out['ACCESS_TOKEN']).toBe('[redacted]');
    });

    it('scrubs on the way into the database, not just in memory', async () => {
      const admin = await createUser(h.owner, 'admin');
      await runWithContext(ctx(admin, 'admin'), async () => {
        await audit.record({
          actorId: admin,
          actorRole: 'admin',
          action: 'Test',
          subjectType: 'test',
          subjectId: undefined,
          patientId: undefined,
          ipAddress: undefined,
          userAgent: undefined,
          metadata: { patientName: 'Should Not Persist', keep: 'yes' },
        });
      });

      const rows = await h.owner.query<{ metadata: Record<string, unknown> }>(
        'SELECT metadata FROM audit_events',
      );
      expect(rows.rows[0]?.metadata['patientName']).toBe('[redacted]');
      expect(rows.rows[0]?.metadata['keep']).toBe('yes');
      expect(JSON.stringify(rows.rows[0]?.metadata)).not.toContain('Should Not Persist');
    });
  });
});
