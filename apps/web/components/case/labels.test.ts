import { describe, expect, it } from 'vitest';
import {
  CASE_STATUSES,
  CASE_SIDES,
  PAYMENT_STATUSES,
  PROVIDER_KINDS,
  VERIFICATION_STATUSES,
  isTerminalStatus,
} from '@mir/contracts';
import { DICTIONARIES } from '../../lib/i18n/dictionary';
import {
  patientBriefLabel,
  REJECTION_REASON_KEYS,
  caseStatusLabel,
  formatMoney,
  isAwaitingSide,
  isRejectionReasonKey,
  nextActionLabel,
  paymentStatusLabel,
  providerKindLabel,
  sideLabel,
  verificationLabel,
  verificationReasonLabel,
} from './labels';

/**
 * These are exhaustive-Record lookups, so the compiler already catches a
 * missing case. What it cannot catch is a key that resolves to the empty
 * string, or a locale whose table left an entry blank — which is what would
 * actually reach a clinic receptionist as a blank status column.
 */
const LOCALES = Object.entries(DICTIONARIES);

describe('enum labels resolve in every locale', () => {
  it.each(LOCALES)('%s renders every case status', (_locale, t) => {
    for (const status of CASE_STATUSES) {
      expect(caseStatusLabel(t, status)).not.toBe('');
    }
  });

  it.each(LOCALES)('%s renders every side, payment status, and kind', (_locale, t) => {
    for (const side of CASE_SIDES) expect(sideLabel(t, side)).not.toBe('');
    for (const status of PAYMENT_STATUSES) expect(paymentStatusLabel(t, status)).not.toBe('');
    for (const kind of PROVIDER_KINDS) expect(providerKindLabel(t, kind)).not.toBe('');
    for (const status of VERIFICATION_STATUSES) expect(verificationLabel(t, status)).not.toBe('');
  });

  it.each(LOCALES)('%s tells the two sides different things about one case (§5.3)', (_l, t) => {
    // A paid case is the doctor's move — they triage it — and the lab's only
    // job is to wait. If both sides read the same sentence, the next-action
    // column is decoration.
    expect(nextActionLabel(t, 'paid', 'source')).not.toBe(
      nextActionLabel(t, 'paid', 'destination'),
    );
  });

  it.each(LOCALES)('%s says nothing is expected on a finished case', (_locale, t) => {
    for (const side of CASE_SIDES) {
      expect(nextActionLabel(t, 'closed', side)).toBe(t.nextActionNone);
      expect(nextActionLabel(t, 'cancelled', side)).toBe(t.nextActionNone);
    }
  });
});

describe('rejection reasons travel as dictionary keys (§4.2, §5.1)', () => {
  it.each(LOCALES)('%s resolves every offered reason', (_locale, t) => {
    for (const key of REJECTION_REASON_KEYS) {
      expect(verificationReasonLabel(t, key)).not.toBeNull();
    }
  });

  it('returns null for an unknown key rather than echoing it at the applicant', () => {
    const [t] = Object.values(DICTIONARIES);
    expect(t).toBeDefined();
    if (t === undefined) return;
    expect(verificationReasonLabel(t, 'verificationReasonInvented')).toBeNull();
    expect(verificationReasonLabel(t, undefined)).toBeNull();
  });

  it('narrows a string to a known reason key', () => {
    expect(isRejectionReasonKey('verificationReasonLicenceExpired')).toBe(true);
    expect(isRejectionReasonKey('nextActionNone')).toBe(false);
  });
});

describe('money formatting (§5.7)', () => {
  it('applies the currency exponent, not a hardcoded 100', () => {
    // 99000 minor units is 99 dinars in a three-decimal currency. Formatting
    // it as 990 would overstate every dinar invoice tenfold.
    expect(formatMoney('en-GB', { amountMinor: 99000, currency: 'TND' })).toContain('99');
    expect(formatMoney('en-GB', { amountMinor: 25000, currency: 'USD' })).toContain('250');
  });

  it('formats the same amount differently per locale, and never throws', () => {
    for (const locale of ['ar-LY', 'fr-TN', 'en-GB']) {
      expect(formatMoney(locale, { amountMinor: 25000, currency: 'USD' })).not.toBe('');
    }
  });
});

describe('the §5.5 task rule is decided on the enum, not on copy', () => {
  it('makes a submitted case the referring side’s move and nobody else’s', () => {
    expect(isAwaitingSide('submitted', 'source')).toBe(true);
    expect(isAwaitingSide('submitted', 'destination')).toBe(false);
  });

  it('hands a paid case to the receiving side to triage', () => {
    expect(isAwaitingSide('paid', 'destination')).toBe(true);
  });

  /**
   * A refusal is not an ending: the lab picks again. This is the property the
   * payment hold depends on, so it is asserted here as well as in the contract.
   */
  it('gives a declined case back to the referring side', () => {
    expect(isAwaitingSide('declined', 'source')).toBe(true);
    expect(isAwaitingSide('declined', 'destination')).toBe(false);
  });

  it('never leaves a finished case on anyone’s task list', () => {
    for (const side of CASE_SIDES) {
      for (const status of ['closed', 'expired', 'cancelled'] as const) {
        expect(isAwaitingSide(status, side)).toBe(false);
      }
    }
  });

  it('agrees with the rendered label in every locale', () => {
    // The two must not be able to drift: if this ever fails, one screen is
    // calling a case a task while another says there is nothing to do.
    for (const t of Object.values(DICTIONARIES)) {
      for (const status of CASE_STATUSES) {
        for (const side of CASE_SIDES) {
          const labelled = nextActionLabel(t, status, side) !== t.nextActionNone;
          expect(isAwaitingSide(status, side)).toBe(labelled && !isTerminalStatus(status));
        }
      }
    }
  });
});

describe('patientBriefLabel', () => {
  const t = DICTIONARIES.en;

  it('renders the age and the sex, and never a name', () => {
    const label = patientBriefLabel(t, { patientAgeYears: 62, patientSex: 'F' });
    expect(label).toContain('62');
    expect(label).toContain(t.sexFemale);
  });

  it('renders a dash for the lab, which gets no projection', () => {
    expect(patientBriefLabel(t, { patientAgeYears: null, patientSex: null })).toBe('\u2014');
    expect(patientBriefLabel(t, {})).toBe('\u2014');
  });

  it('renders the age alone rather than a bare letter for an unknown sex code', () => {
    const label = patientBriefLabel(t, { patientAgeYears: 40, patientSex: 'Z' });
    expect(label).toContain('40');
    expect(label).not.toContain('Z');
  });

  it('is translated in every locale — no English leaks into an Arabic screen', () => {
    for (const [locale, dict] of Object.entries(DICTIONARIES)) {
      const label = patientBriefLabel(dict, { patientAgeYears: 55, patientSex: 'M' });
      expect(label, locale).toContain('55');
      expect(label, locale).not.toBe('\u2014');
    }
  });
});
