import { describe, expect, it } from 'vitest';
import { platformMargin } from './margin';

describe('platform margin (spec 2026-09-21 §3)', () => {
  it('is remittances in less payouts out: $70 − $20 = $50 a case', () => {
    expect(
      platformMargin({
        coordinationFees: { USD: { amountMinor: 7000, currency: 'USD' } },
        doctorPayouts: { USD: { amountMinor: 2000, currency: 'USD' } },
      }),
    ).toEqual({ USD: { amountMinor: 5000, currency: 'USD' } });
  });

  it('keeps currencies apart, never netting one against another', () => {
    expect(
      platformMargin({
        coordinationFees: { USD: { amountMinor: 7000, currency: 'USD' } },
        doctorPayouts: { TND: { amountMinor: 60000, currency: 'TND' } },
      }),
    ).toEqual({
      USD: { amountMinor: 7000, currency: 'USD' },
      TND: { amountMinor: -60000, currency: 'TND' },
    });
  });
});
