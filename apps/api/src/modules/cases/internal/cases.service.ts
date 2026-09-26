import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import { requireContext, runWithContext, systemContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import type { PageRequest } from '../../../shared/http/pagination';
import type { DomainEventBase } from '../../../shared/events/domain-events';
import { EventBus } from '../../../shared/events/event-bus';
import { LedgerService } from '../../ledger';
import { PricingService } from '../../pricing';

/**
 * The consult lifecycle — consult-model spec Part 1.
 *
 * A lab submits a case, picks a doctor who is accepting, pays the price this
 * module locked, and the doctor accepts and answers it. There are no slots and
 * no calendar: the gist exclusion constraint that made two overlapping
 * appointments impossible went with them in migration 0025, because with
 * nothing to double-book there is no contended resource left to guard.
 *
 * WHAT REPLACED IT IS THE STATUS GUARD. Every verb here is a conditional
 * UPDATE naming the state it is legal from, so a repeated call matches no row
 * rather than repeating an effect, and two callers racing the same transition
 * cannot both win. A rowCount of zero answers "no such case", "not yours" and
 * "not in that state" identically, which is what §6 requires of the first two.
 *
 * All times are timestamptz in UTC (§6).
 */

const UNIQUE_VIOLATION = '23505';

export interface SubmitInput {
  patientId: string;
  specialty: string;
  /** Studies to share with this case. Consent is still required (P5.3). */
  studyIds?: string[];
  reason?: string;
  notes?: string;
  /**
   * The client's key for this one submission, reused on its retries. A repeat
   * returns the case the first request created (migration 0036).
   */
  idempotencyKey?: string;
}

export interface Case {
  id: string;
  patientId: string;
  doctorId: string | null;
  organisationId: string;
  specialty: string;
  status: string;
  /** Why the case was referred — clinical context, never a finding. */
  reason: string | null;
  notes: string | null;
  quotedAmountMinor: number | null;
  quotedCurrency: string | null;
  /** The consult split locked at quote (spec 2026-09-21 §3). Null before a quote. */
  clinicShareMinor: number | null;
  doctorShareMinor: number | null;
  quoteExpiresAt: Date | null;
  acceptedAt: Date | null;
  answeredAt: Date | null;
  answerDueAt: Date | null;
}

/** A case plus the names the UI needs, so it need not fan out. */
export interface CaseSummary extends Case {
  /** MIR-YYYY-NNNN — what a clinic reads over the phone. Empty for the assistant agenda. */
  caseRef: string;
  createdAt: Date;
  quotedAt: Date | null;
  /** The latest instant the row records: created, quoted, accepted, answered, or closed. */
  updatedAt: Date;
  patientName: string | null;
  doctorName: string | null;
  /**
   * What the receiving doctor gets instead of an identity — sub-project 2.
   * Null for the lab, which holds the identity and reads the record directly.
   */
  patientAgeYears: number | null;
  patientSex: string | null;
  /**
   * Present only on the assistant's agenda. A receptionist rings the patient;
   * a doctor opens the record, so nothing else needs it here.
   */
  patientPhone?: string;
  studyIds?: string[];
}

interface CaseRow {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  organisation_id: string;
  specialty: string;
  status: string;
  reason: string | null;
  notes: string | null;
  quoted_amount_minor: string | null;
  quoted_currency: string | null;
  clinic_share_minor?: string | null;
  doctor_share_minor?: string | null;
  quote_expires_at: Date | null;
  accepted_at: Date | null;
  answered_at: Date | null;
  answer_due_at: Date | null;
  patient_name: string | null;
  doctor_name: string | null;
  case_ref?: string | null;
  created_at?: Date | null;
  quoted_at?: Date | null;
  updated_at?: Date | null;
  patient_age_years?: number | null;
  patient_sex?: string | null;
  patient_phone?: string;
}

function toSummary(row: CaseRow): CaseSummary {
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    organisationId: row.organisation_id,
    specialty: row.specialty,
    status: row.status,
    reason: row.reason,
    notes: row.notes,
    // bigint arrives as a string from pg; Number() only after the null check so
    // a missing quote stays null rather than becoming 0, which would read as a
    // free consult.
    quotedAmountMinor: row.quoted_amount_minor === null ? null : Number(row.quoted_amount_minor),
    quotedCurrency: row.quoted_currency,
    clinicShareMinor: row.clinic_share_minor == null ? null : Number(row.clinic_share_minor),
    doctorShareMinor: row.doctor_share_minor == null ? null : Number(row.doctor_share_minor),
    quoteExpiresAt: row.quote_expires_at,
    acceptedAt: row.accepted_at,
    answeredAt: row.answered_at,
    answerDueAt: row.answer_due_at,
    caseRef: row.case_ref ?? '',
    createdAt: row.created_at ?? new Date(0),
    quotedAt: row.quoted_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? new Date(0),
    patientName: row.patient_name,
    patientAgeYears: row.patient_age_years ?? null,
    patientSex: row.patient_sex ?? null,
    doctorName: row.doctor_name,
    ...(row.patient_phone === undefined ? {} : { patientPhone: row.patient_phone }),
  };
}

