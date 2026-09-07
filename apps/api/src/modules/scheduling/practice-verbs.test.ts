import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createPatient,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { EventBus } from '../../shared/events/event-bus';
import { SchedulingService, SlotUnavailableError } from './internal/scheduling.service';
import { LedgerService } from '../ledger';

/**
 * Running the diary: reschedule, complete, no-show, cancel-with-reason, and
 * recurring availability.
 *
 * These are the operations a practice needs and the referral flow never had.
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
  requestId: 'practice-verbs',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 8 } as AppConfig);
  bus = new EventBus();
  scheduling = new SchedulingService(db, bus, config, new LedgerService(db));
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

const START = new Date(Date.UTC(2026, 9, 12, 9, 0, 0));
const END = new Date(Date.UTC(2026, 9, 12, 9, 30, 0));
const LATER_START = new Date(Date.UTC(2026, 9, 12, 11, 0, 0));
const LATER_END = new Date(Date.UTC(2026, 9, 12, 11, 30, 0));

/** A receiving doctor with one of their own patients booked in. */
async function booked(): Promise<{ doctor: string; patient: string; appointment: string }> {
  const doctor = await createUser(h.owner, 'tunisia_doctor');
  const patient = await createPatient(h.owner, doctor);
  const appointment = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
    scheduling.book({ patientId: patient, doctorId: doctor, startsAt: START, endsAt: END }),
  );
  return { doctor, patient, appointment: appointment.id };
}

describe('reschedule', () => {
  it('moves an appointment to a free slot', async () => {
    const { doctor, appointment } = await booked();

    const moved = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.reschedule(appointment, LATER_START, LATER_END),
    );

    expect(moved.startsAt.toISOString()).toBe(LATER_START.toISOString());
  });

  it('refuses a slot the doctor already has, with a clean conflict', async () => {
    // The P10.2 property, restated for the second writer of this constraint: a
    // contested move is a 409, never a 500 and never a double-booking.
    const { doctor, appointment } = await booked();
    const other = await createPatient(h.owner, doctor);
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.book({
        patientId: other,
        doctorId: doctor,
        startsAt: LATER_START,
        endsAt: LATER_END,
      }),
    );

    await expect(
      runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
        scheduling.reschedule(appointment, LATER_START, LATER_END),
      ),
    ).rejects.toThrow(SlotUnavailableError);
  });

  it('frees the slot it left', async () => {
    const { doctor, patient, appointment } = await booked();
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.reschedule(appointment, LATER_START, LATER_END),
    );

    // Somebody else can now have the original time.
    const second = await createPatient(h.owner, doctor);
    await expect(
      runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
        scheduling.book({ patientId: second, doctorId: doctor, startsAt: START, endsAt: END }),
      ),
    ).resolves.toMatchObject({ patientId: second });
    expect(patient).not.toBe(second);
  });

  it('refuses to move an appointment belonging to another doctor', async () => {
    const { appointment } = await booked();
    const stranger = await createUser(h.owner, 'tunisia_doctor');

    await expect(
      runWithContext(ctx(stranger, 'tunisia_doctor'), () =>
        scheduling.reschedule(appointment, LATER_START, LATER_END),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('emits AppointmentRescheduled', async () => {
    const { doctor, appointment } = await booked();
    const seen: string[] = [];
    bus.subscribe('AppointmentRescheduled', (e) => {
      seen.push(e.appointmentId);
      return Promise.resolve();
    });

    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.reschedule(appointment, LATER_START, LATER_END),
    );

    expect(seen).toEqual([appointment]);
  });
});

describe('closing out an appointment', () => {
  const past = new Date(Date.now() - 3_600_000);

  async function confirmedInThePast(): Promise<{ doctor: string; appointment: string }> {
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, doctor);
    const res = await h.owner.query<{ id: string }>(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed') RETURNING id`,
      [patient, doctor, past, new Date(past.getTime() + 1_800_000)],
    );
    return { doctor, appointment: res.rows[0]?.id ?? '' };
  }

  it('marks a past confirmed appointment completed', async () => {
    const { doctor, appointment } = await confirmedInThePast();
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.markCompleted(appointment),
    );

    const after = await h.owner.query<{ status: string }>(
      'SELECT status FROM scheduling_appointments WHERE id = $1',
      [appointment],
    );
    expect(after.rows[0]?.status).toBe('completed');
  });

  it('records a no-show, which is not a cancellation', async () => {
    const { doctor, appointment } = await confirmedInThePast();
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () => scheduling.markNoShow(appointment));

    const after = await h.owner.query<{ status: string }>(
      'SELECT status FROM scheduling_appointments WHERE id = $1',
      [appointment],
    );
    // Specifically not 'cancelled': the slot was consumed and the practice
    // needs to be able to tell the two apart.
    expect(after.rows[0]?.status).toBe('no_show');
  });

  it('refuses to complete an appointment that has not happened yet', async () => {
    const { doctor, appointment } = await booked();
    await h.owner.query(`UPDATE scheduling_appointments SET status = 'confirmed' WHERE id = $1`, [
      appointment,
    ]);

    await expect(
      runWithContext(ctx(doctor, 'tunisia_doctor'), () => scheduling.markCompleted(appointment)),
    ).rejects.toThrow(/not found/i);
  });

  it('cancels with a reason the patient can act on', async () => {
    const { doctor, appointment } = await booked();
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.cancelAsDoctor(appointment, 'Clinic closed'),
    );

    const after = await h.owner.query<{ status: string; cancel_reason: string }>(
      'SELECT status, cancel_reason FROM scheduling_appointments WHERE id = $1',
      [appointment],
    );
    expect(after.rows[0]).toMatchObject({ status: 'cancelled', cancel_reason: 'Clinic closed' });
  });

  it('stores scheduling detail without touching the time', async () => {
    const { doctor, appointment } = await booked();
    const updated = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.updateAppointment(appointment, { kind: 'follow_up', reason: 'Reviewing scan' }),
    );

    expect(updated).toMatchObject({ kind: 'follow_up', reason: 'Reviewing scan' });
    expect(updated.startsAt.toISOString()).toBe(START.toISOString());
  });
});

