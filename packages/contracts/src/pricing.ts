/**
 * What a consult costs — consult-model spec Part 2.
 *
 *   quote = specialty base x the doctor's earned tier x scarcity surge
 *
 * WHY THIS LIVES IN CONTRACTS. The lab sees an indicative price next to every
 * doctor in the directory and is then charged the one the API locks. Two
 * implementations of the same formula would disagree eventually, and the
 * disagreement would be discovered by a clinic being charged more than the
 * screen promised. One function, both callers.
 *
 * WHY BASIS POINTS AND NOT FLOATS. Money in this codebase is integer minor
 * units (`moneySchema`), and a float multiplier reintroduces exactly the
 * rounding that convention exists to prevent. A multiplier is an integer count
 * of ten-thousandths; `BP_ONE` is x1.00.
 *
 * WHY ONE ROUNDING. Three multiplications rounded independently drift, and the
 * drift lands in the doctor's payout. The whole product is computed exactly and
 * rounded once, at the end.
 */

/** x1.00, in basis points. */
export const BP_ONE = 10_000;

export const TIER_CODES = ['standard', 'senior', 'expert'] as const;
export type TierCode = (typeof TIER_CODES)[number];

export interface SurgeRung {
  /** The fewest accepting doctors this rung applies to. */
  readonly minAccepting: number;
  readonly multiplierBp: number;
}

/**
 * Published, bounded, three rungs plus closed.
 *
 * A continuous formula is impossible to explain to a lab, impossible to defend
 * to a regulator, and unbounded in exactly the direction that looks worst in a
 * medical market. Ordered densest-first; `surgeMultiplierBp` takes the first
 * rung that matches, and a test asserts that ordering so a later edit cannot
 * silently invert the ladder.
 */
export const SURGE_LADDER: readonly SurgeRung[] = [
  { minAccepting: 5, multiplierBp: 10_000 },
  { minAccepting: 3, multiplierBp: 11_500 },
  { minAccepting: 1, multiplierBp: 13_000 },
];

/**
 * `null` means the specialty is closed — nobody is accepting, so there is no
 * price to quote. Returning a very large number instead would quote a lab a
 * price that no doctor is available to answer.
 */
export function surgeMultiplierBp(acceptingCount: number): number | null {
  if (!Number.isInteger(acceptingCount) || acceptingCount < 1) return null;
  for (const rung of SURGE_LADDER) {
    if (acceptingCount >= rung.minAccepting) return rung.multiplierBp;
  }
  return null;
}

/**
 * BigInt because `baseMinor x tierBp x surgeBp` leaves the exact-integer range
 * of a double at around a $90,000 base, and a silently inexact price is worse
 * than a slow one. Values are non-negative, so adding half the divisor before
 * truncating is half-up rounding.
 *
 * The guards throw rather than clamp: a negative or fractional input here means
 * a caller has a bug, and quoting a plausible-looking number would hide it
 * until someone disputed an invoice.
 */
export function quoteAmountMinor(baseMinor: number, tierBp: number, surgeBp: number): number {
  if (!Number.isInteger(baseMinor) || baseMinor < 0) {
    throw new RangeError(`baseMinor must be a non-negative integer, got ${baseMinor}`);
  }
  if (!Number.isInteger(tierBp) || tierBp <= 0) {
    throw new RangeError(`tierBp must be a positive integer, got ${tierBp}`);
  }
  if (!Number.isInteger(surgeBp) || surgeBp <= 0) {
    throw new RangeError(`surgeBp must be a positive integer, got ${surgeBp}`);
  }
  const divisor = BigInt(BP_ONE) * BigInt(BP_ONE);
  const scaled = BigInt(baseMinor) * BigInt(tierBp) * BigInt(surgeBp);
  return Number((scaled + divisor / 2n) / divisor);
}