/** The columns every case read shares. */
const CASE_COLUMNS = `a.id, a.patient_id, a.doctor_id, a.organisation_id, a.specialty,
                a.status, a.reason, a.notes,
                a.quoted_amount_minor, a.quoted_currency, a.quote_expires_at,
                a.clinic_share_minor, a.doctor_share_minor,
                a.accepted_at, a.answered_at, a.answer_due_at,
                a.case_ref, a.created_at, a.quoted_at,
                GREATEST(a.created_at, a.quoted_at, a.accepted_at, a.answered_at, a.terminal_at)
                  AS updated_at,
                p.full_name AS patient_name, d.full_name AS doctor_name`;

/**
 * Translate a failed write on `cases_cases` into an HTTP answer.
 *
 * 42501 is PostgreSQL's "insufficient privilege" — RLS refusing the row.
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

export function translateCaseWriteError(err: unknown, notFound: string): never {
  const code = (err as { code?: string }).code;
  // 23505 is the ledger's one-fee-per-case index, or a repeated study link.
  // Both mean "already recorded", which is a conflict rather than a failure.
  if (code === UNIQUE_VIOLATION) {
    throw new ConflictException('That change has already been recorded');
  }
  if (code === RLS_REFUSED) {
    throw new NotFoundException(notFound);
  }
  throw err;
}

/**
 * The audit fields every domain event carries, read from the request scope.
 *
 * `ipAddress` and `userAgent` are always PRESENT and sometimes undefined,
 * matching DomainEventBase — spreading them away when absent would make the
 * object structurally incompatible with the event union.
 */
export function actorFields(): Pick<
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