describe('availability upkeep', () => {
  it('withdraws an empty window and stops offering its slots', async () => {
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const window = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: START, endsAt: END, slotMinutes: 30 }),
    );

    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.withdrawAvailability(window.id),
    );

    const remaining = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.listAvailability(),
    );
    expect(remaining).toHaveLength(0);

    const slots = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.listOpenSlots(doctor, new Date(START.getTime() - 3_600_000), LATER_END),
    );
    expect(slots).toHaveLength(0);
  });

  it('refuses to withdraw a window that still has someone in it', async () => {
    // Silently withdrawing the hours around a booked patient would leave an
    // appointment no calendar admits to.
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, doctor);
    const window = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: START, endsAt: END, slotMinutes: 30 }),
    );
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.book({ patientId: patient, doctorId: doctor, startsAt: START, endsAt: END }),
    );

    await expect(
      runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
        scheduling.withdrawAvailability(window.id),
      ),
    ).rejects.toThrow(/cancel the appointments/i);
  });

  it('withdrawal keeps the row, rather than deleting it', async () => {
    // The application holds no DELETE grant anywhere, and what was advertised
    // should stay on the record.
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const window = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.addAvailability({ startsAt: START, endsAt: END }),
    );
    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.withdrawAvailability(window.id),
    );

    const row = await h.owner.query<{ withdrawn_at: Date | null }>(
      'SELECT withdrawn_at FROM scheduling_availability WHERE id = $1',
      [window.id],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]?.withdrawn_at).not.toBeNull();
  });
});

