import { describe, expect, it } from 'vitest';
import {
  CURRENCY_MINOR_UNITS,
  LEDGER_ENTRY_KINDS,
  currencySchema,
  ledgerEntryKindSchema,
  ledgerEntrySchema,
  summariseLedger,
  toMajorUnits,
  type LedgerEntry,
} from './ledger';

const entries: LedgerEntry[] = [
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-1',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-04T11:30:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'paid',
  }),
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-2',
    caseRef: 'MIR-2026-0418',
    occurredAt: '2026-08-06T09:00:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'pending',
  }),
  ledgerEntrySchema.parse({
    kind: 'saas_subscription',
    id: 'led-3',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-08-31T23:59:59.000Z',
    occurredAt: '2026-08-01T00:00:00.000Z',
    amount: { amountMinor: 9900, currency: 'EUR' },
    status: 'overdue',
  }),
];

describe('ledger entry', () => {
  it('links a coordination fee back to its case reference (§5.7)', () => {
    const [first] = entries;
    expect(first?.kind).toBe('coordination_fee');
    if (first?.kind === 'coordination_fee') {
      expect(first.caseRef).toBe('MIR-2026-0417');
    }
  });

  it('refuses a coordination fee with no case, since the fee is per completed case', () => {
    expect(() =>
      ledgerEntrySchema.parse({
        kind: 'coordination_fee',
        id: 'led-x',
        occurredAt: '2026-08-04T11:30:00.000Z',
        amount: { amountMinor: 25000, currency: 'USD' },
        status: 'paid',
      }),
    ).toThrow();
  });

  it('refuses a subscription charge carrying a case reference, which would blur the two', () => {
    const parsed = ledgerEntrySchema.parse({
      kind: 'saas_subscription',
      id: 'led-y',
      caseRef: 'MIR-2026-0417',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T23:59:59.000Z',
      occurredAt: '2026-08-01T00:00:00.000Z',
      amount: { amountMinor: 9900, currency: 'EUR' },
      status: 'paid',
    });
    expect(Object.hasOwn(parsed, 'caseRef')).toBe(false);
  });

  it('stores money in minor units so no total is ever computed in floating point', () => {
    expect(() =>
      ledgerEntrySchema.parse({
        kind: 'saas_subscription',
        id: 'led-z',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-31T23:59:59.000Z',
        occurredAt: '2026-08-01T00:00:00.000Z',
        amount: { amountMinor: 99.5, currency: 'EUR' },
        status: 'paid',
      }),
    ).toThrow();
  });
});

describe('summariseLedger', () => {
  it('keeps the two charge kinds apart (§5.7 P0)', () => {
    const summary = summariseLedger(entries);
    expect(summary.coordinationFees.USD?.amountMinor).toBe(50000);
    expect(summary.subscriptions.EUR?.amountMinor).toBe(9900);
  });

  it('exposes no combined total — the requirement is that none can be rendered', () => {
    const summary = summariseLedger(entries);
    expect(Object.hasOwn(summary, 'total')).toBe(false);
    expect(Object.hasOwn(summary, 'amountOwed')).toBe(false);
    expect(Object.hasOwn(summary, 'balance')).toBe(false);
  });

  it('groups by currency rather than summing across them (§5.7 multi-currency)', () => {
    const summary = summariseLedger([
      ...entries,
      ledgerEntrySchema.parse({
        kind: 'coordination_fee',
        id: 'led-4',
        caseRef: 'MIR-2026-0419',
        occurredAt: '2026-08-07T09:00:00.000Z',
        amount: { amountMinor: 20000, currency: 'EUR' },
        status: 'pending',
      }),
    ]);
    expect(summary.coordinationFees.USD?.amountMinor).toBe(50000);
    expect(summary.coordinationFees.EUR?.amountMinor).toBe(20000);
  });

  it('counts what is outstanding per kind, for the §5.7 payment status indicators', () => {
    const summary = summariseLedger(entries);
    expect(summary.outstanding.coordination_fee).toBe(1);
    expect(summary.outstanding.saas_subscription).toBe(1);
  });

  it('summarises an empty ledger without inventing a zero total', () => {
    const summary = summariseLedger([]);
    expect(summary.coordinationFees).toEqual({});
    expect(summary.subscriptions).toEqual({});
    expect(summary.outstanding.coordination_fee).toBe(0);
  });
});

describe('minor units are per-currency (§5.7 multi-currency)', () => {
  it('knows the Tunisian and Libyan dinar are three-decimal currencies', () => {
    // ISO 4217 gives TND and LYD an exponent of 3. Assuming 2 everywhere —
    // the usual shortcut — misreports every dinar amount by a factor of ten,
    // and these are the corridor's own local currencies.
    expect(CURRENCY_MINOR_UNITS.TND).toBe(3);
    expect(CURRENCY_MINOR_UNITS.LYD).toBe(3);
    expect(CURRENCY_MINOR_UNITS.USD).toBe(2);
    expect(CURRENCY_MINOR_UNITS.EUR).toBe(2);
  });

  it('converts minor units to major units using the currency exponent', () => {
    expect(toMajorUnits({ amountMinor: 25000, currency: 'USD' })).toBe(250);
    expect(toMajorUnits({ amountMinor: 25000, currency: 'TND' })).toBe(25);
  });

  it('covers every currency in the enum, so a new one cannot be forgotten', () => {
    for (const currency of currencySchema.options) {
      expect(CURRENCY_MINOR_UNITS[currency]).toBeGreaterThan(0);
    }
  });
});

/**
 * The kinds as a value, not just as a type.
 *
 * Migration 0023's CHECK constraint mirrors this list, and the accrual service
 * writes against it. A type alone cannot be compared to a database constraint;
 * a `const` can be, and the assertion below is what makes the two drift
 * visibly rather than silently.
 */
describe('ledger entry kinds', () => {
  it('exposes the closed set the database CHECK mirrors', () => {
    expect(LEDGER_ENTRY_KINDS).toEqual(['coordination_fee', 'saas_subscription']);
  });

  it('rejects a kind outside the set', () => {
    expect(ledgerEntryKindSchema.safeParse('overage').success).toBe(false);
  });

  it('covers exactly the kinds the union discriminates on', () => {
    // The two must not drift: a kind in the union but not in this list would
    // pass the schema and fail the database CHECK, at write time, in
    // production.
    const fromUnion = ledgerEntrySchema.options.map((o) => o.shape.kind.value).sort();
    expect(fromUnion).toEqual([...LEDGER_ENTRY_KINDS].sort());
  });

  it('summariseLedger still produces no total across kinds', () => {
    const summary = summariseLedger([]);
    expect(summary).not.toHaveProperty('total');
    expect(Object.keys(summary.outstanding).sort()).toEqual([
      'coordination_fee',
      'saas_subscription',
    ]);
  });
});
