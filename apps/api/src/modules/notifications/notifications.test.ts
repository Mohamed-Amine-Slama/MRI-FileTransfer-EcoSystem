import { describe, expect, it } from 'vitest';
import type { Locale } from '@mir/contracts';
import {
  DisallowedTemplateVariableError,
  TEMPLATES,
  placeholdersUsedBy,
  render,
  type Channel,
  type TemplateId,
} from './internal/templates';

/**
 * BUILD_SPEC PHASE 12 gate:
 * "Automated test blocks clinical data in notification payloads."
 *
 * "Inspect every template; assert in a test that no template interpolates a
 *  clinical field."
 *
 * The tests below iterate over EVERY template in EVERY channel and locale, so
 * a template added later is covered without anyone remembering to add a case.
 */

const ALL_TEMPLATES = Object.keys(TEMPLATES) as TemplateId[];
const CHANNELS: Channel[] = ['sms', 'email'];
const LOCALES: Locale[] = ['ar', 'fr'];

/**
 * Variable names that would carry clinical meaning.
 *
 * A template must not reference any of these. The list is deliberately wider
 * than the fields that exist today — the point is to block the NEXT person who
 * adds one, at the moment they add it.
 */
const CLINICAL_VARIABLE_NAMES = [
  'modality',
  'bodyPart',
  'body_part',
  'diagnosis',
  'findings',
  'studyDescription',
  'study_description',
  'seriesDescription',
  'clinicalNotes',
  'clinical_notes',
  'indication',
  'reasonForReferral',
  'symptoms',
  'condition',
  'referralNotes',
];

/** Substrings that would betray a clinical detail in rendered output. */
const CLINICAL_VOCABULARY = [
  // English
  'ct scan', 'mri', 'x-ray', 'chest', 'brain', 'tumour', 'tumor', 'fracture',
  'cancer', 'diagnosis', 'lesion', 'biopsy', 'scan of',
  // French
  'scanner', 'irm', 'radiographie', 'thorax', 'cerveau', 'tumeur', 'fracture',
  'diagnostic', 'lésion',
  // Arabic
  'أشعة', 'تشخيص', 'ورم', 'كسر', 'دماغ', 'صدر', 'سرطان',
];

/**
 * Match a clinical term as a WORD, not as a substring.
 *
 * Naive `includes` produced a false positive: "irm" (IRM, French for MRI) is
 * inside "confirmé". A check that cries wolf on the word "confirmed" would be
 * relaxed within a week, and then it would catch nothing.
 *
 * Latin-script terms use word boundaries. Arabic terms use plain containment,
 * because \b is defined on ASCII word characters and does not apply — Arabic
 * script cannot appear accidentally inside a French or English word anyway.
 */