describe('recurring availability', () => {
  it('generates windows on the right weekday, at the clinic’s local time', async () => {
    const doctor = await createUser(h.owner, 'tunisia_doctor');

    const { generated } = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.addAvailabilityRule({
        weekday: 2, // ISO Tuesday
        startTime: '09:00',
        endTime: '12:00',
        timezone: 'Africa/Tunis',
        slotMinutes: 30,
      }),
    );

    expect(generated).toBeGreaterThan(0);

    const windows = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.listAvailability(),
    );
    expect(windows.length).toBe(generated);

    // Tunisia is UTC+1 with no DST, so 09:00 local is 08:00Z — and every
    // generated window must land on a Tuesday.
    for (const w of windows) {
      expect(w.startsAt.getUTCHours()).toBe(8);
      expect(w.startsAt.getUTCDay()).toBe(2);
    }
  });

  it('is idempotent — re-materialising creates nothing new', async () => {
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const { id, generated } = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.addAvailabilityRule({
        weekday: 3,
        startTime: '14:00',
        endTime: '16:00',
        timezone: 'Africa/Tunis',
      }),
    );

    const second = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.materialiseRule(id),
    );
    expect(second).toBe(0);

    const windows = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.listAvailability(),
    );
    expect(windows).toHaveLength(generated);
  });

  it('withdrawing a rule takes down its future windows but keeps booked ones', async () => {
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, doctor);
    const { id } = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.addAvailabilityRule({
        weekday: 4,
        startTime: '09:00',
        endTime: '10:00',
        timezone: 'Africa/Tunis',
      }),
    );

    const windows = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.listAvailability(),
    );
    const keep = windows[0];
    if (keep === undefined) throw new Error('rule generated no windows');

    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.book({
        patientId: patient,
        doctorId: doctor,
        startsAt: keep.startsAt,
        endsAt: keep.endsAt,
      }),
    );

    await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.withdrawAvailabilityRule(id),
    );

    const left = await runWithContext(ctx(doctor, 'tunisia_doctor'), () =>
      scheduling.listAvailability(),
    );
    // The one with a patient in it survives; the rest are gone.
    expect(left).toHaveLength(1);
    expect(left[0]?.id).toBe(keep.id);
  });

  it('keeps a rule out of another doctor’s calendar', async () => {
    const mine = await createUser(h.owner, 'tunisia_doctor');
    const theirs = await createUser(h.owner, 'tunisia_doctor');
    await runWithContext(ctx(mine, 'tunisia_doctor'), () =>
      scheduling.addAvailabilityRule({
        weekday: 1,
        startTime: '09:00',
        endTime: '10:00',
        timezone: 'Africa/Tunis',
      }),
    );

    const seen = await runWithContext(ctx(theirs, 'tunisia_doctor'), () =>
      scheduling.listAvailabilityRules(),
    );
    expect(seen).toHaveLength(0);
  });
});

describe('the periodic sweep', () => {
  it('reminds a confirmed appointment inside the lead time, exactly once', async () => {
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, doctor);
    const soon = new Date(Date.now() + 6 * 3_600_000);
    await h.owner.query(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [patient, doctor, soon, new Date(soon.getTime() + 1_800_000)],
    );

    const seen: string[] = [];
    bus.subscribe('AppointmentReminderDue', (e) => {
      seen.push(e.appointmentId);
      return Promise.resolve();
    });

    const first = await runWithContext(ctx(doctor, 'admin'), () => scheduling.sendDueReminders(24));
    expect(first).toBe(1);
    expect(seen).toHaveLength(1);

    // The mark is claimed in the same statement that selects, so a second
    // sweep — or a second replica — finds nothing.
    const second = await runWithContext(ctx(doctor, 'admin'), () => scheduling.sendDueReminders(24));
    expect(second).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it('leaves an appointment beyond the lead time alone', async () => {
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, doctor);
    const far = new Date(Date.now() + 10 * 86_400_000);
    await h.owner.query(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [patient, doctor, far, new Date(far.getTime() + 1_800_000)],
    );

    const sent = await runWithContext(ctx(doctor, 'admin'), () => scheduling.sendDueReminders(24));
    expect(sent).toBe(0);
  });

  it('does not remind an appointment that was never confirmed', async () => {
    // A pending referral may still lapse if no doctor answers it. Reminding
    // someone to attend an appointment that is about to be released is worse
    // than silence.
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, doctor);
    const soon = new Date(Date.now() + 3 * 3_600_000);
    await h.owner.query(
      `INSERT INTO scheduling_appointments (patient_id, doctor_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [patient, doctor, soon, new Date(soon.getTime() + 1_800_000)],
    );

    const sent = await runWithContext(ctx(doctor, 'admin'), () => scheduling.sendDueReminders(24));
    expect(sent).toBe(0);
  });

  it('records why an unanswered referral was released', async () => {
    const doctor = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, doctor);
    await h.owner.query(
      `INSERT INTO scheduling_appointments
         (patient_id, doctor_id, starts_at, ends_at, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', now() - interval '100 hours')`,
      [patient, doctor, START, END],
    );

    const released = await runWithContext(ctx(doctor, 'admin'), () =>
      scheduling.releaseUnansweredReferrals(),
    );
    expect(released).toBe(1);

    const row = await h.owner.query<{ status: string; cancel_reason: string }>(
      'SELECT status, cancel_reason FROM scheduling_appointments',
    );
    // 'cancelled', not 'declined': nobody refused this referral, the clock ran
    // out on it. `cancel_reason` is what carries that distinction, in a column
    // something actually writes.
    expect(row.rows[0]).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'referral_unanswered',
    });
  });
});
