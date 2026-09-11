import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_LOCALES } from '@mir/contracts';
import { FAQ_ROWS, SECURITY_ROWS, SITE_COPY, SITE_TEMPLATES } from './copy';

/**
 * Landing-Page-Specs §1.4 — the claims constraints, as a test.
 *
 * "Gate on copy: every claim on the page maps to a line in the build spec or a
 * signed legal answer. If it maps to neither, cut it." A gate that lives only
 * in a review checklist is a gate that gets waved through in week six, when
 * someone adds a security badge to fill a gap in a layout.
 *
 * These bans are not stylistic. "Military grade" is a liability in a breach
 * investigation, and any word implying diagnosis moves the product into
 * medical-device regulation, which the whole architecture exists to stay
 * outside of.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the landing copy deck', () => {
  it('ships every locale the UI speaks', () => {
    for (const locale of UI_LOCALES) {
      expect(SITE_COPY[locale], locale).toBeDefined();
      expect(SITE_TEMPLATES[locale], locale).toBeDefined();
    }
  });

  it('gives every locale exactly the same keys, so none can ship half-translated', () => {
    const reference = Object.keys(SITE_COPY.ar).sort();
    expect(reference.length).toBeGreaterThan(80);
    for (const locale of UI_LOCALES) {
      expect(Object.keys(SITE_COPY[locale]).sort(), locale).toEqual(reference);
    }
  });

  it('leaves no value empty', () => {
    for (const locale of UI_LOCALES) {
      for (const [key, value] of Object.entries(SITE_COPY[locale])) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('resolves every template in every locale, with the country names it was given', () => {
    for (const locale of UI_LOCALES) {
      const templates = SITE_TEMPLATES[locale];
      expect(templates.heroSubhead('SOURCE', 'DESTINATION')).toContain('SOURCE');
      expect(templates.heroSubhead('SOURCE', 'DESTINATION')).toContain('DESTINATION');
      expect(templates.corridorRoute('SOURCE', 'DESTINATION')).toContain('DESTINATION');
      expect(templates.consentRecipient('DESTINATION')).toContain('DESTINATION');
      expect(templates.clockLabel('COUNTRY')).toContain('COUNTRY');
    }
  });

  it('keeps every readout row pointed at a key that exists', () => {
    for (const row of SECURITY_ROWS) expect(SITE_COPY.ar[row.descKey]).toBeTruthy();
    for (const row of FAQ_ROWS) {
      expect(SITE_COPY.ar[row.q]).toBeTruthy();
      expect(SITE_COPY.ar[row.a]).toBeTruthy();
    }
  });

  it('asks eight questions, and no more (§Scene 10)', () => {
    // "Every scene after the eleventh dilutes the eleven that matter" applies
    // inside a scene too: an FAQ that grows to twenty is a page nobody reads.
    expect(FAQ_ROWS).toHaveLength(8);
  });

  it('states the reference-only limit in every locale (§1.4)', () => {
    for (const locale of UI_LOCALES) {
      expect(SITE_COPY[locale].viewerBanner, locale).toMatch(
        /مرجعي|référence|reference/i,
      );
      expect(SITE_COPY[locale].viewerBanner, locale).toMatch(
        /تشخيص|diagnostic/i,
      );
    }
  });

  it('names the hero eyebrow and its four capability chips in every locale (spec §4.3)', () => {
    const keys = ['heroEyebrow', 'heroChipUpload', 'heroChipConsent', 'heroChipBytes', 'heroChipBooking'];
    for (const locale of UI_LOCALES) {
      const copy = SITE_COPY[locale] as Record<string, string>;
      for (const key of keys) expect(copy[key], `${locale}.${key}`).toBeTruthy();
    }
  });

  it('drops the keys only the slice-scrub hero used', () => {
    expect(Object.keys(SITE_COPY.ar)).not.toContain('heroScrollHint');
  });
});

// ---------------------------------------------------------------------------
// The claims ban, applied to the whole landing surface rather than to the copy
// module alone — a banned phrase hardcoded into a component is the same
// liability as one in the deck, and is the more likely place for it to appear.
// ---------------------------------------------------------------------------

const SURFACE = [
  'lib/site',
  'components/corridor',
] as const;

/**
 * §1.4, verbatim, in three languages.
 *
 * `certified` is matched narrowly: the word is banned as a CLAIM about this
 * product ("ISO certified"), not as a description of someone else's equipment,
 * which is why "validated equipment" — a real and correct phrase in Scene 06 —
 * is not on the list.
 */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /military[\s-]?grade/i, why: '§1.4 bans it outright; it is a liability in a breach investigation' },
  { pattern: /bank[\s-]?grade/i, why: '§1.4: describe the architecture instead' },
  { pattern: /unhackable|impenetrable|100% secure/i, why: '§1.4: no absolute security claim' },
  { pattern: /qualité militaire|niveau militaire/i, why: '§1.4, in French' },
  { pattern: /عسكري/, why: '§1.4, in Arabic' },
  { pattern: /\bAI[\s-]powered\b|\bAI detection\b/i, why: '§1.4: no AI or detection claim' },
  { pattern: /second opinion|deuxième avis|رأي ثانٍ/i, why: '§1.4: the product does not interpret' },
  { pattern: /\bISO ?27001\b|\bHIPAA[- ]compliant\b|\bGDPR[- ]certified\b/i, why: '§1.4: no unobtained certification' },
  { pattern: /\bcertifié\b|\bcertified\b|\bمعتمد دوليًا\b/i, why: '§1.4: "built to" is honest, "certified" is not' },
  { pattern: /revolutionary|seamless|cutting[\s-]edge|world[\s-]class|state[\s-]of[\s-]the[\s-]art/i, why: '§5 tone rules' },
  { pattern: /révolutionnaire|sans couture|à la pointe/i, why: '§5 tone rules, in French' },
  { pattern: /99\.9\s?%/, why: '§5: no uptime number until it has been measured for a quarter' },
];

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(e) ? [p] : [];
  });
}

describe('§1.4 — claims that may not appear on the landing surface', () => {
  const files = SURFACE.flatMap((d) => walk(join(WEB_ROOT, d))).filter(
    (f) => !f.endsWith('copy.test.ts'),
  );

  it('finds the landing surface at all, so a path change cannot make this vacuous', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(BANNED)('never says $pattern ($why)', ({ pattern }) => {
    const offenders = files
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(WEB_ROOT, f).split('\\').join('/'));
    expect(offenders).toEqual([]);
  });

  it('never uses an exclamation mark in a copy value (§5 tone rules)', () => {
    for (const locale of UI_LOCALES) {
      for (const [key, value] of Object.entries(SITE_COPY[locale])) {
        expect(value, `${locale}.${key}`).not.toMatch(/[!！]/);
      }
    }
  });
});
