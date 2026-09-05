import { z } from 'zod';
import { roleSchema, type Role } from './roles';

/**
 * Corridors — brief §4.3.
 *
 * WHY ROLES BECOME DATA INSTEAD OF BEING RENAMED.
 * §4.3 says no UI copy, routing, or business logic may assume Libya/Tunisia as
 * constants. The obvious fix — rename `libya_doctor` to `source_provider` — is
 * closed off: that identifier appears 299 times across RLS policies, four
 * migrations, and the Keycloak realm, and roles.ts states that changing the set
 * is deliberately awkward because a new role is a new access path.
 *
 * So the role stays as the stored access subject, and the corridor declares
 * which side it plays. Presentation code asks for a CaseSide and never learns
 * the country. Adding Morocco -> France is then a new config object, not a
 * sweep through screens.
 */

export const CASE_SIDES = ['source', 'destination', 'ops'] as const;
export const caseSideSchema = z.enum(CASE_SIDES);
export type CaseSide = z.infer<typeof caseSideSchema>;

/** The sides a corridor endpoint can occupy. `ops` is platform staff, not an endpoint. */
export const ENDPOINT_SIDES = ['source', 'destination'] as const;
export const endpointSideSchema = z.enum(ENDPOINT_SIDES);
export type EndpointSide = z.infer<typeof endpointSideSchema>;

export const fieldKindSchema = z.enum([
  'text',
  'textarea',
  'date',
  'select',
  'file',
  'phone',
  'national_id',
]);
export type FieldKind = z.infer<typeof fieldKindSchema>;

/**
 * A form field described as data. `labelKey` is a dictionary key, never a
 * translated string — a corridor must not smuggle untranslatable copy past the
 * §4.2 string catalogue.
 */
export const fieldSpecSchema = z.object({
  key: z.string().min(1),
  kind: fieldKindSchema,
  required: z.boolean(),
  labelKey: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'labelKey must be a dictionary key'),
  options: z.array(z.string().min(1)).optional(),
});
export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const corridorEndpointSchema = z.object({
  /** ISO 3166-1 alpha-2. Rendered via the dictionary, never concatenated into copy. */
  country: z.string().regex(/^[A-Z]{2}$/),
  role: roleSchema,
  licensingBodyKey: z.string().min(1),
  documentRequirements: z.array(fieldSpecSchema),
});
export type CorridorEndpoint = z.infer<typeof corridorEndpointSchema>;

export const corridorSchema = z
  .object({
    id: z.string().min(1),
    source: corridorEndpointSchema,
    destination: corridorEndpointSchema,
    intakeFields: z.array(fieldSpecSchema),
    currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).nonempty(),
  })
  .refine((c) => c.source.role !== c.destination.role, {
    message: 'a corridor cannot put the same role on both sides',
    path: ['destination', 'role'],
  });
export type Corridor = z.infer<typeof corridorSchema>;

/**
 * Which role each configured corridor puts on each endpoint.
 *
 * WHY THIS IS IN THE CONTRACT AND NOT IN THE WEB APP'S REGISTRY.
 * The full corridor definition — document requirements, intake fields,
 * licensing bodies — is presentation configuration and lives with the screens
 * that render it. The role mapping is not: the API needs it too, at the one
 * moment that matters most, when a verification decision grants a clinical
 * role. Two copies of that mapping is how an ops approval ends up granting the
 * wrong side's role, and no test would catch it because each copy is
 * self-consistent.
 *
 * So the mapping is declared once here and read by both. `resolveSide` above is
 * its inverse, and `corridorSchema` still carries the roles on the corridor
 * object so nothing downstream has to consult two sources.
 */
export const CORRIDOR_ENDPOINT_ROLES: Record<string, Record<EndpointSide, Role>> = {
  'ly-tn': { source: 'libya_doctor', destination: 'tunisia_doctor' },
};

/**
 * The role a corridor grants on one side, or null if the corridor is unknown.
 *
 * Returning null rather than throwing: an organisation row can name a corridor
 * that has since been retired from configuration, and the honest answer at that
 * point is "no role", which the caller turns into a refusal to approve. A throw
 * would take down the whole ops queue over one stale row.
 */
export function corridorRoleFor(corridorId: string, side: EndpointSide): Role | null {
  return CORRIDOR_ENDPOINT_ROLES[corridorId]?.[side] ?? null;
}


/**
 * The side a role plays on a corridor, or null if it plays none.
 *
 * Patients return null deliberately: the platform's users are organisations
 * and professionals (§2), and a patient holds no side of a referral.
 */
export function resolveSide(corridor: Corridor, role: Role): CaseSide | null {
  if (role === 'admin') return 'ops';
  if (role === corridor.source.role) return 'source';
  if (role === corridor.destination.role) return 'destination';
  return null;
}

/** The endpoint record for a side. `ops` has no endpoint — it is platform staff. */
export function corridorEndpointFor(corridor: Corridor, side: CaseSide): CorridorEndpoint | null {
  if (side === 'source') return corridor.source;
  if (side === 'destination') return corridor.destination;
  return null;
}
