import { z } from 'zod';

/**
 * The roles from BUILD_SPEC P3.1, plus `applicant`. This list is the single
 * source of truth shared by the API, the web app, the Keycloak realm config,
 * and the database CHECK constraint. Adding a role means changing this, the
 * realm, and a migration — deliberately awkward, because a new role is a new
 * access path.
 *
 * WHY THERE IS NO `patient` ROLE.
 * A patient is a RECORD, never a login. The referring Libyan doctor creates the
 * record and assigns it to a receiving Tunisian doctor; the patient never
 * authenticates, so there is no session to scope and no policy to write. The
 * claim flow that turned a phone number into an account — the token table, the
 * SECURITY DEFINER redemption, and `app_claimed_patient` — was removed in
 * migration 0021 along with the role itself.
 *
 * This is why consent is an ATTESTATION rather than an action: the referring
 * doctor asserts they hold the patient's signed form and uploads it, because
 * there is no patient session in which a patient could click anything. What
 * did NOT change is `app_has_consent_for`, which still gates the receiving
 * doctor's access to imaging — only the writer of the row moved.
 *
 * WHY `applicant` EXISTS.
 * Brief §5.1 P0 requires an organisation to see its verification decision
 * "with no need to contact the platform team", which means the applicant must
 * be able to sign in BEFORE anyone has approved them. The alternative designs
 * are both worse: granting a clinical role at sign-up would let a stranger
 * assert `libya_doctor` about themselves, and an unauthenticated status page
 * keyed by some reference would be an oracle for which clinics have applied.
 *
 * It is safe because it is granted NOTHING. No row-level security policy names
 * `applicant`, so every policy evaluates false and every query returns zero
 * rows — the account is fail-closed by construction rather than by a reviewer
 * remembering to restrict it. The clinical role is assigned only when ops
 * approves the verification.
 *
 * WHY `assistant` EXISTS, AND WHY IT IS A ROLE RATHER THAN A SEAT.
 * A practice is run by more than the doctor: somebody answers the phone and
 * books the appointments. That person needs to write to a doctor's calendar
 * and must never reach a scan.
 *
 * Modelling them purely as an `identity_memberships.seat_role` was tried first
 * and does not work. Every policy in this schema turns on `app_current_role()`,
 * which reads `identity_users.role` — so an assistant left as `applicant` would
 * match no policy at all, and the fix would be to write policies naming
 * `applicant`, destroying the fail-closed property described directly above.
 * The role says WHAT this account is; the membership says WHOSE calendar it may
 * touch (`app_assists_doctor`, migration 0015). Both are required, and neither
 * grants anything on its own.
 *
 * An assistant is deliberately NOT clinical: no policy grants one imaging,
 * consent, or patient demographics. What they can read of a patient is a name
 * and a phone number, returned by a SECURITY DEFINER function that has no
 * column for anything else.
 */
export const ROLES = [
  'libya_doctor',
  'tunisia_doctor',
  'admin',
  'applicant',
  'assistant',
] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * Roles that must have TOTP enrolled before login completes (P4.3).
 *
 * `applicant` is absent on purpose. Requiring a second factor to read one's own
 * "pending review" screen would block the exact person §5.1 says must not need
 * to phone anyone — and the account can reach no patient data to protect. TOTP
 * enrolment is required at the moment the clinical role is granted, which is
 * where it starts guarding something.
 */
export const CLINICAL_ROLES: readonly Role[] = ['libya_doctor', 'tunisia_doctor', 'admin'];

export function isClinicalRole(role: Role): boolean {
  return CLINICAL_ROLES.includes(role);
}

/**
 * Roles that must present a second factor — a SUPERSET of the clinical ones.
 *
 * Kept separate rather than by widening CLINICAL_ROLES, because `assistant` is
 * emphatically not a clinical role and the difference decides real access:
 * `CLINICAL_ROLES` is what the corridor grants on verification and what the
 * imaging policies are written against. Adding a receptionist to that list to
 * get one login check would have quietly proposed them for both.
 *
 * An assistant is here because the account can see who is attending a clinic
 * and on what number to reach them. That is worth a second factor even though
 * it is not worth a clinical grant.
 */
export const SECOND_FACTOR_ROLES: readonly Role[] = [...CLINICAL_ROLES, 'assistant'];

export function requiresSecondFactor(role: Role): boolean {
  return SECOND_FACTOR_ROLES.includes(role);
}

/**
 * Locales for v1, per DECISION D4. Arabic and French only, RTL from day one.
 * `dir` is carried alongside the code so the frontend never has to infer
 * direction from a language tag.
 */
export const LOCALES = ['ar', 'fr'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const LOCALE_DIRECTION: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  fr: 'ltr',
};
