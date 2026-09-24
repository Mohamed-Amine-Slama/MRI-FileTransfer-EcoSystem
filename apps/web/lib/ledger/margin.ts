import type { CurrencyCode, LedgerSummary, Money } from '@mir/contracts';

type Totals = Partial<Record<CurrencyCode, Money>>;

/**
 * What the platform keeps, per currency — spec 2026-09-21 §3.
 *
 * Remittances the clinics owe the platform ($70 a paid case) less payouts the
 * platform owes doctors ($20 an answered case). Per currency and never across
 * currencies: a margin in USD less one in TND is a number that is wrong in both.
 * Subscriptions stay out, as everywhere (§5.7 P0).
 */
export function platformMargin(summary: Pick<LedgerSummary, 'coordinationFees' | 'doctorPayouts'>): Totals {
  const out: Totals = {};
  const currencies = new Set([
    ...Object.keys(summary.coordinationFees),
    ...Object.keys(summary.doctorPayouts),
  ]) as Set<CurrencyCode>;
  for (const currency of currencies) {
    const inMinor = summary.coordinationFees[currency]?.amountMinor ?? 0;
    const outMinor = summary.doctorPayouts[currency]?.amountMinor ?? 0;
    out[currency] = { amountMinor: inMinor - outMinor, currency };
  }
  return out;
}
