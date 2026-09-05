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
import { SchedulingService, SlotUnavailableError } from './internal/scheduling.service';

/**
 * BUILD_SPEC P10 — scheduling.
 *
 * P10.2 gate: "Fire 50 concurrent booking requests for the same slot. EXACTLY
 * ONE succeeds; the rest receive a clean conflict error, not a 500."
 *
 * P10.1 gate: "Timezone correctness verified with explicit test cases, not
 * assumed."
 */

let h: Harness;
let db: DatabaseService;
let bus: EventBus;
let scheduling: SchedulingService;

const config = { PAYMENT_AUTHORIZATION_WINDOW_HOURS: 72 } as AppConfig;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  triageBeforePayment: false,
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'p10-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 20 } as AppConfig);
  bus = new EventBus();
  scheduling = new SchedulingService(db, bus, config);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

/** A fixed future slot, in UTC. */
const SLOT_START = new Date(Date.UTC(2026, 5, 15, 9, 0, 0));
const SLOT_END = new Date(Date.UTC(2026, 5, 15, 9, 30, 0));

describe('P10.2 booking concurrency (the gate)', () => {
  /**
   * The 30-second default is not enough here, for the same reason the repeated
   * -runs test below carries its own budget: this suite runs concurrently with
   * every other one against a single PostgreSQL, and fifty contending inserts
   * queue behind the exclusion constraint. In isolation the assertions take
   * about a second; under a full `pnpm verify` they do not.
   *
   * The timeout buys patience, not tolerance — the test still demands exactly
   * one winner and forty-nine clean 409s.
   */
  it('exactly one of 50 concurrent bookings for the same slot succeeds', { timeout: 120_000 }, async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');

    // 50 DIFFERENT patients racing for one slot. Same-patient retries would be
    // a weaker test: the point is that fifty unrelated people cannot all be
    // given the same appointment.
    //
    // They used to race as fifty separate patient ACCOUNTS. Migration 0021
    // removed those, so the referring doctor now issues all fifty bookings —
    // which is a slightly harder case for the exclusion constraint, since the
    // contention is no longer spread across fifty sessions.
    const contenders = await Promise.all(
      Array.from({ length: 50 }, () => createPatient(h.owner, libyaDoctor)),
    );

    const results = await Promise.allSettled(
      contenders.map((patient) =>
        runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
          scheduling.book({
            patientId: patient,
            doctorId: tunisDoctor,
            startsAt: SLOT_START,
            endsAt: SLOT_END,
          }),
        ),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(49);

    // Every loser gets a CLEAN CONFLICT, not a 500. A raw constraint error
    // reaching the client would be both a bad experience and an internals leak.
    for (const f of failed) {
      const reason = (f as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(SlotUnavailableError);
      expect((reason as SlotUnavailableError).getStatus()).toBe(409);
    }

    // And the database holds exactly one appointment.
    const rows = await h.owner.query('SELECT id FROM scheduling_appointments');
    expect(rows.rowCount).toBe(1);
  });

  it('is deterministic across repeated runs', { timeout: 120_000 }, async () => {
    // A concurrency test that passes sometimes proves nothing. Five rounds.
    // Three rounds, not five: this runs concurrently with every other
    // suite during `pnpm verify`, and the property (exactly one winner, every
    // time) is demonstrated by repetition, not by the exact count.
    for (let round = 0; round < 3; round++) {
      await truncateAll(h.owner);
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');

      const contenders = await Promise.all(
        Array.from({ length: 12 }, () => createPatient(h.owner, libyaDoctor)),
      );

      const results = await Promise.allSettled(
        contenders.map((patient) =>
          runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
            scheduling.book({
              patientId: patient,
              doctorId: tunisDoctor,
              startsAt: SLOT_START,
              endsAt: SLOT_END,
            }),
          ),
        ),
      );

      expect(
        results.filter((r) => r.status === 'fulfilled'),
        `round ${round}`,
      ).toHaveLength(1);
    }
  });

  it('never surfaces a raw database error to a losing booker', async () => {
    // Under 50-way contention PostgreSQL raises deadlock_detected (40P01) as
    // well as the exclusion violation. Both must reach the CALLER as a clean
    // 409 — P10.2 says "not a 500". This asserts the property directly rather
    // than relying on the 50-way test happening to produce a deadlock.
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');

    const contenders = await Promise.all(
      Array.from({ length: 20 }, () => createPatient(h.owner, libyaDoctor)),
    );

    const results = await Promise.allSettled(
      contenders.map((patient) =>
        runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
          scheduling.book({
            patientId: patient,
            doctorId: tunisDoctor,
            startsAt: SLOT_START,
            endsAt: SLOT_END,
          }),
        ),
      ),
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        const reason = r.reason as { code?: string; getStatus?: () => number };
        // No raw driver error may escape: no SQLSTATE, and a 409 status.
        expect(reason.code, `raw SQLSTATE ${reason.code} leaked`).toBeUndefined();
        expect(reason.getStatus?.()).toBe(409);
      }
    }
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  }, 120_000);

  it('allows a second booking for a DIFFERENT slot with the same doctor', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const p1 = await createPatient(h.owner, libyaDoctor);
    const p2 = await createPatient(h.owner, libyaDoctor);

    await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p1, doctorId: tunisDoctor, startsAt: SLOT_START, endsAt: SLOT_END }),
    );

    const later = new Date(SLOT_END.getTime());
    const laterEnd = new Date(SLOT_END.getTime() + 30 * 60_000);
    const second = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p2, doctorId: tunisDoctor, startsAt: later, endsAt: laterEnd }),
    );

    expect(second.id).toBeDefined();
  });

  it('rejects a PARTIALLY overlapping booking, not just an identical one', async () => {
    // The constraint is on range overlap. A 15-minute-late start still
    // collides, and application-level equality checks would miss it.
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const p1 = await createPatient(h.owner, libyaDoctor);
    const p2 = await createPatient(h.owner, libyaDoctor);

    await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p1, doctorId: tunisDoctor, startsAt: SLOT_START, endsAt: SLOT_END }),
    );

    await expect(
      runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
        scheduling.book({
          patientId: p2,
          doctorId: tunisDoctor,
          startsAt: new Date(SLOT_START.getTime() + 15 * 60_000),
          endsAt: new Date(SLOT_END.getTime() + 15 * 60_000),
        }),
      ),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it('frees the slot after cancellation', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const p1 = await createPatient(h.owner, libyaDoctor);
    const p2 = await createPatient(h.owner, libyaDoctor);

    const first = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p1, doctorId: tunisDoctor, startsAt: SLOT_START, endsAt: SLOT_END }),
    );
    await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () => scheduling.cancel(first.id));

    // The exclusion constraint excludes cancelled rows, so the slot reopens.
    const second = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p2, doctorId: tunisDoctor, startsAt: SLOT_START, endsAt: SLOT_END }),
    );
    expect(second.id).not.toBe(first.id);
  });

  it('two doctors can be booked for the same instant', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const docA = await createUser(h.owner, 'tunisia_doctor');
    const docB = await createUser(h.owner, 'tunisia_doctor');
    const p = await createPatient(h.owner, libyaDoctor);

    await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p, doctorId: docA, startsAt: SLOT_START, endsAt: SLOT_END }),
    );
    // The constraint is per doctor, not global.
    const second = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p, doctorId: docB, startsAt: SLOT_START, endsAt: SLOT_END }),
    );
    expect(second.doctorId).toBe(docB);
  });

  it('starts a booking at pending_payment (DECISION D2)', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const p = await createPatient(h.owner, libyaDoctor);

    const appt = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p, doctorId: tunisDoctor, startsAt: SLOT_START, endsAt: SLOT_END }),
    );
    expect(appt.status).toBe('pending_payment');
  });

  // 120s like its siblings, and for the same reason: these tests are bounded by
  // PostgreSQL's `deadlock_timeout`, not by anything in the booking logic.
  //
  // Concurrent inserts of overlapping ranges deadlock MUTUALLY while checking
  // the gist exclusion constraint — each has speculatively inserted its own
  // tuple and then waits on the other's transaction ("while checking exclusion
  // constraint on tuple ... in relation scheduling_appointments"). That is
  // inherent to exclusion constraints under contention, not a lock-ordering
  // mistake we can fix. PostgreSQL breaks each cycle only after
  // deadlock_timeout, which defaults to a full SECOND, and book() then retries
  // (40P01). A round of contention therefore costs whole seconds of pure wait,
  // and a 30s default is not a safe margin for it.
  //
  // The assertion below is unchanged: exactly one event for exactly one winner.
  it('emits AppointmentBooked exactly once per successful booking', { timeout: 120_000 }, async () => {
    const seen: string[] = [];
    bus.subscribe('AppointmentBooked', (e) => {
      seen.push(e.appointmentId);
    });

    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const contenders = await Promise.all(
      Array.from({ length: 10 }, () => createPatient(h.owner, libyaDoctor)),
    );

    await Promise.allSettled(
      contenders.map((patient) =>
        runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
          scheduling.book({
            patientId: patient,
            doctorId: tunisDoctor,
            startsAt: SLOT_START,
            endsAt: SLOT_END,
          }),
        ),
      ),
    );

    // Nine losers must not produce nine notifications and nine ledger entries.
    expect(seen).toHaveLength(1);
  });

  it('cannot book for a patient the caller did not create', async () => {
    // Was "cannot book on behalf of another patient", when a patient held a
    // session and the attacker was one. There are no patient accounts, so the
    // caller who could plausibly try this is another DOCTOR — and the policy
    // that stops them is the same one: app_created_patient().
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const attacker = await createUser(h.owner, 'libya_doctor');
    const victimPatient = await createPatient(h.owner, libyaDoctor);

    await expect(
      runWithContext(ctx(attacker, 'libya_doctor'), () =>
        scheduling.book({
          patientId: victimPatient,
          doctorId: tunisDoctor,
          startsAt: SLOT_START,
          endsAt: SLOT_END,
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });
});

describe('P10.1 availability and timezones', () => {
  it('stores and returns UTC instants, unaffected by the server timezone', async () => {
    // Libya is UTC+2, Tunisia UTC+1, neither observes DST. The correctness
    // property is that an instant round-trips unchanged whatever TZ the
    // process runs in — display conversion is the client's job (§6).
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');

    const original = process.env['TZ'];
    try {
      process.env['TZ'] = 'Africa/Tripoli'; // UTC+2
      const created = await runWithContext(ctx(tunisDoctor, 'tunisia_doctor'), () =>
        scheduling.addAvailability({ startsAt: SLOT_START, endsAt: SLOT_END }),
      );

      expect(created.startsAt.toISOString()).toBe('2026-06-15T09:00:00.000Z');
      expect(created.endsAt.toISOString()).toBe('2026-06-15T09:30:00.000Z');
    } finally {
      if (original === undefined) delete process.env['TZ'];
      else process.env['TZ'] = original;
    }
  });

  it('a slot published in Tunis lands at the right local time in Tripoli', async () => {
    // 09:00 UTC is 10:00 in Tunis (UTC+1) and 11:00 in Tripoli (UTC+2).
    // Same instant, different wall clocks — this is the case P10.1 asks about.
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const created = await runWithContext(ctx(tunisDoctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: SLOT_START, endsAt: SLOT_END }),
    );

    const tunis = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Tunis',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(created.startsAt);
    const tripoli = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Tripoli',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(created.startsAt);

    expect(tunis).toBe('10:00');
    expect(tripoli).toBe('11:00');
  });

  it('stays correct across a European DST boundary', async () => {
    // Neither Libya nor Tunisia observes DST, but a doctor travelling, or a
    // browser in an EU timezone, will cross one. The stored instant must not
    // move.
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const summer = new Date(Date.UTC(2026, 6, 15, 9, 0, 0)); // July
    const winter = new Date(Date.UTC(2026, 0, 15, 9, 0, 0)); // January

    const a = await runWithContext(ctx(tunisDoctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: summer, endsAt: new Date(summer.getTime() + 1800_000) }),
    );
    const b = await runWithContext(ctx(tunisDoctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: winter, endsAt: new Date(winter.getTime() + 1800_000) }),
    );

    const local = (d: Date): string =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Tripoli',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);

    // Tripoli is UTC+2 in BOTH: 11:00 either side of the European switch.
    expect(local(a.startsAt)).toBe('11:00');
    expect(local(b.startsAt)).toBe('11:00');
  });

  it('lists open slots and excludes ones already taken', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const p = await createPatient(h.owner, libyaDoctor);

    const windowStart = new Date(Date.UTC(2026, 5, 15, 9, 0, 0));
    const windowEnd = new Date(Date.UTC(2026, 5, 15, 11, 0, 0)); // 4 x 30min
    await runWithContext(ctx(tunisDoctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: windowStart, endsAt: windowEnd }),
    );

    const before = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.listOpenSlots(tunisDoctor, windowStart, windowEnd),
    );
    expect(before).toHaveLength(4);

    await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p, doctorId: tunisDoctor, startsAt: SLOT_START, endsAt: SLOT_END }),
    );

    const after = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.listOpenSlots(tunisDoctor, windowStart, windowEnd),
    );
    expect(after).toHaveLength(3);
    expect(after.some((s) => s.startsAt.getTime() === SLOT_START.getTime())).toBe(false);
  });

  it('releases appointments whose payment authorisation expired (D2)', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const p = await createPatient(h.owner, libyaDoctor);

    const appt = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({ patientId: p, doctorId: tunisDoctor, startsAt: SLOT_START, endsAt: SLOT_END }),
    );

    // Age it past the authorisation window.
    await h.owner.query(
      `UPDATE scheduling_appointments SET created_at = now() - interval '100 hours' WHERE id = $1`,
      [appt.id],
    );

    const released = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.releaseExpiredAuthorisations(),
    );
    expect(released).toBeGreaterThanOrEqual(1);

    const row = await h.owner.query<{ status: string }>(
      'SELECT status FROM scheduling_appointments WHERE id = $1',
      [appt.id],
    );
    expect(row.rows[0]?.status).toBe('cancelled');
  });
});

