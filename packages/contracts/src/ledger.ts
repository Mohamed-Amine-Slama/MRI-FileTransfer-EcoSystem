import { z } from 'zod';
import { caseRefSchema } from './case';

/**
 * The ledger — brief §5.7.
 *
 * WHY A DISCRIMINATED UNION.
 * §5.7 P0 says coordination fees and subscription charges must never be merged
 * into one ambiguous "amount owed" line. A single shape with an `amount` and a
 * `type` field satisfies that only for as long as every future screen remembers
 * to split them. A union with no common total does not depend on anyone
 * remembering: there is no field to render, so the ambiguous line cannot be
 * built by accident. `summariseLedger` returns the same shape for the same
 * reason.
 *
 * Money is minor units plus an explicit currency. Amounts are never floats, and
 * never summed across currencies (§5.7 multi-currency) — the summary groups.
 */

export const currencySchema = z.enum(['USD', 'EUR', 'TND', 'LYD']);
export type CurrencyCode = z.infer<typeof currencySchema>;

export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

/**
 * How many minor units make one major unit, per ISO 4217.
 *
 * NOT a constant 100. The dinar currencies of this corridor — TND and LYD —
 * have an exponent of 3, so dividing every amount by 100 would overstate every
 * dinar figure tenfold on the ledger of the very providers the platform bills.
 * Declaring it as a total Record means adding a currency to the enum without
 * stating its exponent is a compile error.
 */
export const CURRENCY_MINOR_UNITS: Record<CurrencyCode, number> = {
  USD: 2,
  EUR: 2,
  TND: 3,
  LYD: 3,
};

/**
 * Minor units to major units. The single place the exponent is applied, so a
 * screen, a CSV export, and a total cannot disagree about what 25000 means.
 */
export function toMajorUnits(money: Money): number {
  return money.amountMinor / 10 ** CURRENCY_MINOR_UNITS[money.currency];
}

export const PAYMENT_STATUSES = ['paid', 'pending', 'overdue'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * The closed set of entry kinds, mirrored by the `billing_ledger_entries`
 * CHECK constraint (migration 0023).
 *
 * Exported as a VALUE because a union type cannot be compared against a
 * database constraint, iterated to build a summary, or asserted on in a test.
 * The union below discriminates on exactly these strings, and a test asserts
 * the two agree — a kind in one and not the other would parse cleanly and fail
 * at write time.
 *
 * The two kinds share a table but must never share a total: §5.7 P0 forbids
 * merging coordination fees with subscription charges into one "amount owed".
 * `LedgerSummary` has no total field, and nothing here should learn how to make
 * one.
 */
export const LEDGER_ENTRY_KINDS = ['coordination_fee', 'saas_subscription'] as const;
export const ledgerEntryKindSchema = z.enum(LEDGER_ENTRY_KINDS);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindSchema>;

const ledgerEntryBase = {
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  amount: moneySchema,
  status: paymentStatusSchema,
};

/** Per completed case, and therefore always carrying its case reference (§5.7 P1). */
export const coordinationFeeEntrySchema = z.object({
  ...ledgerEntryBase,
  kind: z.literal('coordination_fee'),
  caseRef: caseRefSchema,
});
export type CoordinationFeeEntry = z.infer<typeof coordinationFeeEntrySchema>;

/**
 * Per billing period, and deliberately carrying no case reference. Zod strips
 * unknown keys by default, so a `caseRef` supplied here is dropped rather than
 * preserved — the two kinds cannot be blurred even by a careless caller.
 */
export const saasSubscriptionEntrySchema = z.object({
  ...ledgerEntryBase,
  kind: z.literal('saas_subscription'),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type SaasSubscriptionEntry = z.infer<typeof saasSubscriptionEntrySchema>;

export const ledgerEntrySchema = z.discriminatedUnion('kind', [
  coordinationFeeEntrySchema,
  saasSubscriptionEntrySchema,
]);
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

type TotalsByCurrency = Partial<Record<CurrencyCode, Money>>;

/**
 * Deliberately has no `total`, `balance`, or `amountOwed`. See the union note
 * above — the omission is the feature, and a test asserts the absence.
 */
export interface LedgerSummary {
  coordinationFees: TotalsByCurrency;
  subscriptions: TotalsByCurrency;
  outstanding: Record<LedgerEntry['kind'], number>;
}

function addTo(totals: TotalsByCurrency, amount: Money): void {
  const existing = totals[amount.currency];
  totals[amount.currency] = {
    currency: amount.currency,
    amountMinor: (existing?.amountMinor ?? 0) + amount.amountMinor,
  };
}

export function summariseLedger(entries: readonly LedgerEntry[]): LedgerSummary {
  const summary: LedgerSummary = {
    coordinationFees: {},
    subscriptions: {},
    outstanding: { coordination_fee: 0, saas_subscription: 0 },
  };

  for (const entry of entries) {
    const bucket =
      entry.kind === 'coordination_fee' ? summary.coordinationFees : summary.subscriptions;
    addTo(bucket, entry.amount);
    if (entry.status !== 'paid') {
      summary.outstanding[entry.kind] += 1;
    }
  }

  return summary;
}
