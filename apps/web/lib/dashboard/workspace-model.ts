import { isTerminalStatus, type Case, type CaseSide } from '@mir/contracts';
import { isAwaitingSide, isWaitingOnOther } from '../../components/case/labels';
import { isStale, isWithinDays } from './time';

const oldestFirst = (a: Case, b: Case): number => Date.parse(a.updatedAt) - Date.parse(b.updatedAt);

/**
 * The clinic dashboard's buckets. Oldest first: the case that has waited
 * longest for this clinic is the one at the top of its morning.
 */
export function workspaceModel(
  cases: readonly Case[],
  side: CaseSide | null,
  now: number,
): { tasks: Case[]; waiting: Case[]; stale: Case[]; answered: Case[] } {
  const active = cases.filter((item) => !isTerminalStatus(item.status));
  return {
    tasks:
      side === null ? [] : active.filter((item) => isAwaitingSide(item.status, side)).sort(oldestFirst),
    waiting:
      side === null ? [] : active.filter((item) => isWaitingOnOther(item.status, side)).sort(oldestFirst),
    stale: active.filter((item) => isStale(item, now)).sort(oldestFirst),
    answered: cases.filter(
      (item) =>
        (item.status === 'answered' || item.status === 'closed') && isWithinDays(item.updatedAt, 7, now),
    ),
  };
}
