import { describe, expect, it } from 'vitest';
import { QUEUE_CAP, capQueue } from './queue';

describe('capQueue', () => {
  it('shows everything and no "see all" at or under the cap', () => {
    const rows = [1, 2, 3, 4, 5];
    expect(capQueue(rows)).toEqual({ shown: rows, more: false });
  });
  it('shows exactly the cap and flags more beyond it', () => {
    const rows = Array.from({ length: 44 }, (_, i) => i);
    const { shown, more } = capQueue(rows);
    expect(shown).toHaveLength(QUEUE_CAP);
    expect(shown[0]).toBe(0);
    expect(more).toBe(true);
  });
  it('handles an empty queue', () => {
    expect(capQueue([])).toEqual({ shown: [], more: false });
  });
  it('can be uncapped with Infinity', () => {
    const rows = Array.from({ length: 9 }, (_, i) => i);
    expect(capQueue(rows, Infinity)).toEqual({ shown: rows, more: false });
  });
});
