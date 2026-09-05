import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService, type Tx } from '../../../shared/db/database.service';
import type { DomainEventBase } from '../../../shared/events/domain-events';
import { EventBus } from '../../../shared/events/event-bus';

/**
 * Availability and booking — BUILD_SPEC P10.
 *
 * DOUBLE-BOOKING IS PREVENTED BY THE DATABASE, NOT BY THIS CODE.
 *
 * `scheduling_appointments` carries a gist exclusion constraint (P3.1) that
 * makes two overlapping non-cancelled appointments for one doctor impossible.
 * There is deliberately no "check whether the slot is free, then insert" here:
 * that pattern loses to concurrency every time, and the losing case is two
 * patients told they have the same appointment (§17).
 *
 * What this code does instead is TRANSLATE the constraint violation into a
 * clean 409. The database decides; the application reports.
 *
 * All times are timestamptz in UTC (§6). Display-side conversion happens in
 * the browser — Libya is UTC+2 year-round, Tunisia UTC+1 with no DST, and the
 * offset between them changes nothing here because nothing here is local time.
 */

/** PostgreSQL SQLSTATE for a violated exclusion constraint. */
const EXCLUSION_VIOLATION = '23P01';
const UNIQUE_VIOLATION = '23505';

/**
 * Transient concurrency failures, as opposed to genuine conflicts.
 *
 * 40P01 deadlock_detected, 40001 serialization_failure.
 *
 * These are NOT the same as "someone else took the slot". A deadlock means the
 * database aborted one transaction to break a lock cycle — with a gist
 * exclusion constraint plus RLS policy subqueries, 50 simultaneous bookings
 * genuinely produce lock cycles. The transaction is rolled back cleanly and
 * retrying is both safe and correct: the slot may still be free.
 *
 * Left unhandled, a deadlock propagates as a raw driver error and the losing
 * patient gets a 500 — exactly what P10.2 forbids ("a clean conflict error,
 * not a 500").
 */
const TRANSIENT_CONFLICTS = new Set(['40P01', '40001']);

/** Bounded retries. A slot under this much contention resolves in a few. */
const MAX_BOOKING_ATTEMPTS = 5;

/**
 * Connection-pool exhaustion, which is transient in the same way.
 *
 * Under heavy contention the pool can be fully checked out and `connect()`
 * times out. That error carries no SQLSTATE, so the code check above misses
 * it and a raw driver message reaches the caller — the same "raw database
 * error escapes" failure the deadlock case had, arriving by a different door.
 */
function isTransientConnectionFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout exceeded when trying to connect|Connection terminated|too many clients/i.test(
    message,
  );
}

/**
 * How far ahead a recurring rule generates concrete windows.
 *
 * Twelve weeks: far enough that a patient booking "in a couple of months" finds
 * slots, short enough that a rule changed today does not leave a year of stale
 * windows to withdraw.
 */
const AVAILABILITY_HORIZON_DAYS = 84;

export interface AvailabilityWindow {
  id: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  slotMinutes: number;
}

/** A weekly opening-hours rule, in the clinic's own wall-clock time. */
export interface AvailabilityRule {
  id: string;
  doctorId: string;
  /** ISO-8601: 1 = Monday .. 7 = Sunday, matching PostgreSQL's `isodow`. */
  weekday: number;
  startTime: string;
  endTime: string;
  timezone: string;
  slotMinutes: number;
  validFrom: Date;
  validUntil: Date | null;
}

export interface BookingInput {
  patientId: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  /** Studies to share with this appointment. Consent is still required (P5.3). */
  studyIds?: string[];
  kind?: AppointmentKind;
  reason?: string;
  notes?: string;
}

export type AppointmentKind = 'consultation' | 'follow_up' | 'imaging' | 'other';

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  kind: AppointmentKind;
  /** Why the patient is coming — scheduling context, never a clinical finding. */
  reason: string | null;
  notes: string | null;
}

/** An appointment plus the names the UI needs, so it need not fan out. */
export interface AppointmentSummary extends Appointment {
  patientName: string;
  doctorName: string;
  /**
   * Present only on the assistant's agenda. A receptionist rings the patient;
   * a doctor opens the record, so nothing else needs it here.
   */
  patientPhone?: string;
  studyIds?: string[];
}

export interface DoctorSummary {
  id: string;
  displayName: string;
  specialty: string | null;
  city: string | null;
}

interface AppointmentRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  kind: string;
  reason: string | null;
  notes: string | null;
  patient_name: string;
  doctor_name: string;
  patient_phone?: string;
}

