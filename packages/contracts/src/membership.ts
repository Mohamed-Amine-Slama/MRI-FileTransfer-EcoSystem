import { z } from 'zod';

/**
 * Seats within one organisation — brief §5.5 P1 ("team/multi-seat access
 * within a single clinic account").
 *
 * The organisation itself is `Provider` in ./provider.ts, not a second shape
 * declared here. That record already carries `seatCount` and the verification
 * decision, and the screens are written against it; giving the durable table a
 * different type would mean two names for one thing and a mapping layer whose
 * only job is to prove they agree.
 *
 * WHY SEATS ARE A JOIN AND NOT A COLUMN ON THE USER.
 * A person can plausibly hold a seat at more than one clinic — a radiologist
 * reading for two practices is ordinary. Storing `organisationId` on the user
 * makes that unrepresentable, and the migration away from it later is a data
 * migration rather than a schema one.
 */

/**
 * `owner` may invite, revoke, and change the plan. `member` may not.
 *
 * This was deliberately two values, on the grounds that every finer-grained
 * scheme — a billing admin, a read-only auditor — was a guess about how clinics
 * are actually run, and that the third should wait until someone asked for it.
 *
 * `assistant` is that third, and it is not a guess: a practice needs someone who
 * books the appointments, and the requirement arrived with the practice
 * calendar. It is unlike the other two in kind, which is the point. `owner` and
 * `member` are degrees of authority over the ORGANISATION and both imply a
 * clinical role; `assistant` is a different job. It grants nothing over the
 * organisation and never yields a clinical role — an assistant seat resolves to
 * the non-clinical `assistant` role (migration 0015), which reaches a calendar
 * and no imaging at all.
 */
export const SEAT_ROLES = ['owner', 'member', 'assistant'] as const;
export const seatRoleSchema = z.enum(SEAT_ROLES);
export type SeatRole = z.infer<typeof seatRoleSchema>;

export const membershipSchema = z.object({
  organisationId: z.string().min(1),
  userId: z.string().uuid(),
  seatRole: seatRoleSchema,
  /** Display only — the member list has to name people, not print UUIDs. */
  displayName: z.string().min(1),
  email: z.string().email(),
  invitedBy: z.string().uuid().optional(),
  acceptedAt: z.string().datetime(),
});
export type Membership = z.infer<typeof membershipSchema>;

/**
 * An outstanding invitation.
 *
 * NOTE WHAT IS ABSENT: the token. It is a bearer credential — whoever holds it
 * joins the organisation and can then see its cases — so only its SHA-256 is
 * stored, and neither the hash nor the token is ever returned by a list
 * endpoint. This is the same rule `patients_claim_tokens` follows, for the same
 * reason: a read-only database leak must not be enough to join a clinic.
 */
export const invitationSchema = z.object({
  id: z.string().uuid(),
  organisationId: z.string().min(1),
  email: z.string().email(),
  seatRole: seatRoleSchema,
  invitedBy: z.string().uuid(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email().max(254),
  seatRole: seatRoleSchema,
  /**
   * Stated by the INVITER, not asked of the invitee on arrival.
   *
   * A hospital knows which department it is hiring into, and appointment
   * routing matches on specialty — so a doctor who arrives without one cannot
   * be assigned work until somebody fills it in. The doctor can correct it on
   * their own profile afterwards.
   *
   * Optional because an assistant seat has no specialty and neither does an
   * ordinary member.
   */
  specialty: z.string().trim().min(1).max(120).optional(),
  /** For addressing the invitation; the account's own name wins once it exists. */
  fullName: z.string().trim().min(1).max(200).optional(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** Days an invitation stays redeemable. */
export const INVITATION_TTL_DAYS = 14;

/**
 * Whether another seat may be filled.
 *
 * Counts ACCEPTED members plus OUTSTANDING invitations against the limit.
 * Counting only accepted members lets an owner issue twenty invitations
 * against ten seats and discover the overshoot when the eleventh person
 * accepts and is refused — which blames the invitee for the inviter's mistake.
 */
export function hasSeatAvailable(
  seatCount: number,
  acceptedMembers: number,
  outstandingInvitations: number,
): boolean {
  return acceptedMembers + outstandingInvitations < seatCount;
}
