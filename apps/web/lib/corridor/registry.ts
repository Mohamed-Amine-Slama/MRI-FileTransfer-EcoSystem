import {
  CONSULT_SPECIALTIES,
  CORRIDOR_ENDPOINT_ROLES,
  ROLES,
  corridorSchema,
  resolveSide,
  type CaseSide,
  type Corridor,
  type Role,
} from '@mir/contracts';

/**
 * Configured corridors — brief §4.3.
 *
 * This is the ONLY file that names a country. Everything downstream asks the
 * registry for a side and renders from dictionary keys, which is what makes
 * expansion a new entry here rather than a sweep through screens.
 *
 * Parsed at module load rather than trusted: a malformed corridor should fail
 * on the first render in development, not on the one screen that happens to
 * read the field nobody tested.
 */

const LIBYA_TUNISIA: Corridor = corridorSchema.parse({
  id: 'ly-tn',
  source: {
    country: 'LY',
    // Read from the shared mapping rather than restated: the API grants this
    // same role when ops approves a verification, and two copies is how the
    // two sides come to disagree about which one a corridor puts where.
    role: CORRIDOR_ENDPOINT_ROLES['ly-tn']?.source,
    licensingBodyKey: 'licensingBodyLyMedicalSyndicate',
    documentRequirements: [
      { key: 'licenceNumber', kind: 'text', required: true, labelKey: 'fieldLicenceNumber' },
      { key: 'facilityPermit', kind: 'file', required: true, labelKey: 'fieldFacilityPermit' },
    ],
  },
  destination: {
    country: 'TN',
    role: CORRIDOR_ENDPOINT_ROLES['ly-tn']?.destination,
    licensingBodyKey: 'licensingBodyTnOrdreDesMedecins',
    documentRequirements: [
      { key: 'cnomNumber', kind: 'text', required: true, labelKey: 'fieldCnomNumber' },
      // What the directory routes on. Approval copies it onto the doctor's
      // profile (migration 0031); without it a doctor matches no clinic's
      // specialty filter, however available they say they are.
      {
        key: 'specialty',
        kind: 'select',
        required: true,
        labelKey: 'caseNewSpecialty',
        options: [...CONSULT_SPECIALTIES],
      },
      { key: 'facilityPermit', kind: 'file', required: true, labelKey: 'fieldFacilityPermit' },
    ],
  },
  intakeFields: [
    { key: 'referralReason', kind: 'textarea', required: true, labelKey: 'fieldReferralReason' },
    {
      key: 'urgency',
      kind: 'select',
      required: true,
      labelKey: 'fieldUrgency',
      options: ['routine', 'soon', 'urgent'],
    },
    { key: 'preferredDate', kind: 'date', required: false, labelKey: 'fieldPreferredDate' },
  ],
  currencies: ['USD', 'EUR'],
});

export const CORRIDORS: readonly Corridor[] = [LIBYA_TUNISIA];

export const DEFAULT_CORRIDOR_ID = LIBYA_TUNISIA.id;

export function getCorridor(id: string): Corridor | null {
  return CORRIDORS.find((c) => c.id === id) ?? null;
}

/**
 * Admin belongs to no single corridor — it is ops across all of them — so this
 * returns null for admin. Use `sideForRole` when you only need the side.
 */
export function corridorForRole(role: Role): Corridor | null {
  return CORRIDORS.find((c) => c.source.role === role || c.destination.role === role) ?? null;
}

export function sideForRole(role: Role): CaseSide | null {
  const corridor = corridorForRole(role) ?? CORRIDORS[0];
  if (corridor === undefined) return null;
  return resolveSide(corridor, role);
}

/**
 * Every role that plays one of the given sides, across all configured
 * corridors — brief §4.3.
 *
 * This is what screens use for access gating. Writing
 * `allow={['libya_doctor', 'tunisia_doctor']}` in a page would hardcode the
 * corridor into routing, which is precisely what §4.3 forbids; asking for
 * "whoever the source and destination are" survives adding a corridor.
 */
export function rolesForSides(sides: readonly CaseSide[]): Role[] {
  const roles = new Set<Role>();
  for (const corridor of CORRIDORS) {
    if (sides.includes('source')) roles.add(corridor.source.role);
    if (sides.includes('destination')) roles.add(corridor.destination.role);
  }
  if (sides.includes('ops')) roles.add('admin');
  return [...roles];
}

/**
 * Every role, for screens that are about the USER rather than about a case —
 * their profile, their settings, their language.
 *
 * Spelled this way rather than as a list of role literals: writing them out
 * would hardcode the corridor into routing, which §4.3 forbids and the
 * ratcheting test in this directory catches. It also cannot fall behind, since
 * it IS the contract's role list.
 *
 * Note this still gates on being SIGNED IN. RoleGate refuses an anonymous
 * visitor whatever is listed here.
 */
export const EVERY_ROLE: readonly Role[] = ROLES;

/** Both provider sides — the usual gate for a case screen. */
export const PROVIDER_ROLES: readonly Role[] = rolesForSides(['source', 'destination']);

/** The referring side only — case submission starts there. */
export const SOURCE_ROLES: readonly Role[] = rolesForSides(['source']);

/** The receiving side only. */
export const DESTINATION_ROLES: readonly Role[] = rolesForSides(['destination']);