function toSummary(row: AppointmentRow): AppointmentSummary {
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    kind: row.kind as AppointmentKind,
    reason: row.reason,
    notes: row.notes,
    patientName: row.patient_name,
    doctorName: row.doctor_name,
    ...(row.patient_phone === undefined ? {} : { patientPhone: row.patient_phone }),
  };
}

/** The columns every appointment read shares. */
const APPOINTMENT_COLUMNS = `a.id, a.patient_id, a.doctor_id, a.starts_at, a.ends_at,
                a.status, a.kind, a.reason, a.notes,
                p.full_name AS patient_name, d.full_name AS doctor_name`;

export class SlotUnavailableError extends ConflictException {
  constructor() {
    super('That appointment slot is no longer available');
  }
}

/**
 * Translate a failed write on `scheduling_appointments` into an HTTP answer.
 *
 * Shared by book and reschedule because they fail in exactly the same ways and
 * must answer identically. The version of this that lived inline in
 * `attemptBooking` was the only correct handling in the module, so a second
 * writer would otherwise have grown its own — and the one that matters,
 * 23P01 -> a clean 409 rather than a 500, is the P10.2 gate.
 *
 * 42501 is RLS refusing the row. It becomes 404, never 403: §6 requires that
 * "does not exist" and "not yours" be indistinguishable.
 */
/**
 * PostgreSQL's "insufficient privilege" — RLS refusing the row.
 *
 * It becomes 404 and never 403, because §6 requires that "does not exist" and
 * "not yours" be indistinguishable: a 403 confirms the row is real, which is an
 * oracle for which doctors and patients exist.
 *
 * Left untranslated it surfaces as a 500, which is both a lie and a signal —
 * an attacker probing calendars can tell a refusal from a miss by the status
 * code alone.
 */
const RLS_REFUSED = '42501';

/** Translate an RLS refusal on any scheduling write into a clean 404. */
function translateRlsRefusal(err: unknown, notFound: string): never {
  if ((err as { code?: string }).code === RLS_REFUSED) {
    throw new NotFoundException(notFound);
  }
  throw err;
}

