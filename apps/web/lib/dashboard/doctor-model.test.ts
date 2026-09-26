import { describe, expect, it } from 'vitest';
import type { CaseRecord } from '../api/endpoints';
import { doctorModel } from './doctor-model';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const H = 60 * 60 * 1000;
const iso = (hoursAgo: number): string => new Date(NOW - hoursAgo * H).toISOString();

function r(id: string, status: CaseRecord['status'], extra: Partial<CaseRecord> = {}): CaseRecord {
  return { id, caseRef: id, status, updatedAt: iso(1), answerDueAt: null, answeredAt: null, ...extra } as CaseRecord;
}

describe('doctorModel', () => {
  it('is empty for no cases', () => {
    expect(doctorModel([], NOW)).toEqual({ triage: [], answering: [], answered: [] });
  });

  it('puts paid cases in triage oldest first, and accepted ones by answer due date', () => {
    const m = doctorModel(
      [
        r('a', 'paid', { updatedAt: iso(1) }),
        r('b', 'paid', { updatedAt: iso(9) }),
        r('c', 'accepted', { answerDueAt: new Date(NOW + 30 * H).toISOString() }),
        r('d', 'accepted', { answerDueAt: new Date(NOW + 2 * H).toISOString() }),
      ],
      NOW,
    );
    expect(m.triage.map((x) => x.id)).toEqual(['b', 'a']);
    expect(m.answering.map((x) => x.id)).toEqual(['d', 'c']);
  });

  it('is uncapped — the doctor has no other list to hand off to', () => {
    const many = Array.from({ length: 12 }, (_, i) => r(`p${i}`, 'paid'));
    expect(doctorModel(many, NOW).triage).toHaveLength(12);
  });

  it('counts answers from the last 7 days, ignoring null answeredAt', () => {
    const m = doctorModel(
      [
        r('x', 'answered', { answeredAt: iso(24) }),
        r('y', 'closed', { answeredAt: iso(24 * 10) }),
        r('z', 'answered', { answeredAt: null }),
      ],
      NOW,
    );
    expect(m.answered.map((x) => x.id)).toEqual(['x']);
  });
});
