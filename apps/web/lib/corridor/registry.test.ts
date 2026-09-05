import { describe, expect, it } from 'vitest';
import { corridorSchema } from '@mir/contracts';
import {
  CORRIDORS,
  corridorForRole,
  DEFAULT_CORRIDOR_ID,
  getCorridor,
  sideForRole,
} from './registry';

describe('corridor registry', () => {
  it('holds only valid corridors', () => {
    for (const corridor of CORRIDORS) {
      expect(() => corridorSchema.parse(corridor)).not.toThrow();
    }
    expect(CORRIDORS.length).toBeGreaterThan(0);
  });

  it('has a default corridor that actually exists', () => {
    expect(getCorridor(DEFAULT_CORRIDOR_ID)).not.toBeNull();
  });

  it('returns null for an unknown corridor rather than throwing', () => {
    expect(getCorridor('ma-fr')).toBeNull();
  });

  it('finds the corridor a role belongs to, so no screen hardcodes one', () => {
    expect(corridorForRole('libya_doctor')?.id).toBe(DEFAULT_CORRIDOR_ID);
    expect(corridorForRole('tunisia_doctor')?.id).toBe(DEFAULT_CORRIDOR_ID);
  });

  it('resolves a role to its side', () => {
    expect(sideForRole('libya_doctor')).toBe('source');
    expect(sideForRole('tunisia_doctor')).toBe('destination');
    expect(sideForRole('admin')).toBe('ops');
    expect(sideForRole('assistant')).toBeNull();
  });

  it('assigns each non-admin role to exactly one corridor side', () => {
    const sides = CORRIDORS.flatMap((c) => [c.source.role, c.destination.role]);
    expect(new Set(sides).size).toBe(sides.length);
  });

  it('references intake labels by dictionary key only', () => {
    for (const corridor of CORRIDORS) {
      const fields = [
        ...corridor.intakeFields,
        ...corridor.source.documentRequirements,
        ...corridor.destination.documentRequirements,
      ];
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        expect(field.labelKey).toMatch(/^[a-z][A-Za-z0-9]*$/);
      }
    }
  });
});
