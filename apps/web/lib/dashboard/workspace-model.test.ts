import { describe, expect, it } from 'vitest';
import type { Case, CaseStatus } from '@mir/contracts';
import { workspaceModel } from './workspace-model';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const H = 60 * 60 * 1000;

function c(ref: string, status: CaseStatus, hoursAgo: number): Case {
  const at = new Date(NOW - hoursAgo * H).toISOString();
  return {
    ref,
    corridorId: 'x',
    status,
    submittedByProviderId: 'p',
    patientId: 'pt',
    studyIds: [],
    createdAt: at,
    updatedAt: at,
    intake: {},
  } as Case;
}

describe('workspaceModel', () => {
  it('is all empty for no cases, and has no tasks for an unknown side', () => {
    expect(workspaceModel([], 'source', NOW)).toEqual({ tasks: [], waiting: [], stale: [], answered: [] });
    const m = workspaceModel([c('MIR-2026-0001', 'submitted', 1)], null, NOW);
    expect(m.tasks).toEqual([]);
    expect(m.waiting).toEqual([]);
  });

  it('splits the clinic’s tasks from cases waiting on the doctor, oldest first', () => {
    const cases = [
      c('MIR-2026-0003', 'submitted', 1),
      c('MIR-2026-0002', 'paid', 5),
      c('MIR-2026-0001', 'submitted', 10),
      c('MIR-2026-0004', 'accepted', 2),
    ];
    const m = workspaceModel(cases, 'source', NOW);
    expect(m.tasks.map((x) => x.ref)).toEqual(['MIR-2026-0001', 'MIR-2026-0003']);
    expect(m.waiting.map((x) => x.ref)).toEqual(['MIR-2026-0002', 'MIR-2026-0004']);
  });

  it('counts stale live cases and cases answered within 7 days', () => {
    const cases = [
      c('MIR-2026-0001', 'paid', 60),
      c('MIR-2026-0002', 'answered', 24),
      c('MIR-2026-0003', 'closed', 24 * 9),
      c('MIR-2026-0004', 'cancelled', 200),
    ];
    const m = workspaceModel(cases, 'source', NOW);
    expect(m.stale.map((x) => x.ref)).toEqual(['MIR-2026-0001']);
    expect(m.answered.map((x) => x.ref)).toEqual(['MIR-2026-0002']);
  });
});
