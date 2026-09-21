import { describe, expect, it } from 'vitest';
import {
  canSubmitCases,
  isKindAllowedOnSide,
  PROVIDER_KINDS,
  providerKindsForSide,
  type Provider,
  providerSchema,
  VERIFICATION_STATUSES,
} from './provider';

const approved: Provider = providerSchema.parse({
  id: 'prov-1',
  kind: 'clinic',
  legalName: 'Tripoli Imaging Centre',
  corridorId: 'ly-tn',
  side: 'source',
  verification: {
    status: 'approved',
    submittedAt: '2026-07-01T09:00:00.000Z',
    decidedAt: '2026-07-03T12:00:00.000Z',
    credentials: { licenceNumber: 'LY-88213' },
  },
  seatCount: 4,
});

describe('provider', () => {
  it('covers the organisation kinds the brief names in §3', () => {
    expect(PROVIDER_KINDS).toContain('clinic');
    expect(PROVIDER_KINDS).toContain('laboratory');
    expect(PROVIDER_KINDS).toContain('doctor');
  });

  it('exposes the three states a provider must be able to see for themselves (§5.1)', () => {
    expect(VERIFICATION_STATUSES).toEqual(['pending', 'approved', 'rejected']);
  });

  it('lets only an approved provider submit cases', () => {
    expect(canSubmitCases(approved)).toBe(true);
  });

  it('blocks a pending provider from submitting, so the UI never offers the action (§4.4)', () => {
    const pending = providerSchema.parse({
      ...approved,
      verification: {
        status: 'pending',
        submittedAt: '2026-07-01T09:00:00.000Z',
        credentials: { licenceNumber: 'LY-88213' },
      },
    });
    expect(canSubmitCases(pending)).toBe(false);
  });

  it('blocks a rejected provider and keeps the reason key for display', () => {
    const rejected = providerSchema.parse({
      ...approved,
      verification: {
        status: 'rejected',
        submittedAt: '2026-07-01T09:00:00.000Z',
        decidedAt: '2026-07-03T12:00:00.000Z',
        reasonKey: 'verificationReasonLicenceExpired',
        credentials: { licenceNumber: 'LY-88213' },
      },
    });
    expect(canSubmitCases(rejected)).toBe(false);
    expect(rejected.verification.reasonKey).toBe('verificationReasonLicenceExpired');
  });

  it('requires a decision instant once a decision has been made', () => {
    expect(() =>
      providerSchema.parse({
        ...approved,
        verification: {
          status: 'approved',
          submittedAt: '2026-07-01T09:00:00.000Z',
          credentials: {},
        },
      }),
    ).toThrow(/decidedAt/i);
  });

  it('never puts a provider on the ops side — ops is platform staff, not a provider', () => {
    expect(() => providerSchema.parse({ ...approved, side: 'ops' })).toThrow();
  });

  it('requires at least one seat, since a clinic with no logins cannot work (§5.5)', () => {
    expect(() => providerSchema.parse({ ...approved, seatCount: 0 })).toThrow();
  });
});

describe('kinds per side (spec 2026-09-21 §2)', () => {
  it('lets only clinics and laboratories refer', () => {
    expect(providerKindsForSide('source')).toEqual(['clinic', 'laboratory']);
  });

  it('lets only doctors receive', () => {
    expect(providerKindsForSide('destination')).toEqual(['doctor']);
  });

  it('refuses a Libyan doctor, a Tunisian clinic, and hospitals on either side', () => {
    expect(isKindAllowedOnSide('doctor', 'source')).toBe(false);
    expect(isKindAllowedOnSide('clinic', 'destination')).toBe(false);
    expect(isKindAllowedOnSide('hospital', 'source')).toBe(false);
    expect(isKindAllowedOnSide('hospital', 'destination')).toBe(false);
  });
});