function translateAppointmentWriteError(err: unknown, notFound: string): never {
  const code = (err as { code?: string }).code;
  if (code === EXCLUSION_VIOLATION || code === UNIQUE_VIOLATION) {
    throw new SlotUnavailableError();
  }
  if (code === RLS_REFUSED) {
    throw new NotFoundException(notFound);
  }
  throw err;
}

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------------------
  // P10.1 — availability
  // -------------------------------------------------------------------------

  /**
   * Publish a window of availability.
   *
   * `doctorId` defaults to the caller, which is the doctor's own case. An
   * assistant must pass one — and `availability_assistant` is what decides
   * whether they may, so this parameter widens nothing on its own.
   */
  async addAvailability(input: {
    startsAt: Date;
    endsAt: Date;
    slotMinutes?: number;
    doctorId?: string;
  }): Promise<AvailabilityWindow> {
    const ctx = requireContext();

    if (input.endsAt <= input.startsAt) {
      throw new ConflictException('Availability must end after it starts');
    }

    return this.db.tx(async (tx) => {
      let res;
      try {
        res = await tx.query<{
          id: string;
          doctor_id: string;
          starts_at: Date;
          ends_at: Date;
          slot_minutes: number;
        }>(
          `INSERT INTO scheduling_availability (doctor_id, starts_at, ends_at, slot_minutes)
           VALUES ($1, $2, $3, $4)
           RETURNING id, doctor_id, starts_at, ends_at, slot_minutes`,
          [input.doctorId ?? ctx.userId, input.startsAt, input.endsAt, input.slotMinutes ?? 30],
        );
      } catch (err) {
        // An assistant naming a doctor they do not assist lands here.
        translateRlsRefusal(err, 'Doctor not found');
      }
      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('Could not create availability');
      return {
        id: row.id,
        doctorId: row.doctor_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        slotMinutes: row.slot_minutes,
      };
    });
  }

  /**
   * Bookable slots for a doctor, as UTC instants.
   *
   * Slots already taken are excluded. This is a CONVENIENCE for the UI, not a
   * guarantee: between listing and booking, someone else may take one. The
   * exclusion constraint is what actually decides, which is why `book()` must
   * handle 23P01 rather than trusting this list.
   */
  async listOpenSlots(doctorId: string, from: Date, to: Date): Promise<{ startsAt: Date; endsAt: Date }[]> {
    return this.db.tx(async (tx) => {
      const windows = await tx.query<{ starts_at: Date; ends_at: Date; slot_minutes: number }>(
        `SELECT starts_at, ends_at, slot_minutes
         FROM scheduling_availability
         WHERE doctor_id = $1 AND ends_at > $2 AND starts_at < $3
           AND withdrawn_at IS NULL
         ORDER BY starts_at`,
        [doctorId, from, to],
      );

      const taken = await tx.query<{ starts_at: Date; ends_at: Date }>(
        `SELECT starts_at, ends_at FROM scheduling_appointments
         WHERE doctor_id = $1 AND status <> 'cancelled' AND ends_at > $2 AND starts_at < $3`,
        [doctorId, from, to],
      );

      const slots: { startsAt: Date; endsAt: Date }[] = [];
      for (const w of windows.rows) {
        const step = w.slot_minutes * 60_000;
        for (let t = w.starts_at.getTime(); t + step <= w.ends_at.getTime(); t += step) {
          const startsAt = new Date(t);
          const endsAt = new Date(t + step);
          const overlaps = taken.rows.some(
            (a) => a.starts_at.getTime() < endsAt.getTime() && a.ends_at.getTime() > startsAt.getTime(),
          );
          if (!overlaps) slots.push({ startsAt, endsAt });
        }
      }
      return slots;
    });
  }

  // -------------------------------------------------------------------------
  // P10.2 — booking
  // -------------------------------------------------------------------------

  /**
   * Book a slot.
   *
   * One transaction: insert the appointment, link the studies, emit the event.
   * If the exclusion constraint fires, exactly one concurrent caller has won
   * and everyone else gets a clean 409 — never a 500, and never a second
   * appointment.
   *
   * DECISION D2: the appointment starts at `pending_payment`. Authorisation
   * moves it to `authorised`; capture on the doctor's acceptance moves it to
   * `confirmed`. Imaging stays invisible to the receiving doctor until then
   * unless triage is enabled (D3).
   */
  async book(input: BookingInput): Promise<Appointment> {
    const ctx = requireContext();

    if (input.endsAt <= input.startsAt) {
      throw new ConflictException('Appointment must end after it starts');
    }

    return this.withContentionRetries('booking', () => this.attemptBooking(input, ctx));
  }

  /**
   * Retry the transient failures, surface the real ones.
   *
   * A deadlock (40P01) or a serialisation failure is NOT "someone else took the
   * slot": the transaction rolled back cleanly and the slot may still be free,
   * so retrying is both safe and correct. Left unhandled it propagates as a raw
   * driver error and the caller gets a 500 — exactly what P10.2 forbids.
   *
   * Shared by book and reschedule: both write the same exclusion constraint
   * under the same contention, so a reschedule without this would be the 500
   * that booking was carefully taught not to produce.
   */
  private async withContentionRetries<T>(
    what: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let lastTransient: unknown;
    for (let attempt = 1; attempt <= MAX_BOOKING_ATTEMPTS; attempt++) {
      try {
        return await operation();
      } catch (err) {
        const code = (err as { code?: string }).code;
        const transient =
          (code !== undefined && TRANSIENT_CONFLICTS.has(code)) ||
          isTransientConnectionFailure(err);
        if (transient) {
          lastTransient = err;
          // Jittered backoff. Without jitter the same set of transactions
          // collide again on the next attempt, in the same order.
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 25) + attempt * 10));
          continue;
        }
        throw err;
      }
    }

    // Exhausted retries under sustained contention. Report it as a conflict —
    // it is one, from the caller's point of view — rather than a 500.
    this.logger.warn(
      `${what} gave up after ${MAX_BOOKING_ATTEMPTS} attempts under contention: ` +
        `${(lastTransient as { code?: string })?.code ?? 'connection'}`,
    );
    // Still a clean conflict, never a raw driver error (P10.2).
    throw new SlotUnavailableError();
  }

  private async attemptBooking(
    input: BookingInput,
    ctx: ReturnType<typeof requireContext>,
  ): Promise<Appointment> {
    const appointment = await this.db.tx(async (tx: Tx) => {
      let inserted;
      try {
        inserted = await tx.query<{
          id: string;
          patient_id: string;
          doctor_id: string;
          starts_at: Date;
          ends_at: Date;
          status: string;
          kind: string;
          reason: string | null;
          notes: string | null;
        }>(
          `INSERT INTO scheduling_appointments
             (patient_id, doctor_id, starts_at, ends_at, status, kind, reason, notes, created_by)
           VALUES ($1, $2, $3, $4, 'pending_payment', $5, $6, $7, $8)
           RETURNING id, patient_id, doctor_id, starts_at, ends_at, status, kind, reason, notes`,
          [
            input.patientId,
            input.doctorId,
            input.startsAt,
            input.endsAt,
            input.kind ?? 'consultation',
            input.reason ?? null,
            input.notes ?? null,
            ctx.userId,
          ],
        );
      } catch (err) {
        // Someone else won the slot, or RLS refused the row. Either way a clean
        // conflict or a 404 — never a 500, and never a duplicate appointment.
        translateAppointmentWriteError(err, 'Patient not found');
      }

      const row = inserted.rows[0];
      if (row === undefined) throw new NotFoundException('Patient not found');

      const requested = input.studyIds ?? [];
      if (requested.length > 0) {
        // Resolve which of the requested studies the caller can actually see.
        // RLS does the deciding; this query just asks it.
        const visible = await tx.query<{ id: string }>(
          `SELECT id FROM imaging_studies WHERE id = ANY($1::uuid[])`,
          [requested],
        );
        const visibleIds = new Set(visible.rows.map((r) => r.id));

        // FAIL LOUDLY on anything unlinkable, rather than dropping it.
        //
        // Two rejected alternatives:
        //   * inserting blind — a WITH CHECK violation aborts the whole
        //     transaction, so one bad id destroys a legitimate booking;
        //   * silently skipping — the receiving doctor never gets a scan the
        //     patient believed they had shared, and nobody finds out until the
        //     consultation. That is a clinical risk, not a UX wrinkle.
        //
        // 404 rather than 403, so this cannot be used to probe which study ids
        // exist (§6).
        const missing = requested.filter((id) => !visibleIds.has(id));
        if (missing.length > 0) {
          throw new NotFoundException('Study not found');
        }

        for (const studyId of requested) {
          await tx.query(
            `INSERT INTO scheduling_appointment_studies (appointment_id, study_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [row.id, studyId],
          );
        }
      }

      return {
        id: row.id,
        patientId: row.patient_id,
        doctorId: row.doctor_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        kind: row.kind as AppointmentKind,
        reason: row.reason,
        notes: row.notes,
      };
    });

    await this.bus.publish({
      type: 'AppointmentBooked',
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      startsAt: appointment.startsAt,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return appointment;
  }

  // -------------------------------------------------------------------------
  // Reads for the UI
  //
  // NONE of these filter by caller. Every one is scoped by row-level security:
  // a patient sees their own appointments, a Tunisian doctor sees the ones
  // referred to them, and neither can widen that by changing a parameter,
  // because there is no parameter to change. Adding `WHERE patient_id =
  // $currentUser` here would look safer and would in fact be WEAKER — it would
  // move the decision out of the database and into a line of code that a later
  // refactor can drop (ADR-6).
  // -------------------------------------------------------------------------

  /**
   * Appointments visible to the caller, soonest first.
   *
   * THE ASSISTANT TAKES A DIFFERENT ROUTE, and has to. This query joins
   * `patients_patients` for the name, and there is deliberately no SELECT
   * policy on that table for an assistant (0015) — so for them this returns
   * nothing at all. `scheduling_assistant_agenda` is a SECURITY DEFINER
   * function whose RETURNS TABLE has no clinical column, which is what makes
   * "an assistant sees a name and a phone number and nothing else" a property
   * of the schema rather than of this SELECT list.
   */
  async listAppointments(range?: { from?: Date; to?: Date }): Promise<AppointmentSummary[]> {
    const ctx = requireContext();
    const from = range?.from ?? null;
    const to = range?.to ?? null;

    if (ctx.role === 'assistant') {
      return this.db.tx(async (tx) => {
        const res = await tx.query<AppointmentRow>(
          `SELECT id, patient_id, doctor_id, starts_at, ends_at, status, kind, reason, notes,
                  patient_name, doctor_name, patient_phone
           FROM scheduling_assistant_agenda($1, $2)`,
          [from, to],
        );
        return res.rows.map(toSummary);
      });
    }

    return this.db.tx(async (tx) => {
      const res = await tx.query<AppointmentRow>(
        `SELECT ${APPOINTMENT_COLUMNS}
         FROM scheduling_appointments a
         JOIN patients_patients p ON p.id = a.patient_id
         JOIN identity_users d ON d.id = a.doctor_id
         WHERE ($1::timestamptz IS NULL OR a.ends_at > $1)
           AND ($2::timestamptz IS NULL OR a.starts_at < $2)
         ORDER BY a.starts_at DESC`,
        [from, to],
      );
      return res.rows.map(toSummary);
    });
  }

  /**
   * One appointment, with its linked studies. 404 when not visible.
   *
   * An assistant gets the agenda projection and NO study ids: the linkage
   * table would return nothing for them anyway (`app_can_see_appointment`), and
   * asking would imply they were meant to have some.
   */
  async getAppointment(appointmentId: string): Promise<AppointmentSummary> {
    const ctx = requireContext();

    if (ctx.role === 'assistant') {
      return this.db.tx(async (tx) => {
        const res = await tx.query<AppointmentRow>(
          `SELECT id, patient_id, doctor_id, starts_at, ends_at, status, kind, reason, notes,
                  patient_name, doctor_name, patient_phone
           FROM scheduling_assistant_agenda(NULL, NULL) WHERE id = $1`,
          [appointmentId],
        );
        const row = res.rows[0];
        if (row === undefined) throw new NotFoundException('Appointment not found');
        return { ...toSummary(row), studyIds: [] };
      });
    }

    return this.db.tx(async (tx) => {
      const res = await tx.query<AppointmentRow>(
        `SELECT ${APPOINTMENT_COLUMNS}
         FROM scheduling_appointments a
         JOIN patients_patients p ON p.id = a.patient_id
         JOIN identity_users d ON d.id = a.doctor_id
         WHERE a.id = $1`,
        [appointmentId],
      );
      const row = res.rows[0];
      // 404 rather than 403 for a row RLS filtered: §6 requires that "does not
      // exist" and "not yours" be indistinguishable.
      if (row === undefined) throw new NotFoundException('Appointment not found');

      const studies = await tx.query<{ study_id: string }>(
        `SELECT study_id FROM scheduling_appointment_studies WHERE appointment_id = $1`,
        [appointmentId],
      );
      return { ...toSummary(row), studyIds: studies.rows.map((s) => s.study_id) };
    });
  }

  /**
   * Verified Tunisian doctors, for the patient's choice of referral.
   *
   * `verified_at IS NOT NULL` is not cosmetic. The decisions file records that
   * a Tunisian doctor's access is a restricted transfer under Chapter V, and
   * that verified_at must not be set without the transfer safeguards in place.
   * Filtering on it here means an unverified doctor cannot be selected, so no
   * imaging can be routed to one.
   */
  async listDoctors(): Promise<DoctorSummary[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        full_name: string;
        specialty: string | null;
        clinic_name: string | null;
      }>(
        `SELECT u.id, u.full_name, p.specialty, p.clinic_name
         FROM identity_users u
         JOIN identity_doctor_profiles p ON p.user_id = u.id
         WHERE u.role = 'tunisia_doctor'
           AND u.status = 'active'
           AND p.verified_at IS NOT NULL
         ORDER BY u.full_name`,
      );
      return res.rows.map((r) => ({
        id: r.id,
        displayName: r.full_name,
        specialty: r.specialty,
        city: r.clinic_name,
      }));
    });
  }

  /**
   * Published availability windows the caller can see.
   *
   * No WHERE on the doctor: RLS scopes it, so a doctor gets their own and an
   * assistant gets those of the doctors they are seated with. `doctorId`
   * narrows that further for an assistant looking at one calendar — it cannot
   * widen it, because the policy still applies.
   */
  async listAvailability(doctorId?: string): Promise<AvailabilityWindow[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        doctor_id: string;
        starts_at: Date;
        ends_at: Date;
        slot_minutes: number;
      }>(
        `SELECT id, doctor_id, starts_at, ends_at, slot_minutes
         FROM scheduling_availability
         WHERE withdrawn_at IS NULL
           AND ($1::uuid IS NULL OR doctor_id = $1)
         ORDER BY starts_at`,
        [doctorId ?? null],
      );
      return res.rows.map((r) => ({
        id: r.id,
        doctorId: r.doctor_id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        slotMinutes: r.slot_minutes,
      }));
    });
  }

  /**
   * Take a window back down.
   *
   * An UPDATE, not a DELETE — the application holds no DELETE grant anywhere
   * (0002), and a window that was once advertised is worth keeping on the
   * record. REFUSES while appointments still stand in it: silently withdrawing
   * the hours around a booked patient would leave an appointment nobody's
   * calendar admits to, which is the failure mode this whole module exists to
   * avoid. Cancel them first, deliberately.
   */
  async withdrawAvailability(windowId: string): Promise<void> {
    const booked = await this.db.tx(async (tx) => {
      const res = await tx.query<{ n: string }>(
        `SELECT count(*) AS n
         FROM scheduling_appointments a
         JOIN scheduling_availability w ON w.id = $1
         WHERE a.doctor_id = w.doctor_id
           AND a.status <> 'cancelled'
           AND a.starts_at < w.ends_at
           AND a.ends_at > w.starts_at`,
        [windowId],
      );
      return Number(res.rows[0]?.n ?? '0');
    });

    if (booked > 0) {
      throw new ConflictException('Cancel the appointments in this window first');
    }

    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_availability SET withdrawn_at = now()
         WHERE id = $1 AND withdrawn_at IS NULL`,
        [windowId],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Availability window not found');
  }

  // -------------------------------------------------------------------------
  // Recurring availability (P10.1's "recurring and one-off").
  // -------------------------------------------------------------------------

  /**
   * Publish a weekly rule, and generate its windows out to the horizon.
   *
   * Generation happens here rather than lazily so that everything downstream —
   * the slot picker, the exclusion constraint, the calendar — keeps reading one
   * representation. `scheduling_materialise_rule` is SECURITY INVOKER, so the
   * generated rows are subject to the same policies as a hand-entered window.
   */
  async addAvailabilityRule(input: {
    weekday: number;
    startTime: string;
    endTime: string;
    timezone: string;
    slotMinutes?: number;
    validFrom?: Date;
    validUntil?: Date;
    doctorId?: string;
  }): Promise<{ id: string; generated: number }> {
    const ctx = requireContext();

    const id = await this.db.tx(async (tx) => {
      let res;
      try {
        res = await tx.query<{ id: string }>(
        `INSERT INTO scheduling_availability_rules
           (doctor_id, weekday, start_time, end_time, timezone, slot_minutes,
            valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE), $8)
         RETURNING id`,
        [
          input.doctorId ?? ctx.userId,
          input.weekday,
          input.startTime,
          input.endTime,
          input.timezone,
          input.slotMinutes ?? 30,
          input.validFrom ?? null,
          input.validUntil ?? null,
        ],
        );
      } catch (err) {
        translateRlsRefusal(err, 'Doctor not found');
      }
      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('Could not create availability rule');
      return row.id;
    });

    const generated = await this.materialiseRule(id);
    return { id, generated };
  }

  /** Generate a rule's windows out to the rolling horizon. Idempotent. */
  async materialiseRule(ruleId: string): Promise<number> {
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + AVAILABILITY_HORIZON_DAYS);
    return this.db.tx(async (tx) => {
      const res = await tx.query<{ scheduling_materialise_rule: number }>(
        'SELECT scheduling_materialise_rule($1, $2::date)',
        [ruleId, horizon.toISOString().slice(0, 10)],
      );
      return res.rows[0]?.scheduling_materialise_rule ?? 0;
    });
  }

  async listAvailabilityRules(doctorId?: string): Promise<AvailabilityRule[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        doctor_id: string;
        weekday: number;
        start_time: string;
        end_time: string;
        timezone: string;
        slot_minutes: number;
        valid_from: Date;
        valid_until: Date | null;
      }>(
        `SELECT id, doctor_id, weekday, start_time, end_time, timezone, slot_minutes,
                valid_from, valid_until
         FROM scheduling_availability_rules
         WHERE withdrawn_at IS NULL
           AND ($1::uuid IS NULL OR doctor_id = $1)
         ORDER BY weekday, start_time`,
        [doctorId ?? null],
      );
      return res.rows.map((r) => ({
        id: r.id,
        doctorId: r.doctor_id,
        weekday: r.weekday,
        startTime: r.start_time,
        endTime: r.end_time,
        timezone: r.timezone,
        slotMinutes: r.slot_minutes,
        validFrom: r.valid_from,
        validUntil: r.valid_until,
      }));
    });
  }

  /**
   * Withdraw a rule and its FUTURE windows.
   *
   * Past windows stay: they record hours that really were advertised. Future
   * ones that already carry an appointment stay too — withdrawing the rule
   * means "stop offering this", not "cancel everyone booked into it", and
   * silently dropping a patient's confirmed slot is not a thing a schedule
   * editor should be able to do as a side effect.
   */
  async withdrawAvailabilityRule(ruleId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_availability_rules SET withdrawn_at = now()
         WHERE id = $1 AND withdrawn_at IS NULL`,
        [ruleId],
      );
      if ((res.rowCount ?? 0) > 0) {
        await tx.query(
          `UPDATE scheduling_availability w
           SET withdrawn_at = now()
           WHERE w.rule_id = $1
             AND w.withdrawn_at IS NULL
             AND w.starts_at > now()
             AND NOT EXISTS (
               SELECT 1 FROM scheduling_appointments a
               WHERE a.doctor_id = w.doctor_id
                 AND a.status <> 'cancelled'
                 AND a.starts_at < w.ends_at
                 AND a.ends_at > w.starts_at
             )`,
          [ruleId],
        );
      }
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Availability rule not found');
  }

  /**
   * The receiving doctor declines a referral.
   *
   * Distinct from cancel() only in intent, but the distinction matters to the
   * patient: a declined referral must release the authorisation so they are
   * not charged and the held funds return. The release itself is billing's
   * job, triggered off the resulting state.
   */
  /**
   * The receiving doctor accepts the referral.
   *
   * This lived in the billing module until migration 0021, because accepting
   * used to CAPTURE the patient's card and the code that moved money owned the
   * transition. There is no card and no patient, so acceptance is what it
   * always actually was: a scheduling decision by the doctor who will do the
   * read.
   *
   * The status guard is what makes it idempotent — a second accept matches no
   * row, and an accept on a cancelled appointment does not resurrect it.
   */
  async accept(appointmentId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'confirmed'
         WHERE id = $1 AND status NOT IN ('cancelled', 'completed', 'confirmed')`,
        [appointmentId],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Appointment not found');
  }

  async decline(appointmentId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'cancelled'
         WHERE id = $1 AND status IN ('pending_payment', 'authorised')`,
        [appointmentId],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Appointment not found');
  }

  /** Cancel an appointment, freeing the slot for someone else. */
  async cancel(appointmentId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'cancelled'
         WHERE id = $1 AND status <> 'cancelled'`,
        [appointmentId],
      );
      return res.rowCount ?? 0;
    });

    if (changed === 0) throw new NotFoundException('Appointment not found');
  }

  // -------------------------------------------------------------------------
  // Running the diary — the verbs a practice needs and the referral flow never
  // did. Every one of these leans on RLS for "may this caller touch this row":
  // there is no ownership check here, and `rowCount === 0` is the answer to
  // both "no such appointment" and "not yours", which §6 requires be
  // indistinguishable.
  // -------------------------------------------------------------------------

  /**
   * Move an appointment to a different time.
   *
   * Goes through the same retry-and-translate path as booking because it writes
   * the same exclusion constraint: rescheduling onto a taken slot is a 409, and
   * losing a deadlock is a retry, not a 500.
   */
  async reschedule(
    appointmentId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<AppointmentSummary> {
    if (endsAt <= startsAt) {
      throw new ConflictException('Appointment must end after it starts');
    }

    await this.withContentionRetries('reschedule', async () => {
      const changed = await this.db.tx(async (tx) => {
        try {
          const res = await tx.query(
            `UPDATE scheduling_appointments
             SET starts_at = $2, ends_at = $3
             WHERE id = $1 AND status IN ('pending_payment','authorised','confirmed')`,
            [appointmentId, startsAt, endsAt],
          );
          return res.rowCount ?? 0;
        } catch (err) {
          translateAppointmentWriteError(err, 'Appointment not found');
        }
      });
      // A finished appointment is not reschedulable, and neither is one the
      // caller cannot see. Both arrive here as zero rows.
      if (changed === 0) throw new NotFoundException('Appointment not found');
      return changed;
    });

    const updated = await this.getAppointment(appointmentId);

    await this.bus.publish({
      type: 'AppointmentRescheduled',
      appointmentId,
      patientId: updated.patientId,
      doctorId: updated.doctorId,
      startsAt,
      ...this.actorFields(),
    });

    return updated;
  }

  /**
   * The visit happened.
   *
   * Only from `confirmed`, and only once the appointment has actually started —
   * marking tomorrow's consultation complete is a data-entry slip, not a
   * workflow, and allowing it makes the no-show statistics meaningless.
   */
  async markCompleted(appointmentId: string): Promise<void> {
    await this.transition(appointmentId, 'completed', "status = 'confirmed' AND starts_at <= now()");
  }

  /** The patient did not arrive. Distinct from a cancellation: the slot was lost. */
  async markNoShow(appointmentId: string): Promise<void> {
    await this.transition(appointmentId, 'no_show', "status = 'confirmed' AND starts_at <= now()");
  }

  /**
   * The practice cancels, with a reason.
   *
   * Separate from `cancel()` (the patient changing their mind) and from
   * `decline()` (refusing a referral) because the reason is the point: a
   * patient told only "cancelled" cannot tell a clinic closure from their own
   * booking having lapsed.
   */
  async cancelAsDoctor(appointmentId: string, reason?: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'cancelled', cancel_reason = $2
         WHERE id = $1 AND status <> 'cancelled'`,
        [appointmentId, reason ?? null],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Appointment not found');

    const appointment = await this.getAppointment(appointmentId);
    await this.bus.publish({
      type: 'AppointmentCancelled',
      appointmentId,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      startsAt: appointment.startsAt,
      ...(reason === undefined ? {} : { reason }),
      ...this.actorFields(),
    });
  }

  /** Scheduling detail that is not a time change — reason, kind, notes. */
  async updateAppointment(
    appointmentId: string,
    patch: { kind?: AppointmentKind; reason?: string | null; notes?: string | null },
  ): Promise<AppointmentSummary> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET kind   = COALESCE($2, kind),
             reason = CASE WHEN $3::boolean THEN $4 ELSE reason END,
             notes  = CASE WHEN $5::boolean THEN $6 ELSE notes  END
         WHERE id = $1`,
        [
          appointmentId,
          patch.kind ?? null,
          patch.reason !== undefined,
          patch.reason ?? null,
          patch.notes !== undefined,
          patch.notes ?? null,
        ],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Appointment not found');
    return this.getAppointment(appointmentId);
  }

  /** One status move, guarded by the states it is legal from. */
  private async transition(
    appointmentId: string,
    to: string,
    fromCondition: string,
  ): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments SET status = $2 WHERE id = $1 AND ${fromCondition}`,
        [appointmentId, to],
      );
      return res.rowCount ?? 0;
    });
    // Not visible, no such row, or not in a state this move is legal from.
    if (changed === 0) throw new NotFoundException('Appointment not found');
  }

  /**
   * The audit fields every domain event carries, read from the request scope.
   *
   * `ipAddress` and `userAgent` are always PRESENT and sometimes undefined,
   * matching DomainEventBase — spreading them away when absent would make the
   * object structurally incompatible with the event union.
   */
  private actorFields(): Pick<
    DomainEventBase,
    'actorId' | 'actorRole' | 'occurredAt' | 'requestId' | 'ipAddress' | 'userAgent'
  > {
    const ctx = requireContext();
    return {
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    };
  }

  /**
   * Emit a reminder for each appointment starting inside the lead time.
   *
   * THE CLAIM AND THE SELECT ARE ONE STATEMENT. `UPDATE ... RETURNING` marks
   * `reminder_sent_at` and hands back the rows it marked, so two concurrent
   * sweeps cannot both claim the same appointment: the second sees zero rows.
   * Selecting first and updating after would be the obvious shape and would
   * send some patients two reminders.
   *
   * Marked BEFORE the event is published, deliberately. If publishing fails,
   * the reminder is lost — and that is the better failure: the alternative
   * ordering loses the mark instead and re-notifies every patient on the next
   * tick, forever.
   */
  async sendDueReminders(leadHours: number): Promise<number> {
    const due = await this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        patient_id: string;
        doctor_id: string;
        starts_at: Date;
      }>(
        `UPDATE scheduling_appointments
         SET reminder_sent_at = now()
         WHERE reminder_sent_at IS NULL
           AND status = 'confirmed'
           AND starts_at > now()
           AND starts_at <= now() + ($1 || ' hours')::interval
         RETURNING id, patient_id, doctor_id, starts_at`,
        [String(leadHours)],
      );
      return res.rows;
    });

    for (const row of due) {
      await this.bus.publish({
        type: 'AppointmentReminderDue',
        appointmentId: row.id,
        patientId: row.patient_id,
        doctorId: row.doctor_id,
        startsAt: row.starts_at,
        ...this.actorFields(),
      });
    }

    return due.length;
  }

  /**
   * Release appointments whose payment authorisation expired (DECISION D2).
   *
   * An authorisation that is never captured must not hold a slot forever —
   * that is a slot no other patient can book while no money will ever move.
   *
   * The status is `cancelled`, and `cancel_reason` is what distinguishes this
   * from a patient changing their mind. The web client used to carry an
   * `expired` status for the difference, which no query could ever return
   * because nothing writes it — so the branch reading it was dead, and a
   * patient whose payment window lapsed was told, indistinguishably, that
   * their appointment had been cancelled.
   */
  async releaseExpiredAuthorisations(): Promise<number> {
    const windowHours = this.config.PAYMENT_AUTHORIZATION_WINDOW_HOURS;
    return this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'cancelled', cancel_reason = 'authorisation_expired'
         WHERE status IN ('pending_payment', 'authorised')
           AND created_at < now() - ($1 || ' hours')::interval`,
        [String(windowHours)],
      );
      return res.rowCount ?? 0;
    });
  }
}
