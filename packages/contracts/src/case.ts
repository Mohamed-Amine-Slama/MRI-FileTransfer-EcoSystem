import { z } from 'zod';
import { caseSideSchema } from './corridor';

/**
 * The consult lifecycle — consult-model spec Part 1.
 *
 * WHY A TABLE RATHER THAN CONDITIONALS.
 * §5.3 requires status labels be shown "consistently across provider and admin
 * views". Two views that each decide for themselves what may follow `paid`
 * will eventually disagree, and the disagreement will be discovered by a clinic
 * rather than by us. One table, read by both, cannot drift. It also gives the
 * §5.8 admin override UI its options for free, rather than by hand-listing them
 * somewhere a new status will be forgotten.
 *
 * WHY `quoted` CARRIES THE DOCTOR. A quote is for one case AND one doctor,
 * because the doctor's earned tier is a term in the price. There is deliberately
 * no `assigned` state: a case holding a doctor but no price, or a price but no
 * doctor, is a state the pricing rules cannot describe.
 */

export const CASE_STATUSES = [
  'submitted',
  'quoted',
  'paid',
  'accepted',
  'answered',
  'closed',
  'declined',
  'cancelled',
  'expired',
] as const;

export const caseStatusSchema = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

/**
 * What may follow what. A terminal status maps to the empty list, which is what
 * `isTerminalStatus` reads — there is no second list to keep in sync.
 *
 * `declined` IS NOT TERMINAL, and that is the load-bearing entry here. The
 * doctor refused; the lab picks again and the payment hold stays open, so the
 * case walks back to `submitted` for a fresh quote against whoever they choose
 * next. Treating a refusal as an ending would strand both the case and the
 * money.
 *
 * `quoted` also walks back to `submitted`, for the other reason a case stalls:
 * the quote's TTL lapsed before the lab paid. The price is never recomputed in
 * place — the lab asks for a new one.
 *
 * Cancellation is available from every live stage because a lab can withdraw at
 * any point before an answer exists. It is NOT available from a finished case:
 * cancelling an answered case would silently undo a coordination fee.
 */
const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  submitted: ['quoted', 'cancelled'],
  quoted: ['paid', 'submitted', 'cancelled'],
  paid: ['accepted', 'declined', 'cancelled'],
  accepted: ['answered', 'expired', 'cancelled'],
  declined: ['submitted'],
  answered: ['closed'],
  closed: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: CaseStatus): readonly CaseStatus[] {
  return TRANSITIONS[from];
}

export function isTerminalStatus(status: CaseStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Case reference — brief §5.2, shown on the submission confirmation screen and
 * used by providers to refer to a case on the phone. Latin-script and
 * fixed-width on purpose: it has to stay readable inside Arabic RTL text
 * (§4.2, mixed-direction content).
 */
const CASE_REF_PATTERN = /^MIR-(\d{4})-(\d{4})$/;
const MIN_SEQUENCE = 1;
const MAX_SEQUENCE = 9999;

export const caseRefSchema = z
  .string()
  .regex(CASE_REF_PATTERN, 'case reference must look like MIR-2026-0417');
export type CaseRef = z.infer<typeof caseRefSchema>;

export function formatCaseRef(year: number, sequence: number): CaseRef {
  if (!Number.isInteger(sequence) || sequence < MIN_SEQUENCE || sequence > MAX_SEQUENCE) {
    throw new RangeError(
      `case sequence must be an integer between ${MIN_SEQUENCE} and ${MAX_SEQUENCE}, got ${sequence}`,
    );
  }
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`case year must be a four-digit integer, got ${year}`);
  }
  return `MIR-${year}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Returns null rather than throwing: providers type references into search
 * boxes, and a typo there is ordinary input, not an exceptional condition.
 */
export function parseCaseRef(ref: string): { year: number; sequence: number } | null {
  const match = CASE_REF_PATTERN.exec(ref);
  if (match === null) return null;
  const [, year, sequence] = match;
  // noUncheckedIndexedAccess: the pattern guarantees both groups, but the
  // compiler cannot know that, so narrow rather than assert.
  if (year === undefined || sequence === undefined) return null;
  return { year: Number(year), sequence: Number(sequence) };
}

/**
 * One entry in the §5.3 status history. Also carries the §4.4 obligation to
 * surface audit-relevant actions back to the user: the actor and the instant
 * are part of the record precisely so a view can render "changed by X on
 * [date]" without a second lookup.
 */
export const caseEventSchema = z.object({
  id: z.string().min(1),
  caseRef: caseRefSchema,
  occurredAt: z.string().datetime(),
  actorDisplayName: z.string().min(1),
  actorSide: caseSideSchema,
  from: caseStatusSchema.nullable(),
  to: caseStatusSchema,
  noteKey: z.string().optional(),
});
export type CaseEvent = z.infer<typeof caseEventSchema>;

/**
 * A case owns the V0 records rather than replacing them: the patient, the
 * uploaded studies, and the booked appointment all hang off the case, so the
 * existing imaging and scheduling work becomes what happens *inside* a case.
 *
 * `intake` is an open map because its shape is the corridor's `intakeFields`
 * (§4.3) — pinning it to a fixed schema here would hardcode one corridor's
 * form, which is exactly what the brief forbids.
 */
export const caseSchema = z.object({
  ref: caseRefSchema,
  corridorId: z.string().min(1),
  status: caseStatusSchema,
  submittedByProviderId: z.string().min(1),
  matchedProviderId: z.string().min(1).optional(),
  patientId: z.string().min(1),
  studyIds: z.array(z.string().min(1)),
  appointmentId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  intake: z.record(z.string(), z.unknown()),
});
export type Case = z.infer<typeof caseSchema>;

/**
 * Who is asking to see a case — brief §5.4 P0 and §4.4.
 *
 * WHY A UNION AND NOT AN OPTIONAL PROVIDER ID. The obvious signature is
 * `getCase(ref, providerId?)`, where omitting the id means ops. That makes
 * unrestricted access the DEFAULT, reachable by forgetting an argument, on the
 * call that returns a patient's imaging. Here every caller must state which
 * kind of viewer it is, and `{ kind: 'ops' }` is a thing you have to type on
 * purpose.
 *
 * This is a UI-side gate. RLS refuses the rows regardless (ADR-6); the point
 * of duplicating the rule here is §4.4's "a user should never see a UI
 * affordance for an action their role isn't authorized for" — not to be the
 * control that stops them.
 */
export type CaseAudience =
  | { kind: 'provider'; providerId: string }
  | { kind: 'ops' };

/**
 * The two parties to a case are the one that submitted it and the one it was
 * matched to. An unmatched case therefore has exactly one party — a provider
 * who might LATER be matched has no claim on it yet, and a case reference is
 * short enough to guess.
 */
export function canViewCase(item: Case, audience: CaseAudience): boolean {
  if (audience.kind === 'ops') return true;
  return (
    item.submittedByProviderId === audience.providerId ||
    item.matchedProviderId === audience.providerId
  );
}
