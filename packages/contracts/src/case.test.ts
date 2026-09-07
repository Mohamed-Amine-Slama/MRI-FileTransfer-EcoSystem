import { describe, expect, it } from 'vitest';
import {
  CASE_STATUSES,
  canTransition,
  canViewCase,
  caseSchema,
  formatCaseRef,
  isTerminalStatus,
  nextStatuses,
  parseCaseRef,
} from './case';

describe('the consult status machine', () => {
  it('quotes before it takes money', () => {
    expect(canTransition('submitted', 'quoted')).toBe(true);
    expect(canTransition('submitted', 'paid')).toBe(false);
  });

  /**
   * A decline is not the end of a case. The lab picks again, so `declined`
   * must lead back to `submitted` — and it must NOT be terminal, which is the
   * property the ledger relies on to keep the payment hold open.
   */
  it('returns a declined case to the lab rather than ending it', () => {
    expect(canTransition('paid', 'declined')).toBe(true);
    expect(canTransition('declined', 'submitted')).toBe(true);
    expect(isTerminalStatus('declined')).toBe(false);
  });

  it('lets an expired quote fall back to submitted', () => {
    expect(canTransition('quoted', 'submitted')).toBe(true);
  });

  it('only an accepted case can be answered or expire', () => {
    expect(canTransition('accepted', 'answered')).toBe(true);
    expect(canTransition('accepted', 'expired')).toBe(true);
    expect(canTransition('paid', 'answered')).toBe(false);
    expect(canTransition('paid', 'expired')).toBe(false);
  });

  it('refuses to skip or reverse the money steps', () => {
    expect(canTransition('submitted', 'accepted')).toBe(false);
    expect(canTransition('answered', 'accepted')).toBe(false);
    expect(canTransition('closed', 'answered')).toBe(false);
  });

  it('lets a live case be cancelled but never a finished one', () => {
    expect(canTransition('submitted', 'cancelled')).toBe(true);
    expect(canTransition('accepted', 'cancelled')).toBe(true);
    expect(canTransition('answered', 'cancelled')).toBe(false);
    expect(canTransition('expired', 'cancelled')).toBe(false);
  });

  it('ends at closed, cancelled and expired', () => {
    expect(isTerminalStatus('closed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('expired')).toBe(true);
    expect(isTerminalStatus('submitted')).toBe(false);
  });

  /** There is no appointment to miss. */
  it('has no no_show status', () => {
    expect(CASE_STATUSES as readonly string[]).not.toContain('no_show');
  });

  /** Choosing a doctor and locking their price are one act. */
  it('has no assigned status', () => {
    expect(CASE_STATUSES as readonly string[]).not.toContain('assigned');
  });

  it('offers the reachable statuses so admin override UI is generated, not hand-listed (§5.8)', () => {
    expect(nextStatuses('paid')).toEqual(['accepted', 'declined', 'cancelled']);
    expect(nextStatuses('closed')).toEqual([]);
  });

  it('gives every status a transition entry, so no status can strand a case', () => {
    for (const status of CASE_STATUSES) {
      expect(Array.isArray(nextStatuses(status))).toBe(true);
    }
  });
});

describe('case reference', () => {
  it('formats the reference shown on the confirmation screen (§5.2)', () => {
    expect(formatCaseRef(2026, 417)).toBe('MIR-2026-0417');
    expect(formatCaseRef(2026, 1)).toBe('MIR-2026-0001');
  });

  it('round-trips', () => {
    expect(parseCaseRef('MIR-2026-0417')).toEqual({ year: 2026, sequence: 417 });
  });

  it('returns null rather than throwing when a provider mistypes a reference into search', () => {
    expect(parseCaseRef('MIR-26-417')).toBeNull();
    expect(parseCaseRef('nonsense')).toBeNull();
    expect(parseCaseRef('')).toBeNull();
  });

  it('refuses a sequence that will not fit, instead of silently truncating', () => {
    expect(() => formatCaseRef(2026, 10000)).toThrow(/sequence/i);
    expect(() => formatCaseRef(2026, 0)).toThrow(/sequence/i);
  });
});

describe('case', () => {
  it('owns the V0 records rather than replacing them', () => {
    const parsed = caseSchema.parse({
      ref: 'MIR-2026-0417',
      corridorId: 'ly-tn',
      status: 'accepted',
      submittedByProviderId: 'prov-1',
      matchedProviderId: 'prov-2',
      patientId: 'pat-1',
      studyIds: ['study-1', 'study-2'],
      appointmentId: 'appt-1',
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-04T11:30:00.000Z',
      intake: { referralReason: 'suspected meniscal tear' },
    });
    expect(parsed.studyIds).toHaveLength(2);
    expect(parsed.appointmentId).toBe('appt-1');
  });

  it('accepts a case that has not been matched or scheduled yet', () => {
    const parsed = caseSchema.parse({
      ref: 'MIR-2026-0418',
      corridorId: 'ly-tn',
      status: 'submitted',
      submittedByProviderId: 'prov-1',
      patientId: 'pat-1',
      studyIds: [],
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-01T09:00:00.000Z',
      intake: {},
    });
    expect(parsed.matchedProviderId).toBeUndefined();
    expect(parsed.appointmentId).toBeUndefined();
  });

  it('refuses a malformed reference', () => {
    expect(() =>
      caseSchema.parse({
        ref: 'CASE-1',
        corridorId: 'ly-tn',
        status: 'submitted',
        submittedByProviderId: 'prov-1',
        patientId: 'pat-1',
        studyIds: [],
        createdAt: '2026-08-01T09:00:00.000Z',
        updatedAt: '2026-08-01T09:00:00.000Z',
        intake: {},
      }),
    ).toThrow();
  });
});

describe('case audience (§5.4 P0, §4.4)', () => {
  const item = caseSchema.parse({
    ref: 'MIR-2026-0417',
    corridorId: 'ly-tn',
    status: 'accepted',
    submittedByProviderId: 'prov-a',
    matchedProviderId: 'prov-b',
    patientId: 'pat-1',
    studyIds: ['study-1'],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-06T11:30:00.000Z',
    intake: {},
  });

  it('lets the referring provider see their own case', () => {
    expect(canViewCase(item, { kind: 'provider', providerId: 'prov-a' })).toBe(true);
  });

  it('lets the matched provider see the case they were matched to', () => {
    expect(canViewCase(item, { kind: 'provider', providerId: 'prov-b' })).toBe(true);
  });

  it('refuses a provider who is not a party, however they reached the URL', () => {
    // §5.4 P0: only authorised parties for a given case see its files. A case
    // reference is short and guessable, so knowing one must not grant access.
    expect(canViewCase(item, { kind: 'provider', providerId: 'prov-c' })).toBe(false);
  });

  it('lets ops see any case, because that is what oversight means (§5.8)', () => {
    expect(canViewCase(item, { kind: 'ops' })).toBe(true);
  });

  it('does not treat an unmatched case as visible to everyone', () => {
    const unmatched = caseSchema.parse({ ...item, matchedProviderId: undefined });
    expect(canViewCase(unmatched, { kind: 'provider', providerId: 'prov-b' })).toBe(false);
    expect(canViewCase(unmatched, { kind: 'provider', providerId: 'prov-a' })).toBe(true);
  });
});
