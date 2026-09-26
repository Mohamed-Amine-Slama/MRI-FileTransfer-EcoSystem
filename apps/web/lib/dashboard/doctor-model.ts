import type { CaseRecord } from '../api/endpoints';
import { isWithinDays } from './time';

const at = (iso: string | null, fallback: string): number => Date.parse(iso ?? fallback);

/**
 * The receiving doctor's buckets. Triage is oldest first (the lab has waited
 * longest); answering is soonest-due first, because accepting started a clock.
 * Uncapped on purpose: this screen IS the doctor's list.
 */
export function doctorModel(
  cases: readonly CaseRecord[],
  now: number,
): { triage: CaseRecord[]; answering: CaseRecord[]; answered: CaseRecord[] } {
  return {
    triage: cases
      .filter((c) => c.status === 'paid')
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)),
    answering: cases
      .filter((c) => c.status === 'accepted')
      .sort((a, b) => at(a.answerDueAt, a.updatedAt) - at(b.answerDueAt, b.updatedAt)),
    answered: cases.filter((c) => isWithinDays(c.answeredAt, 7, now)),
  };
}
