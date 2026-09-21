import { describe, expect, it } from 'vitest';
import { caseSchema, providerSchema } from '@mir/contracts';
import type { CaseRecord, Organisation } from '../endpoints';
import { timelineFor, toCase, toProvider } from './adapt';

const record: CaseRecord = {
  id: '0190a8f2-0000-7000-8000-000000000001',
  caseRef: 'MIR-2026-0001',
  patientId: '0190a8f2-0000-7000-8000-000000000002',
  patientName: null,
  patientAgeYears: 41,
  patientSex: 'F',
  doctorId: '0190a8f2-0000-7000-8000-000000000003',
  doctorName: 'Dr Karim Receiving',
  organisationId: '0190a8f2-0000-7000-8000-000000000004',
  specialty: 'radiology',
  status: 'accepted',
  reason: 'Headache, rule out mass',
  notes: null,
  quotedAmountMinor: 10000,
  quotedCurrency: 'USD',
  quotedAt: '2026-09-21T10:10:00.000Z',
  quoteExpiresAt: '2026-09-21T10:40:00.000Z',
  acceptedAt: '2026-09-21T11:00:00.000Z',
  answeredAt: null,
  answerDueAt: '2026-09-24T11:00:00.000Z',
  createdAt: '2026-09-21T10:00:00.000Z',
  updatedAt: '2026-09-21T11:00:00.000Z',
  studyIds: ['0190a8f2-0000-7000-8000-000000000005'],
};

describe('toCase', () => {
  it('produces a valid contract Case', () => {
    expect(() => caseSchema.parse(toCase(record, 'ly-tn'))).not.toThrow();
  });

  it('carries the reference, the specialty and the reason in intake', () => {
    const c = toCase(record, 'ly-tn');
    expect(c.ref).toBe('MIR-2026-0001');
    expect(c.intake).toMatchObject({ specialty: 'radiology', referralReason: 'Headache, rule out mass' });
  });

  it('never puts a patient name into intake', () => {
    const c = toCase({ ...record, patientName: 'Sample Patient' }, 'ly-tn');
    expect(JSON.stringify(c)).not.toContain('Sample Patient');
  });
});

describe('timelineFor', () => {
  it('lists the steps that have happened, oldest first', () => {
    const events = timelineFor(record);
    expect(events.map((e) => e.to)).toEqual(['submitted', 'quoted', 'accepted']);
    expect(events[1]?.occurredAt).toBe('2026-09-21T10:10:00.000Z');
    expect(events[0]?.from).toBeNull();
    expect(events[2]?.from).toBe('quoted');
  });
});

describe('toProvider', () => {
  it('produces a valid contract Provider', () => {
    const org: Organisation = {
      id: '0190a8f2-0000-7000-8000-000000000004',
      kind: 'clinic',
      legalName: 'Sample Referring Clinic',
      corridorId: 'ly-tn',
      side: 'source',
      verification: {
        status: 'approved',
        submittedAt: '2026-09-01T10:00:00.000Z',
        decidedAt: '2026-09-02T10:00:00.000Z',
      },
      seatCount: 5,
    };
    expect(() => providerSchema.parse(toProvider(org))).not.toThrow();
  });
});
