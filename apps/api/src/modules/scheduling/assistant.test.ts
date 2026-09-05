import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import { EventBus } from '../../shared/events/event-bus';
import { SchedulingService } from './internal/scheduling.service';
import {
  appUrl,
  createPatient,
  createPractice,
  createStudy,
  createUser,
  grantConsent,
  seatMember,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';

/**
 * The practice assistant (migration 0015).
 *
 * These run raw SQL on the `mir_app` pool rather than through the service,
 * because what is under test is the POLICY layer: whether an assistant reaches
 * a row at all, and which columns exist for them to reach. A test that went
 * through the service could pass while the database remained open, simply
 * because the service happened not to ask.
 *
 * `h.owner` is a superuser and bypasses RLS, so it seeds and verifies but never
 * makes a visibility assertion.
 */

let h: Harness;
let app: Pool;

/**
 * Run statements as a given identity, then ROLL BACK.
 *
 * Rollback is the right default for a visibility assertion and WRONG for a
 * write one: a test that inserts here and then checks the owner connection is
 * asserting against a transaction that has been thrown away, and it fails
 * looking exactly like a policy that refused the insert. `asRoleCommitting` is
 * for the write cases.
 */
const asRole = async <T>(
  userId: string,
  role: string,
  fn: (c: import('pg').PoolClient) => Promise<T>,
  commit = false,
): Promise<T> => {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_role', role]);
    await client.query('SELECT set_config($1, $2, true)', ['app.triage_before_payment', 'false']);
    const out = await fn(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

const asRoleCommitting = <T>(
  userId: string,
  role: string,
  fn: (c: import('pg').PoolClient) => Promise<T>,
): Promise<T> => asRole(userId, role, fn, true);

beforeAll(async () => {
  h = await setupTestDatabase();
  app = new Pool({ connectionString: appUrl(), max: 4 });
}, 120_000);

afterAll(async () => {
  await app?.end();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

const SLOT_START = new Date(Date.UTC(2026, 8, 20, 9, 0, 0));
const SLOT_END = new Date(Date.UTC(2026, 8, 20, 9, 30, 0));

describe('what an assistant can do', () => {
  it('reads the agenda of the doctor they are seated with', async () => {
    const { doctorId, assistantId } = await createPractice(h.owner);
    const patient = await createPatient(h.owner, doctorId);
    await h.owner.query(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [patient, doctorId, SLOT_START, SLOT_END],
    );

    const rows = await asRole(assistantId, 'assistant', async (c) =>
      (await c.query('SELECT * FROM scheduling_assistant_agenda($1, $2)', [null, null])).rows,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ doctor_id: doctorId, patient_id: patient });
  });

  it('books an appointment on that doctor’s calendar', async () => {
    const { doctorId, assistantId } = await createPractice(h.owner);
    const patient = await createPatient(h.owner, doctorId);

    await asRoleCommitting(assistantId, 'assistant', (c) =>
      c.query(
        `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
         VALUES ($1, $2, $3, $4, 'confirmed')`,
        [patient, doctorId, SLOT_START, SLOT_END],
      ),
    );

    // Asserted on the owner connection: the row really landed, rather than the
    // INSERT having been silently filtered to nothing.
    const check = await h.owner.query('SELECT doctor_id FROM scheduling_appointments');
    expect(check.rowCount).toBe(1);
    expect(check.rows[0]?.doctor_id).toBe(doctorId);
  });

  it('registers a walk-in as a patient OF THE DOCTOR, not of themselves', async () => {
    // If the assistant were recorded as the creator, `patients_creator` would
    // not match for the doctor and the doctor could not see the patient their
    // own receptionist had just booked.
    const { doctorId, assistantId } = await createPractice(h.owner);

    await asRoleCommitting(assistantId, 'assistant', (c) =>
      c.query(
        `INSERT INTO patients_patients
           (phone_e164, full_name, date_of_birth, sex, created_by_doctor)
         VALUES ('+21890000111', 'Walk In', '1990-01-01', 'F', $1)`,
        [doctorId],
      ),
    );

    const seenByDoctor = await asRole(doctorId, 'tunisia_doctor', async (c) =>
      (await c.query('SELECT full_name FROM patients_patients')).rows,
    );
    expect(seenByDoctor).toHaveLength(1);
    expect(seenByDoctor[0]?.full_name).toBe('Walk In');
  });

  it('finds a patient by phone, and only by phone', async () => {
    const { doctorId, assistantId } = await createPractice(h.owner);
    await h.owner.query(
      `INSERT INTO patients_patients
         (phone_e164, full_name, date_of_birth, sex, created_by_doctor)
       VALUES ('+21890000222', 'Findable', '1990-01-01', 'F', $1)`,
      [doctorId],
    );

    const hit = await asRole(assistantId, 'assistant', async (c) =>
      (await c.query('SELECT * FROM scheduling_assistant_patient_search($1)', ['+21890000222']))
        .rows,
    );
    expect(hit).toHaveLength(1);

    const miss = await asRole(assistantId, 'assistant', async (c) =>
      (await c.query('SELECT * FROM scheduling_assistant_patient_search($1)', ['+21890009999']))
        .rows,
    );
    expect(miss).toHaveLength(0);
  });

  it('manages the doctor’s availability', async () => {
    const { doctorId, assistantId } = await createPractice(h.owner);

    await asRoleCommitting(assistantId, 'assistant', (c) =>
      c.query(
        `INSERT INTO scheduling_availability (doctor_id, starts_at, ends_at, slot_minutes)
         VALUES ($1, $2, $3, 30)`,
        [doctorId, SLOT_START, SLOT_END],
      ),
    );

    const windows = await h.owner.query('SELECT doctor_id FROM scheduling_availability');
    expect(windows.rowCount).toBe(1);
  });
});

describe('what an assistant cannot do', () => {
  it('sees nothing belonging to a doctor they are not seated with', async () => {
    const mine = await createPractice(h.owner);
    const theirs = await createPractice(h.owner);
    const patient = await createPatient(h.owner, theirs.doctorId);
    await h.owner.query(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [patient, theirs.doctorId, SLOT_START, SLOT_END],
    );

    const rows = await asRole(mine.assistantId, 'assistant', async (c) =>
      (await c.query('SELECT * FROM scheduling_assistant_agenda($1, $2)', [null, null])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('cannot book another practice’s patient onto their own doctor', async () => {
    const mine = await createPractice(h.owner);
    const theirs = await createPractice(h.owner);
    const stranger = await createPatient(h.owner, theirs.doctorId);

    await expect(
      asRole(mine.assistantId, 'assistant', (c) =>
        c.query(
          `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
           VALUES ($1, $2, $3, $4, 'confirmed')`,
          [stranger, mine.doctorId, SLOT_START, SLOT_END],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('reads no rows from patients_patients directly', async () => {
    // The whole point of the SECURITY DEFINER functions: there is no SELECT
    // policy here, so the demographics are unreachable rather than merely
    // unselected.
    const { doctorId, assistantId } = await createPractice(h.owner);
    await createPatient(h.owner, doctorId);

    const rows = await asRole(assistantId, 'assistant', async (c) =>
      (await c.query('SELECT * FROM patients_patients')).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('reads no imaging and no consent, even for a patient on their own agenda', async () => {
    const { doctorId, assistantId } = await createPractice(h.owner);
    const referrer = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, referrer);
    const study = await createStudy(h.owner, patient, referrer);
    await grantConsent(h.owner, patient, doctorId, referrer);
    const appt = await h.owner.query<{ id: string }>(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed') RETURNING id`,
      [patient, doctorId, SLOT_START, SLOT_END],
    );
    await h.owner.query(
      `INSERT INTO scheduling_appointment_studies (appointment_id, study_id) VALUES ($1, $2)`,
      [appt.rows[0]?.id, study],
    );

    const seen = await asRole(assistantId, 'assistant', async (c) => ({
      studies: (await c.query('SELECT * FROM imaging_studies')).rowCount,
      instances: (await c.query('SELECT * FROM imaging_instances')).rowCount,
      consents: (await c.query('SELECT * FROM consent_records')).rowCount,
    }));

    expect(seen).toEqual({ studies: 0, instances: 0, consents: 0 });
  });

  it('is powerless without a seat', async () => {
    // The role alone grants nothing: every policy is `role AND
    // app_assists_doctor(...)`, and an unseated assistant fails the second half.
    const unseated = await createUser(h.owner, 'assistant');
    const { doctorId } = await createPractice(h.owner);
    const patient = await createPatient(h.owner, doctorId);
    await h.owner.query(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [patient, doctorId, SLOT_START, SLOT_END],
    );

    const rows = await asRole(unseated, 'assistant', async (c) =>
      (await c.query('SELECT * FROM scheduling_assistant_agenda($1, $2)', [null, null])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('is not promoted by a mere seat in someone else’s practice', async () => {
    // A `member` seat is not an `assistant` seat. Sharing an organisation with
    // a doctor is not enough; the seat has to say so.
    const { orgId, doctorId } = await createPractice(h.owner);
    const outsider = await createUser(h.owner, 'assistant');
    await seatMember(h.owner, orgId, outsider, 'member');
    const patient = await createPatient(h.owner, doctorId);
    await h.owner.query(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [patient, doctorId, SLOT_START, SLOT_END],
    );

    const rows = await asRole(outsider, 'assistant', async (c) =>
      (await c.query('SELECT * FROM scheduling_assistant_agenda($1, $2)', [null, null])).rows,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('the agenda function exposes no clinical column', () => {
  it('returns exactly the identity fields a receptionist needs', async () => {
    // This is the test that keeps the privacy decision honest. The restriction
    // lives in the function's RETURNS TABLE, so widening it is a schema change
    // that fails here rather than an extra field in a SELECT list nobody reads.
    const { doctorId, assistantId } = await createPractice(h.owner);
    const patient = await createPatient(h.owner, doctorId);
    await h.owner.query(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [patient, doctorId, SLOT_START, SLOT_END],
    );

    const rows = await asRole(assistantId, 'assistant', async (c) =>
      (await c.query('SELECT * FROM scheduling_assistant_agenda($1, $2)', [null, null])).rows,
    );

    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'doctor_id',
      'doctor_name',
      'ends_at',
      'id',
      'kind',
      'notes',
      'patient_id',
      'patient_name',
      'patient_phone',
      'reason',
      'starts_at',
      'status',
    ]);
  });
});

describe('a refused write is a 404, never a 500', () => {
  /**
   * The failure this covers was found by driving the real HTTP API, not by the
   * suite above: RLS correctly refused an assistant writing to a doctor they do
   * not assist, and the raw 42501 escaped as a 500. That is both a lie and an
   * oracle — an attacker probing calendars could tell "refused" from "no such
   * doctor" by the status code alone, which §6 exists to prevent.
   */
  it('refuses availability for an unassisted doctor as not-found', async () => {
    const mine = await createPractice(h.owner);
    const theirs = await createPractice(h.owner);

    const db = new DatabaseService({
      DATABASE_URL: appUrl(),
      DATABASE_POOL_MAX: 4,
    } as AppConfig);
    const scheduling = new SchedulingService(db, new EventBus(), {
      PAYMENT_AUTHORIZATION_WINDOW_HOURS: 72,
    } as AppConfig);

    try {
      await expect(
        runWithContext(
          {
            userId: mine.assistantId,
            role: 'assistant',
            triageBeforePayment: false,
            ipAddress: '41.208.1.5',
            userAgent: 'vitest',
            requestId: 'assistant-rls',
          },
          () =>
            scheduling.addAvailability({
              startsAt: SLOT_START,
              endsAt: SLOT_END,
              doctorId: theirs.doctorId,
            }),
        ),
      ).rejects.toThrow(NotFoundException);
    } finally {
      await db.onModuleDestroy();
    }
  });
});