function mentions(haystack: string, term: string): boolean {
  // Codepoint check rather than a regex range: a range starting at \x00 is a
  // control-character class, which lint (rightly) rejects as almost always a
  // mistake.
  const isLatin = [...term].every((ch) => (ch.codePointAt(0) ?? 0) < 128);
  if (!isLatin) return haystack.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

describe('PHASE 12 notification templates', () => {
  it('every template declares only non-clinical variables', () => {
    for (const id of ALL_TEMPLATES) {
      for (const allowed of TEMPLATES[id].allowed) {
        expect(
          CLINICAL_VARIABLE_NAMES.map((n) => n.toLowerCase()),
          `template "${id}" allows clinical variable "${allowed}"`,
        ).not.toContain(allowed.toLowerCase());
      }
    }
  });

  it('no template interpolates a variable it did not declare', () => {
    // A placeholder with no matching allowed-variable renders empty, which
    // would ship a half-written sentence to a patient.
    for (const id of ALL_TEMPLATES) {
      const used = placeholdersUsedBy(id);
      for (const name of used) {
        expect(
          TEMPLATES[id].allowed as string[],
          `template "${id}" uses undeclared placeholder "${name}"`,
        ).toContain(name);
      }
    }
  });

  it('no rendered template contains clinical vocabulary, in any locale', () => {
    // Filled with values that are themselves non-clinical.
    const variables = {
      firstName: 'محمد',
      code: '123456',
      appointmentTime: '2026-06-15 10:00',
      doctorName: 'Dr Ben Salah',
      link: 'https://app.example.invalid/x',
      fileCount: '120',
    };

    for (const id of ALL_TEMPLATES) {
      const allowed = Object.fromEntries(
        Object.entries(variables).filter(([k]) =>
          (TEMPLATES[id].allowed as string[]).includes(k),
        ),
      );

      for (const channel of CHANNELS) {
        for (const locale of LOCALES) {
          const out = render(id, channel, locale, allowed);
          const text = `${out.subject ?? ''} ${out.body}`.toLowerCase();

          for (const word of CLINICAL_VOCABULARY) {
            expect(
              mentions(text, word),
              `template "${id}" (${channel}/${locale}) mentions "${word}"`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('REJECTS a clinical variable passed at render time (the gate)', () => {
    // The real risk is not the template, it is a caller passing extra data.
    // Silently ignoring it would let the next refactor start using it.
    expect(() =>
      render('case_accepted', 'sms', 'ar', {
        caseRef: 'MIR-2026-0417',
        // @ts-expect-error — the type does not permit this, which is the point
        modality: 'CT',
      }),
    ).toThrow(DisallowedTemplateVariableError);

    expect(() =>
      render('upload_complete', 'sms', 'fr', {
        fileCount: '120',
        // @ts-expect-error — TemplateVariables has no clinical fields by design
        diagnosis: 'suspected fracture',
      }),
    ).toThrow(/never include clinical details/);
  });

  it('renders every template in both locales without leaving placeholders', () => {
    for (const id of ALL_TEMPLATES) {
      const filled = Object.fromEntries(
        (TEMPLATES[id].allowed as string[]).map((k) => [k, 'X']),
      );
      for (const channel of CHANNELS) {
        for (const locale of LOCALES) {
          const out = render(id, channel, locale, filled);
          expect(out.body, `${id}/${channel}/${locale}`).not.toContain('{{');
          expect(out.body.trim().length).toBeGreaterThan(0);
          if (channel === 'email') {
            expect(out.subject ?? '').not.toContain('{{');
          }
        }
      }
    }
  });

  it('covers both locales for every template (DECISION D4)', () => {
    for (const id of ALL_TEMPLATES) {
      for (const locale of LOCALES) {
        expect(TEMPLATES[id].sms[locale], `${id} sms/${locale}`).toBeTruthy();
        expect(TEMPLATES[id].emailSubject[locale], `${id} subject/${locale}`).toBeTruthy();
        expect(TEMPLATES[id].emailBody[locale], `${id} body/${locale}`).toBeTruthy();
      }
    }
  });

  it('covers the events the consult flow raises, plus payment failure', () => {
    // PHASE 12 named "patient claim, consent request, upload complete, booking
    // confirmed, appointment reminder, consent revoked". Three of those were
    // about an appointment the patient attends; migration 0025 removed it. The
    // moments a lab now needs told about are acceptance, refusal and the answer.
    for (const required of [
      'patient_claim',
      'consent_request',
      'upload_complete',
      'case_accepted',
      'case_declined',
      'case_answered',
      'consent_revoked',
    ] as TemplateId[]) {
      expect(ALL_TEMPLATES).toContain(required);
    }
    // P11.2 requires the patient be notified when payment fails.
    expect(ALL_TEMPLATES).toContain('payment_failed');
  });

  it('does not put the patient full name or date of birth in any message', () => {
    // firstName only. Full name + DOB together is an identifying pair, and an
    // SMS is read off a lock screen by whoever is holding the phone.
    for (const id of ALL_TEMPLATES) {
      const allowed = TEMPLATES[id].allowed as string[];
      expect(allowed).not.toContain('fullName');
      expect(allowed).not.toContain('dateOfBirth');
      expect(allowed).not.toContain('nationalId');
      expect(allowed).not.toContain('phoneE164');
    }
  });

  it('leaves an unfilled placeholder empty rather than printing its name', () => {
    const out = render('case_accepted', 'sms', 'fr', { caseRef: 'MIR-2026-0417' });
    expect(out.body).not.toContain('{{doctorName}}');
    expect(out.body).not.toContain('doctorName');
  });
});
