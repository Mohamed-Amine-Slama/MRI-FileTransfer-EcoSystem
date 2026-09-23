import { toMajorUnits, type Entitlement, type Money, type PlanTier } from '@mir/contracts';
import type { Dictionary } from '../i18n/dictionary';

/**
 * Presentation for plan tiers — brief §5.7.
 *
 * The catalogue carries DICTIONARY KEYS, not copy (see `plan.ts`), so this is
 * where a key becomes a sentence. Keeping it in one module means the pricing
 * page and the in-app billing panel cannot describe the same tier differently.
 */

/**
 * `labelKey` is a string on the wire, and the dictionary is a closed set. An
 * unknown key means the catalogue has a tier this build does not have copy for
 * — a deploy-order problem, not a user's problem — so it falls back to the code
 * rather than rendering the raw key or crashing the page.
 */
function fromDictionary(t: Dictionary, key: string, fallback: string): string {
  const table = t as unknown as Record<string, string | undefined>;
  return table[key] ?? fallback;
}

export function planName(t: Dictionary, tier: PlanTier): string {
  return fromDictionary(t, tier.labelKey, tier.code);
}

/** "per month" / "per year" — what a tier's price buys. */
export function perIntervalLabel(t: Dictionary, interval: PlanTier['interval']): string {
  return interval === 'year' ? t.pricingPerYear : t.pricingPerMonth;
}

export function planBlurb(t: Dictionary, tier: PlanTier): string {
  return fromDictionary(t, tier.blurbKey, '');
}

export function entitlementLabel(t: Dictionary, entitlement: Entitlement): string {
  // Exhaustive: a new entitlement in the contract is a compile error here
  // rather than a feature bullet that silently disappears from the table.
  const labels: Record<Entitlement, string> = {
    csvExport: t.entitlementCsvExport,
    prioritySupport: t.entitlementPrioritySupport,
    auditTrailRetention: t.entitlementAuditTrailRetention,
    multiCorridor: t.entitlementMultiCorridor,
    dedicatedOnboarding: t.entitlementDedicatedOnboarding,
  };
  return labels[entitlement];
}

/**
 * Money, in the reader's locale.
 *
 * ALWAYS through `toMajorUnits`, never `/100`. TND and LYD have an ISO exponent
 * of 3, and this corridor's own local currencies are exactly the ones a
 * hardcoded hundred would overstate tenfold.
 */
export function formatPrice(money: Money, localeTag: string): string {
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: money.currency,
    // Minor units are exact; showing 49.00 rather than 49 is noise on a price
    // list, but a fractional dinar figure must not be rounded away.
    maximumFractionDigits: Number.isInteger(toMajorUnits(money)) ? 0 : 2,
  }).format(toMajorUnits(money));
}

/** "10 seats", or "Unlimited seats" — the null limit is a state, not a number. */
export function seatsLabel(t: Dictionary, limit: number | null): string {
  return limit === null ? t.pricingSeatsUnlimited : `${limit} ${t.pricingSeats}`;
}

export function casesLabel(t: Dictionary, limit: number | null): string {
  return limit === null ? t.pricingCasesUnlimited : `${limit} ${t.pricingCases}`;
}
