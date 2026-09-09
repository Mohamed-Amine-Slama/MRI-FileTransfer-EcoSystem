import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_LOCALES } from '@mir/contracts';
import { SITE_COPY } from './copy';

/**
 * The Open Graph cards — Landing-Page-Specs §10.
 *
 * `scripts/render-og.mjs` is a plain-node script with no build step, so it
 * carries its own copy of the three headlines rather than importing the
 * TypeScript deck. Duplicated copy drifts, and the failure mode here is
 * particularly bad: a headline is changed in the deck, the cards are not
 * re-rendered, and every link shared into a WhatsApp group for the next six
 * months shows the old sentence. Nobody sees it, because nobody looks at their
 * own link previews.
 *
 * This is the duplication as a test.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = readFileSync(join(WEB_ROOT, 'scripts', 'render-og.mjs'), 'utf8');
const OG_DIR = join(WEB_ROOT, 'public', 'og');

describe('the OG cards (§10)', () => {
  it('renders one card per locale', () => {
    const files = readdirSync(OG_DIR);
    for (const locale of UI_LOCALES) {
      expect(files, locale).toContain(`${locale}.png`);
    }
  });

  it('keeps every card small enough to arrive on the connection the page targets', () => {
    // A card nobody waits for is a card nobody sees. 150 KB is generous for a
    // dark, flat, two-ink image and still under a second on the 2 Mbit link
    // §8.1 measures against.
    for (const locale of UI_LOCALES) {
      const bytes = statSync(join(OG_DIR, `${locale}.png`)).size;
      expect(bytes, `${locale}.png is ${(bytes / 1024).toFixed(0)} KB`).toBeLessThan(150_000);
    }
  });

  it('sets the same headline the page does, in every locale', () => {
    for (const locale of UI_LOCALES) {
      // The card drops the full stop for typographic reasons in Latin, so the
      // comparison is on the sentence without its terminal punctuation.
      const headline = SITE_COPY[locale].heroHeadline.replace(/[.]$/, '');
      expect(SCRIPT, `${locale} headline`).toContain(headline);
    }
  });

  it('sets the same trust line the hero does, in every locale', () => {
    for (const locale of UI_LOCALES) {
      expect(SCRIPT, `${locale} trust line`).toContain(SITE_COPY[locale].heroTrustLine);
    }
  });

  it('records where the card imagery came from', () => {
    // §7.1 again: the background is a frame of the phantom, and the note that
    // says so travels with the files.
    expect(readdirSync(OG_DIR)).toContain('README.md');
  });
});