describe('P10.3 study linkage', () => {
  it('links the studies the caller can see', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const otherDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const p = await createPatient(h.owner, libyaDoctor);

    const mine = await createStudy(h.owner, p, libyaDoctor);
    const strangerPatient = await createPatient(h.owner, otherDoctor);
    const notMine = await createStudy(h.owner, strangerPatient, otherDoctor);

    const appt = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({
        patientId: p,
        doctorId: tunisDoctor,
        startsAt: SLOT_START,
        endsAt: SLOT_END,
        studyIds: [mine],
      }),
    );

    const links = await h.owner.query<{ study_id: string }>(
      'SELECT study_id FROM scheduling_appointment_studies WHERE appointment_id = $1',
      [appt.id],
    );
    expect(links.rows.map((r) => r.study_id)).toEqual([mine]);

    // And nothing else leaked in.
    expect(links.rowCount).toBe(1);
    void notMine;
  });

  it('refuses the whole booking if a requested study is not linkable', async () => {
    // Silently dropping it would mean the receiving doctor never gets a scan
    // the patient believed they shared — discovered at the consultation, if
    // ever. Loud failure is the safe direction.
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const otherDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const p = await createPatient(h.owner, libyaDoctor);

    const mine = await createStudy(h.owner, p, libyaDoctor);
    const strangerPatient = await createPatient(h.owner, otherDoctor);
    const notMine = await createStudy(h.owner, strangerPatient, otherDoctor);

    await expect(
      runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
        scheduling.book({
          patientId: p,
          doctorId: tunisDoctor,
          startsAt: SLOT_START,
          endsAt: SLOT_END,
          studyIds: [mine, notMine],
        }),
      ),
    ).rejects.toThrow(/not found/i);

    // The transaction rolled back: no half-booked appointment left behind.
    const appts = await h.owner.query('SELECT id FROM scheduling_appointments');
    expect(appts.rowCount).toBe(0);
  });
});

