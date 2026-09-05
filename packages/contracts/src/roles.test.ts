import { describe, expect, it } from 'vitest';
import {
  CLINICAL_ROLES,
  isClinicalRole,
  LOCALE_DIRECTION,
  requiresSecondFactor,
  ROLES,
  roleSchema,
  SECOND_FACTOR_ROLES,
} from './roles';

describe('roles', () => {
  it('accepts the five roles and rejects anything else', () => {
    expect(roleSchema.parse('libya_doctor')).toBe('libya_doctor');
    expect(roleSchema.parse('tunisia_doctor')).toBe('tunisia_doctor');
    expect(roleSchema.parse('admin')).toBe('admin');
    expect(roleSchema.parse('applicant')).toBe('applicant');
    expect(roleSchema.parse('assistant')).toBe('assistant');
    expect(() => roleSchema.parse('superuser')).toThrow();
  });

  it('rejects patient, which is no longer a role', () => {
    // A patient is a record, never a login. If this ever passes again, the
    // claim flow has come back and every policy dropped in migration 0021
    // needs rewriting first.
    expect(roleSchema.safeParse('patient').success).toBe(false);
  });

  it('treats the three data-bearing roles as clinical for MFA purposes (P4.3)', () => {
    expect(isClinicalRole('libya_doctor')).toBe(true);
    expect(isClinicalRole('tunisia_doctor')).toBe(true);
    expect(isClinicalRole('admin')).toBe(true);
    expect(CLINICAL_ROLES).toHaveLength(3);
  });

  it('does not require a second factor of an applicant, who can reach no data', () => {
    // If this ever flips, check WHY before changing it: an applicant that can
    // read something is a role that has grown an access path it was created
    // not to have.
    expect(isClinicalRole('applicant')).toBe(false);
  });

  it('lists the five roles in a stable order', () => {
    // Order matters only so that a removal or an insertion is a visible diff
    // rather than a silent reshuffle. `patient` was removed from position 2 in
    // migration 0021; the clinical three still lead.
    expect(ROLES).toEqual([
      'libya_doctor',
      'tunisia_doctor',
      'admin',
      'applicant',
      'assistant',
    ]);
  });

  /**
   * An assistant is NOT clinical and DOES need a second factor. Keeping the two
   * questions apart is the whole reason `SECOND_FACTOR_ROLES` exists: widening
   * `CLINICAL_ROLES` to get the login check would have quietly proposed a
   * receptionist for imaging access too, since the imaging policies and the
   * corridor grant are both written against the clinical set.
   */
  it('requires a second factor of an assistant without making them clinical', () => {
    expect(isClinicalRole('assistant')).toBe(false);
    expect(CLINICAL_ROLES).not.toContain('assistant');

    expect(requiresSecondFactor('assistant')).toBe(true);
    expect(requiresSecondFactor('libya_doctor')).toBe(true);
    expect(requiresSecondFactor('applicant')).toBe(false);
    expect(SECOND_FACTOR_ROLES).toHaveLength(CLINICAL_ROLES.length + 1);
  });

  it('marks Arabic as RTL (DECISION D4)', () => {
    expect(LOCALE_DIRECTION.ar).toBe('rtl');
    expect(LOCALE_DIRECTION.fr).toBe('ltr');
  });
});
