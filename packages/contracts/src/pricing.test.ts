import { describe, expect, it } from 'vitest';
import { BP_ONE, quoteAmountMinor, surgeMultiplierBp, SURGE_LADDER } from './pricing';

describe('surge ladder', () => {
  it('is flat when the specialty is well staffed', () => {
    expect(surgeMultiplierBp(5)).toBe(10_000);
    expect(surgeMultiplierBp(50)).toBe(10_000);
  });

  it('steps up as doctors go offline', () => {
    expect(surgeMultiplierBp(4)).toBe(11_500);
    expect(surgeMultiplierBp(3)).toBe(11_500);
    expect(surgeMultiplierBp(2)).toBe(13_000);
    expect(surgeMultiplierBp(1)).toBe(13_000);
  });

  /**
   * Nobody accepting is not "very expensive" — it is closed. Returning a huge
   * number here would quote a lab a price no doctor is available to answer.
   */
  it('refuses to quote when nobody is accepting', () => {
    expect(surgeMultiplierBp(0)).toBeNull();
    expect(surgeMultiplierBp(-1)).toBeNull();
  });

  it('is bounded — the top rung is the top price', () => {
    const max = Math.max(...SURGE_LADDER.map((r) => r.multiplierBp));
    expect(max).toBe(13_000);
  });

  it('is ordered densest-first, so the first matching rung is the right one', () => {
    const mins = SURGE_LADDER.map((r) => r.minAccepting);
    expect(mins).toEqual([...mins].sort((a, b) => b - a));
  });
});

describe('quoteAmountMinor', () => {
  it('is the base when both multipliers are one', () => {
    expect(quoteAmountMinor(4_000, BP_ONE, BP_ONE)).toBe(4_000);
  });

  it('applies tier and surge together', () => {
    // 4000 x 1.20 x 1.15 = 5520
    expect(quoteAmountMinor(4_000, 12_000, 11_500)).toBe(5_520);
  });

  /**
   * THE POINT OF THIS TEST. Rounding after each multiplication drifts, and the
   * drift lands in the doctor's payout. These are the exact one-shot results.
   */
  it('rounds once, at the end', () => {
    expect(quoteAmountMinor(1, 11_500, 13_000)).toBe(1); // 1.495
    expect(quoteAmountMinor(3, 11_500, 13_000)).toBe(4); // 4.485
    expect(quoteAmountMinor(7, 11_500, 13_000)).toBe(10); // 10.465
  });

  it('rounds half up', () => {
    // 1 x 1.50 x 1.00 = 1.5 -> 2
    expect(quoteAmountMinor(1, 15_000, BP_ONE)).toBe(2);
  });

  /**
   * base x tierBp x surgeBp leaves the exact-integer range of a double well
   * before the amounts get absurd, and a silently inexact price is worse than
   * a slow one.
   */
  it('is exact at absurd magnitudes', () => {
    expect(quoteAmountMinor(100_000_000, 14_000, 13_000)).toBe(182_000_000);
  });

  it('refuses nonsense inputs rather than returning a plausible number', () => {
    expect(() => quoteAmountMinor(-1, BP_ONE, BP_ONE)).toThrow(/baseMinor/);
    expect(() => quoteAmountMinor(1.5, BP_ONE, BP_ONE)).toThrow(/baseMinor/);
    expect(() => quoteAmountMinor(100, 0, BP_ONE)).toThrow(/tierBp/);
    expect(() => quoteAmountMinor(100, BP_ONE, 0)).toThrow(/surgeBp/);
  });
});