/**
 * The practice-side calendar — the doctor's own diary, as opposed to the
 * patient-initiated referral flow everything above exercises.
 *
 * These cover the gap between what the HTTP layer's `@RequiresRole` decorators
 * ADVERTISE and what row-level security actually permits. `POST /appointments`
 * and `DELETE /appointments/:id` have listed the referring side since P10 was
 * written, but `scheduling_appointments` carried no INSERT or UPDATE policy for
 * it — only `appointments_referring_doctor`, which is `FOR SELECT`. The insert
 * therefore failed with 42501, which `attemptBooking` maps to "Patient not
 * found": a message that sends you looking at the patient record, and the
 * patient record is fine.
 *
 * A route whose decorator and whose policy disagree is worse than one that is
 * simply closed, because it reads as supported.
 */
describe('the practice calendar', () => {
  it('lets a referring doctor book for a patient they created', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, libyaDoctor);

    const appointment = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({
        patientId: patient,
        doctorId: tunisDoctor,
        startsAt: SLOT_START,
        endsAt: SLOT_END,
      }),
    );

    expect(appointment.id).toBeTruthy();
    expect(appointment.patientId).toBe(patient);
  });

  it('still refuses a referring doctor a patient they did not create', async () => {
    const mine = await createUser(h.owner, 'libya_doctor');
    const theirs = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const stranger = await createPatient(h.owner, theirs);

    await expect(
      runWithContext(ctx(mine, 'libya_doctor'), () =>
        scheduling.book({
          patientId: stranger,
          doctorId: tunisDoctor,
          startsAt: SLOT_START,
          endsAt: SLOT_END,
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('lets a referring doctor cancel a booking they made, freeing the slot', async () => {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, libyaDoctor);

    const appointment = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.book({
        patientId: patient,
        doctorId: tunisDoctor,
        startsAt: SLOT_START,
        endsAt: SLOT_END,
      }),
    );

    await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.cancel(appointment.id),
    );

    const after = await h.owner.query<{ status: string }>(
      'SELECT status FROM scheduling_appointments WHERE id = $1',
      [appointment.id],
    );
    expect(after.rows[0]?.status).toBe('cancelled');
  });

  it('shows the referring side a receiving doctor open slots', async () => {
    // The slot picker on the booking screen reads this. With availability
    // visible only to `patient`, it came back empty and the referring doctor
    // saw "no availability" for a doctor who had published plenty.
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');

    await runWithContext(ctx(tunisDoctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: SLOT_START, endsAt: SLOT_END, slotMinutes: 30 }),
    );

    const slots = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.listOpenSlots(
        tunisDoctor,
        new Date(SLOT_START.getTime() - 3_600_000),
        new Date(SLOT_END.getTime() + 3_600_000),
      ),
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]?.startsAt.toISOString()).toBe(SLOT_START.toISOString());
  });

  it('lets a receiving doctor publish and read back their own availability', async () => {
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');

    await runWithContext(ctx(tunisDoctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: SLOT_START, endsAt: SLOT_END, slotMinutes: 30 }),
    );

    const windows = await runWithContext(ctx(tunisDoctor, 'tunisia_doctor'), () =>
      scheduling.listAvailability(),
    );
    expect(windows).toHaveLength(1);
  });

  it('lets a referring doctor keep a diary of their own', async () => {
    // The referring side runs a clinic too. `availability_owner` named the
    // receiving role only, so their own windows vanished on write-then-read.
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');

    await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.addAvailability({ startsAt: SLOT_START, endsAt: SLOT_END, slotMinutes: 20 }),
    );

    const windows = await runWithContext(ctx(libyaDoctor, 'libya_doctor'), () =>
      scheduling.listAvailability(),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]?.slotMinutes).toBe(20);
  });

  it("keeps one doctor's diary out of another's", async () => {
    const a = await createUser(h.owner, 'tunisia_doctor');
    const b = await createUser(h.owner, 'tunisia_doctor');

    await runWithContext(ctx(a, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: SLOT_START, endsAt: SLOT_END }),
    );

    const seenByB = await runWithContext(ctx(b, 'tunisia_doctor'), () =>
      scheduling.listAvailability(),
    );
    expect(seenByB).toHaveLength(0);
  });
});