@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly pricing: PricingService,
  ) {}

  // -------------------------------------------------------------------------
  // P10.1 — availability
  // -------------------------------------------------------------------------



  // -------------------------------------------------------------------------
  // Reads for the UI
  //
  // NONE of these filter by caller. Every one is scoped by row-level security:
  // a referring clinic sees its own cases, a receiving doctor sees the ones
  // sent to them, and neither can widen that by changing a parameter,
  // because there is no parameter to change. Adding `WHERE patient_id =
  // $currentUser` here would look safer and would in fact be WEAKER — it would
  // move the decision out of the database and into a line of code that a later
  // refactor can drop (ADR-6).
  // -------------------------------------------------------------------------

  /**
   * Submit a case. No doctor and no price yet — both arrive together at quote,
   * because the doctor's earned tier is a term in the price.
   *
   * The organisation is resolved from the caller's membership rather than taken
   * from the request: who owes for a case is not something the requester gets
   * to assert.
   */
  async submit(input: SubmitInput): Promise<CaseSummary> {
    const ctx = requireContext();
    const { id, replay } = await this.db.txAs(ctx, async (tx) => {
      const org = await tx.query<{ id: string }>(
        `SELECT o.id
           FROM identity_memberships m
           JOIN identity_organisations o ON o.id = m.organisation_id
          WHERE m.user_id = $1 AND o.side = 'source'
          LIMIT 1`,
        [ctx.userId],
      );
      const orgId = org.rows[0]?.id;
      if (orgId === undefined) {
        throw new ConflictException('Your account is not seated in a referring organisation');
      }

      const res = await tx
        .query<{ id: string }>(
          `INSERT INTO cases_cases
             (patient_id, organisation_id, specialty, status, reason, notes, created_by,
              idempotency_key)
           VALUES ($1, $2, $3, 'submitted', $4, $5, $6, $7)
           ON CONFLICT (created_by, idempotency_key) WHERE idempotency_key IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [
            input.patientId,
            orgId,
            input.specialty,
            input.reason ?? null,
            input.notes ?? null,
            ctx.userId,
            input.idempotencyKey ?? null,
          ],
        )
        .catch((err: unknown) => translateCaseWriteError(err, 'Patient not found'));

      const row = res.rows[0];
      if (row === undefined && input.idempotencyKey !== undefined) {
        // A retry of a submission that already went through: answer with that
        // case, and link no studies and announce nothing a second time.
        const first = await tx.query<{ id: string }>(
          `SELECT id FROM cases_cases WHERE created_by = $1 AND idempotency_key = $2`,
          [ctx.userId, input.idempotencyKey],
        );
        const firstId = first.rows[0]?.id;
        if (firstId === undefined) throw new NotFoundException('Patient not found');
        return { id: firstId, replay: true };
      }
      if (row === undefined) throw new NotFoundException('Patient not found');

      for (const studyId of input.studyIds ?? []) {
        await tx
          .query(`INSERT INTO cases_case_studies (case_id, study_id) VALUES ($1, $2)`, [
            row.id,
            studyId,
          ])
          .catch((err: unknown) => translateCaseWriteError(err, 'Study not found'));
      }
      return { id: row.id, replay: false };
    });

    const item = await this.getCase(id);
    if (replay) return item;
    await this.bus.publish({
      type: 'CaseSubmitted',
      caseId: id,
      patientId: item.patientId,
      organisationId: item.organisationId,
      specialty: item.specialty,
      ...actorFields(),
    });
    return item;
  }

  /**
   * Lock a price against one doctor.
   *
   * QUOTING AND CHOOSING ARE ONE ACT. The doctor's earned tier is a term in the
   * price, so there is no price to quote before a doctor is picked — and the
   * pick is therefore what this verb records.
   *
   * WHY `accepting_cases` IS CHECKED HERE AND NOT ONLY IN THE UI. It is the
   * doctor's consent to receive work. A lab holding a stale directory page, or
   * calling the API directly, must not be able to push a case at a doctor who
   * has switched off.
   */
  async quote(caseId: string, doctorId: string): Promise<CaseSummary> {
    const current = await this.getCase(caseId);
    // 'quoted' is legal from 'submitted' and from 'declined' — a refusal sends
    // the case back to the lab to be re-quoted against someone else, and the
    // new doctor's tier may differ from the one the hold was taken against.
    if (current.status !== 'submitted' && current.status !== 'declined') {
      throw new ConflictException(`A case in '${current.status}' cannot be quoted`);
    }

    const org = await this.db.tx(async (tx) => {
      const res = await tx.query<{ corridor_id: string }>(
        `SELECT corridor_id FROM identity_organisations WHERE id = $1`,
        [current.organisationId],
      );
      return res.rows[0]?.corridor_id;
    });
    if (org === undefined) throw new NotFoundException('Case not found');

    // Throws SpecialtyClosedError (409) when nobody is accepting, which is the
    // same answer the directory would have given — the lab's page was stale.
    const quote = await this.pricing.quoteFor({
      corridorId: org,
      specialty: current.specialty,
      doctorId,
    });

    const changed = await this.db.tx(async (tx) => {
      // Checked twice, deliberately, and for two different reasons. Here, so
      // the lab is told WHICH thing went wrong; and again in the UPDATE's WHERE
      // clause, so a doctor who switches off between the two cannot be handed
      // the case regardless.
      const accepting = await tx.query<{ ok: boolean }>(`SELECT cases_doctor_accepting($1) AS ok`, [
        doctorId,
      ]);
      if (accepting.rows[0]?.ok !== true) {
        throw new ConflictException('That doctor is not accepting cases');
      }

      const res = await tx.query(
        `UPDATE cases_cases
            SET doctor_id = $2,
                quoted_amount_minor = $3,
                quoted_currency = $4,
                quoted_at = now(),
                quote_expires_at = now() + ($5 || ' minutes')::interval,
                -- The split is locked with the price (spec 2026-09-21 §3):
                -- payment and payout read these, never the price table.
                clinic_share_minor = $6,
                doctor_share_minor = $7,
                status = 'quoted'
          WHERE id = $1
            AND status IN ('submitted', 'declined')
            AND cases_doctor_accepting($2)`,
        [
          caseId,
          doctorId,
          quote.amountMinor,
          quote.currency,
          this.config.CASES_QUOTE_TTL_MINUTES,
          quote.clinicShareMinor,
          quote.doctorShareMinor,
        ],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Case not found');

    return this.getCase(caseId);
  }

  /**
   * The payment gate. It reads the STORED price and never recomputes one.
   *
   * A price that moves between the screen and the charge is a dispute the
   * platform loses, and re-deriving the number here is exactly how that
   * happens: the doctor's tier or the surge rung can both change in the
   * seconds between a quote and a card being confirmed.
   *
   * The expiry is in the WHERE clause rather than in a branch above it, so a
   * quote cannot lapse between the check and the write.
   */
  async markPaid(caseId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE cases_cases
            SET status = 'paid'
          WHERE id = $1 AND status = 'quoted' AND quote_expires_at > now()`,
        [caseId],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) {
      throw new ConflictException('This quote has lapsed; request a new one');
    }

    // The referring clinic's remittance fee. Accrued on payment rather than
    // on submission: a case the lab abandons before paying costs it nothing.
    //
    // As the system role: the ledger's INSERT policy admits nobody else, so
    // run as the clinic this silently accrued nothing. The caller has already
    // proved the right to move the case; the entry is the platform's record.
    await runWithContext(systemContext('case-accrual'), () =>
      this.ledger.accrueClinicRemittance(caseId),
    );
  }

  /**
   * Cases visible to the caller, newest first.
   *
   * THE ASSISTANT TAKES A DIFFERENT ROUTE, and has to. This query joins
   * `patients_patients` for the name, and there is deliberately no SELECT
   * policy on that table for an assistant (0015) — so for them this returns
   * nothing at all. `scheduling_assistant_agenda` is a SECURITY DEFINER
   * function whose RETURNS TABLE has no clinical column, which is what makes
   * "an assistant sees a name and a phone number and nothing else" a property
   * of the schema rather than of this SELECT list.
   */
  /**
   * `page` bounds the read (see shared/http/pagination.ts). Callers that pass
   * one get up to `limit + 1` rows, the extra one only marking a next page.
   * The assistant agenda is date-ranged by its function and not paged.
   */
  async listCases(
    range?: { from?: Date; to?: Date },
    page?: PageRequest,
  ): Promise<CaseSummary[]> {
    const ctx = requireContext();
    const from = range?.from ?? null;
    const to = range?.to ?? null;

    if (ctx.role === 'assistant') {
      return this.db.tx(async (tx) => {
        const res = await tx.query<CaseRow>(
          `SELECT id, patient_id, doctor_id, status, specialty, reason, notes,
                  patient_name, doctor_name, patient_phone,
                  NULL::uuid   AS organisation_id,
                  NULL::bigint AS quoted_amount_minor,
                  NULL::text   AS quoted_currency,
                  NULL::timestamptz AS quote_expires_at,
                  NULL::timestamptz AS accepted_at,
                  NULL::timestamptz AS answered_at,
                  NULL::timestamptz AS answer_due_at
           FROM scheduling_assistant_agenda($1, $2)`,
          [from, to],
        );
        return res.rows.map(toSummary);
      });
    }

    return this.db.tx(async (tx) => {
      const res = await tx.query<CaseRow>(
        `SELECT ${CASE_COLUMNS},
                b.age_years AS patient_age_years, b.sex AS patient_sex
         FROM cases_cases a
         LEFT JOIN patients_patients p ON p.id = a.patient_id
         LEFT JOIN identity_users d ON d.id = a.doctor_id
         -- The same projection getCase reads: the receiving doctor's worklist
         -- shows age and sex, never a name (migration 0028).
         LEFT JOIN LATERAL cases_patient_brief(a.id) b ON true
         WHERE ($1::timestamptz IS NULL OR a.created_at >= $1)
           AND ($2::timestamptz IS NULL OR a.created_at < $2)
           AND ($3::uuid IS NULL OR (a.created_at, a.id) <
                (SELECT c.created_at, c.id FROM cases_cases c WHERE c.id = $3))
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $4`,
        [from, to, page?.after ?? null, page === undefined ? null : page.limit + 1],
      );
      return res.rows.map(toSummary);
    });
  }

  /**
   * One case, with its linked studies. 404 when not visible.
   *
   * An assistant gets the agenda projection and NO study ids: the linkage
   * table would return nothing for them anyway (`app_can_see_case`), and
   * asking would imply they were meant to have some.
   */
  async getCase(caseId: string): Promise<CaseSummary> {
    const ctx = requireContext();

    if (ctx.role === 'assistant') {
      return this.db.tx(async (tx) => {
        const res = await tx.query<CaseRow>(
          `SELECT id, patient_id, doctor_id, status, specialty, reason, notes,
                  patient_name, doctor_name, patient_phone,
                  NULL::uuid   AS organisation_id,
                  NULL::bigint AS quoted_amount_minor,
                  NULL::text   AS quoted_currency,
                  NULL::timestamptz AS quote_expires_at,
                  NULL::timestamptz AS accepted_at,
                  NULL::timestamptz AS answered_at,
                  NULL::timestamptz AS answer_due_at
           FROM scheduling_assistant_agenda(NULL, NULL) WHERE id = $1`,
          [caseId],
        );
        const row = res.rows[0];
        if (row === undefined) throw new NotFoundException('Case not found');
        return { ...toSummary(row), studyIds: [] };
      });
    }

    return this.db.tx(async (tx) => {
      const res = await tx.query<CaseRow>(
        `SELECT ${CASE_COLUMNS},
                b.age_years AS patient_age_years, b.sex AS patient_sex
         FROM cases_cases a
         LEFT JOIN patients_patients p ON p.id = a.patient_id
         LEFT JOIN identity_users d ON d.id = a.doctor_id
         -- ON true, and LEFT: cases_patient_brief returns no row for the lab
         -- side, and an inner join would drop the whole case rather than the
         -- projection. The lab reads the patient record directly anyway.
         LEFT JOIN LATERAL cases_patient_brief(a.id) b ON true
         WHERE a.id = $1`,
        [caseId],
      );
      const row = res.rows[0];
      // 404 rather than 403 for a row RLS filtered: §6 requires that "does not
      // exist" and "not yours" be indistinguishable.
      if (row === undefined) throw new NotFoundException('Case not found');

      const studies = await tx.query<{ study_id: string }>(
        `SELECT study_id FROM cases_case_studies WHERE case_id = $1`,
        [caseId],
      );
      return { ...toSummary(row), studyIds: studies.rows.map((s) => s.study_id) };
    });
  }




  // -------------------------------------------------------------------------
  // Recurring availability (P10.1's "recurring and one-off").
  // -------------------------------------------------------------------------





  /**
   * The receiving doctor declines a referral.
   *
   * Writes `declined`, not `cancelled`. The two used to collapse because the
   * only thing that turned on the difference was releasing the patient's card
   * authorisation, and cancelled released it just as well. Migration 0023 keeps
   * them apart because the referring clinic reads them differently — a refusal
   * is a signal to send the case elsewhere, a cancellation is their own
   * withdrawal — and because they accrue differently.
   *
   * A declined case can be quoted again, which is what makes a refusal cheap:
   * the lab picks another doctor and is re-quoted at that doctor's tier.
   */
  /**
   * The receiving doctor accepts the case.
   *
   * This lived in the billing module until migration 0021, because accepting
   * used to CAPTURE the patient's card and the code that moved money owned the
   * transition. There is no card and no patient, so acceptance is what it
   * always actually was: a decision by the doctor who will do the read.
   *
   * The status guard is what makes it idempotent — a second accept matches no
   * row, and an accept on a cancelled case does not resurrect it.
   */
  async accept(caseId: string): Promise<void> {
    const accepted = await this.db.tx(async (tx) => {
      const res = await tx.query<{ patient_id: string; doctor_id: string }>(
        `UPDATE cases_cases
         SET status = 'accepted',
             accepted_at = now(),
             -- The clock starts HERE, not at payment. A doctor is answerable
             -- for a case from the moment they take it, and a window that ran
             -- from payment would punish them for a lab that paid on Friday.
             answer_due_at = now() + ($2 || ' hours')::interval
         WHERE id = $1 AND status = 'paid'
         RETURNING patient_id, doctor_id`,
        [caseId, this.config.CASES_ANSWER_WINDOW_HOURS],
      );
      return res.rows[0];
    });
    if (accepted === undefined) throw new NotFoundException('Case not found');

    // Published where PaymentSucceeded used to be. The card's capture is what
    // told audit and notifications a booking was confirmed; the doctor's
    // acceptance says it now. Emitted only when a row actually changed, so a
    // repeated accept does not send a second confirmation.
    await this.bus.publish({
      type: 'CaseAccepted',
      caseId,
      patientId: accepted.patient_id,
      doctorId: accepted.doctor_id,
      ...actorFields(),
    });
  }

  async decline(caseId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query<{ patient_id: string; doctor_id: string }>(
        `UPDATE cases_cases
         SET status = 'declined', terminal_at = now()
         WHERE id = $1 AND status = 'paid'
         RETURNING patient_id, doctor_id`,
        [caseId],
      );
      return res.rows[0];
    });
    if (changed === undefined) throw new NotFoundException('Case not found');

    // No fee either way. The destination side's coordination fee accrues on
    // ACCEPTANCE, so a refusal costs the doctor's organisation nothing — and
    // the lab's payment hold stays open for whoever they pick next.
    await this.bus.publish({
      type: 'CaseDeclined',
      caseId,
      patientId: changed.patient_id,
      doctorId: changed.doctor_id,
      ...actorFields(),
    });
  }

  /** The referring side withdraws the case. */
  async cancel(caseId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE cases_cases
         SET status = 'cancelled', terminal_at = now()
         WHERE id = $1 AND status <> 'cancelled'`,
        [caseId],
      );
      return res.rowCount ?? 0;
    });

    if (changed === 0) throw new NotFoundException('Case not found');
  }

  // -------------------------------------------------------------------------
  // Closing a case out. Every verb below leans on RLS for "may this caller
  // touch this row": there is no ownership check here, and `rowCount === 0` is
  // the answer to both "no such case" and "not yours", which §6 requires be
  // indistinguishable.
  // -------------------------------------------------------------------------

  /**
   * The receiving side withdraws, with a reason.
   *
   * Separate from `cancel()` (the lab withdrawing its own case) and from
   * `decline()` (refusing one before accepting it) because the reason is the
   * point: a lab told only "cancelled" cannot tell a clinic closure from its
   * own request having lapsed.
   */
  async cancelAsDoctor(caseId: string, reason?: string): Promise<void> {
    // Read BEFORE the write. Cancelling ends this doctor's access to the case,
    // so a read afterwards correctly returns nothing — and the event would be
    // published with no patient on it, or not at all.
    const item = await this.getCase(caseId);
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE cases_cases
         SET status = 'cancelled', cancel_reason = $2, terminal_at = now()
         WHERE id = $1 AND status <> 'cancelled'`,
        [caseId, reason ?? null],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Case not found');

    await this.bus.publish({
      type: 'CaseCancelled',
      caseId,
      patientId: item.patientId,
      doctorId: item.doctorId,
      ...(reason === undefined ? {} : { reason }),
      ...actorFields(),
    });
  }

  /** Case detail the referring side may correct — the reason and the notes. */
  async updateCase(
    caseId: string,
    patch: { reason?: string | null; notes?: string | null },
  ): Promise<CaseSummary> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE cases_cases
         SET reason = CASE WHEN $2::boolean THEN $3 ELSE reason END,
             notes  = CASE WHEN $4::boolean THEN $5 ELSE notes  END
         WHERE id = $1`,
        [
          caseId,
          patch.reason !== undefined,
          patch.reason ?? null,
          patch.notes !== undefined,
          patch.notes ?? null,
        ],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Case not found');
    return this.getCase(caseId);
  }

  /**
   * Move accepted-but-unanswered cases to `expired`.
   *
   * THE MECHANISM SURVIVED THE CARD; THE REASON DID NOT. This used to release a
   * Stripe authorisation that was never captured, and the window was the
   * payment window. There is no authorisation now, so what expires is the
   * receiving doctor's silence after they committed to answering.
   *
   * `expired` rather than `cancelled`: nobody withdrew and nobody refused, the
   * clock ran out — and only `expired` is the refund trigger. Collapsing it
   * into `cancelled` would make a lab's own withdrawal indistinguishable from
   * a doctor's failure to deliver, which is the distinction the refund policy
   * turns on.
   *
   * ONLY FROM `accepted`. A case nobody accepted has no clock running: nothing
   * was promised, so there is nothing to expire and nothing to refund.
   *
   * The conditional UPDATE is the guard, not a select-then-update. Two sweeps
   * running together would both see the same overdue case and both refund it;
   * this makes double-expiry unrepresentable rather than unlikely — the same
   * reasoning as the ledger's partial unique index (0023).
   */
  async expireOverdue(): Promise<number> {
    return this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE cases_cases
         SET status = 'expired', terminal_at = now()
         WHERE status = 'accepted' AND answer_due_at < now()`,
      );
      return res.rowCount ?? 0;
    });
  }
}
