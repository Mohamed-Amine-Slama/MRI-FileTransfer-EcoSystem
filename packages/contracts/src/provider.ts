import { z } from 'zod';
import { endpointSideSchema, type EndpointSide } from './corridor';

/**
 * Providers — brief §3 and §5.1.
 *
 * A provider is an ORGANISATION, not a login. §5.5 asks for multi-seat access
 * within a single clinic account, so seats are counted here and users reference
 * a provider rather than being one.
 */

/**
 * What kind of organisation is applying.
 *
 * `hospital` is distinct from `clinic` and not a synonym for it: a hospital
 * PROVISIONS the clinicians who work inside it — it invites their accounts and
 * routes appointments to them by specialty — and a one-room clinic or a solo
 * `doctor` account must not carry that power. The capability is gated on this
 * value, so collapsing the two would hand every practice the ability to mint
 * clinical accounts.
 */
export const PROVIDER_KINDS = ['clinic', 'hospital', 'laboratory', 'doctor'] as const;

export const providerKindSchema = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof providerKindSchema>;

/** Kinds that may provision accounts for the clinicians working under them. */
export const PROVISIONING_KINDS: readonly ProviderKind[] = ['hospital'];

export function canProvisionClinicians(kind: ProviderKind): boolean {
  return PROVISIONING_KINDS.includes(kind);
}

/**
 * Which kinds may register on which side — requirements §2 and spec
 * 2026-09-21 §2. Libya refers through clinics and laboratories; Tunisia
 * answers through individual doctors. Libyan doctors, Tunisian clinics, and
 * hospitals on either side cannot register.
 *
 * `PROVIDER_KINDS` keeps `hospital` and `doctor` so historical rows still
 * parse; this is the gate on NEW registrations, applied by the API and
 * mirrored by the sign-up form.
 */
const KINDS_BY_SIDE: Record<EndpointSide, readonly ProviderKind[]> = {
  source: ['clinic', 'laboratory'],
  destination: ['doctor'],
};

export function providerKindsForSide(side: EndpointSide): readonly ProviderKind[] {
  return KINDS_BY_SIDE[side];
}

export function isKindAllowedOnSide(kind: ProviderKind, side: EndpointSide): boolean {
  return KINDS_BY_SIDE[side].includes(kind);
}

/**
 * §5.1 requires the provider to see this state "with no need to contact the
 * platform team", which is why it is part of the provider record the frontend
 * already holds rather than something that must be asked for.
 */
export const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const providerVerificationSchema = z
  .object({
    status: verificationStatusSchema,
    submittedAt: z.string().datetime(),
    decidedAt: z.string().datetime().optional(),
    /** Dictionary key, not copy — a rejection reason must translate (§4.2). */
    reasonKey: z.string().optional(),
    /** Shape comes from the corridor's documentRequirements (§4.3). */
    credentials: z.record(z.string(), z.unknown()),
  })
  .refine((v) => v.status === 'pending' || v.decidedAt !== undefined, {
    message: 'a decided verification must carry decidedAt',
    path: ['decidedAt'],
  });
export type ProviderVerification = z.infer<typeof providerVerificationSchema>;

export const providerSchema = z.object({
  id: z.string().min(1),
  kind: providerKindSchema,
  legalName: z.string().min(1),
  corridorId: z.string().min(1),
  /**
   * Only the two endpoint sides. `ops` is excluded structurally rather than by
   * a validation message: platform staff are not a provider, and §3 requires
   * the two sign-up paths stay separate rather than being one form gated by a
   * role dropdown.
   */
  side: endpointSideSchema,
  verification: providerVerificationSchema,
  seatCount: z.number().int().min(1),
});
export type Provider = z.infer<typeof providerSchema>;

/**
 * The single authority on whether case-submission affordances may be rendered.
 *
 * §4.4 requires the UI never show an affordance for an action the user is not
 * authorised to take. Routing every such check through one predicate is what
 * stops the answer being re-derived, and re-derived differently, on each
 * screen that needs it.
 */
export function canSubmitCases(provider: Provider): boolean {
  return provider.verification.status === 'approved';
}
