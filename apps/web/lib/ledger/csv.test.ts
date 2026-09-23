import { describe, expect, it } from 'vitest';
import { ledgerEntrySchema, type LedgerEntry } from '@mir/contracts';
import { coordinationFeeCsv, csvField, doctorPayoutCsv, subscriptionCsv } from './csv';

const entries: LedgerEntry[] = [
  ledgerEntrySchema.parse({
    kind: 'coordination_fee',
    id: 'led-1',
    caseRef: 'MIR-2026-0417',
    occurredAt: '2026-08-06T11:30:00.000Z',
    amount: { amountMinor: 25000, currency: 'USD' },
    status: 'pending',
  }),
  ledgerEntrySchema.parse({
    kind: 'saas_subscription',
    id: 'led-2',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-08-31T23:59:59.000Z',
    occurredAt: '2026-08-01T00:00:00.000Z',
    amount: { amountMinor: 99000, currency: 'TND' },
    status: 'overdue',
  }),
  ledgerEntrySchema.parse({
    kind: 'doctor_payout',
    id: 'led-3',
    caseRef: 'MIR-2026-0418',
    occurredAt: '2026-08-07T09:00:00.000Z',
    amount: { amountMinor: 2000, currency: 'USD' },
    status: 'pending',
  }),
];

describe('ledger CSV export (§5.7)', () => {
  it('exports coordination fees with their case reference', () => {
    const csv = coordinationFeeCsv(entries);
    expect(csv.split('\r\n')[0]).toBe('id,date,case_ref,amount,currency,payment_status');
    expect(csv).toContain('led-1,2026-08-06,MIR-2026-0417,250.00,USD,pending');
  });

  it('exports doctor payouts on their own, never among the clinic fees', () => {
    const csv = doctorPayoutCsv(entries);
    expect(csv.split('\r\n')).toEqual([
      'id,date,case_ref,amount,currency,payment_status',
      'led-3,2026-08-07,MIR-2026-0418,20.00,USD,pending',
    ]);
    expect(coordinationFeeCsv(entries)).not.toContain('led-3');
  });

  it('exports subscriptions with their billing period', () => {
    const csv = subscriptionCsv(entries);
    expect(csv.split('\r\n')[0]).toBe(
      'id,date,period_start,period_end,amount,currency,payment_status',
    );
    // TND is a three-decimal currency: 99000 minor units is 99 dinars, not 990.
    expect(csv).toContain('led-2,2026-08-01,2026-08-01,2026-08-31,99.000,TND,overdue');
  });

  it('never puts the two kinds in one file, so no export can imply one total', () => {
    expect(coordinationFeeCsv(entries)).not.toContain('led-2');
    expect(subscriptionCsv(entries)).not.toContain('led-1');
  });

  it('emits a header even when there is nothing to export', () => {
    expect(coordinationFeeCsv([]).split('\r\n')).toHaveLength(1);
    expect(subscriptionCsv([])).toContain('period_start');
  });

  it('has no total row — there is no combined amount to write', () => {
    expect(coordinationFeeCsv(entries).toLowerCase()).not.toContain('total');
  });

  it('quotes separators and doubles embedded quotes', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField('plain')).toBe('plain');
  });

  it('neutralises spreadsheet formulas without mangling negative amounts', () => {
    // A ledger is opened in Excel by whoever does the billing, so a field that
    // starts a formula is a live risk, not a theoretical one.
    expect(csvField('=cmd()')).toBe("'=cmd()");
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    // A credit note is a legitimate negative number and must stay numeric.
    expect(csvField('-250.00')).toBe('-250.00');
    expect(csvField('-refund')).toBe("'-refund");
  });
});
