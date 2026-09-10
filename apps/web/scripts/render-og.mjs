#!/usr/bin/env node
/**
 * The Open Graph cards — Landing-Page-Specs §10.
 *
 * "The OG image is generated at build time with next/og — one per locale, with
 * the headline set in the correct script and direction. An Arabic OG image
 * with mangled text shared into a WhatsApp group is a first impression you do
 * not recover from."
 *
 * ---------------------------------------------------------------------------
 * WHY A HEADLESS BROWSER AND NOT `next/og`
 *
 * `next/og` renders through Satori, which rasterises glyphs straight from the
 * font's character map. It does no complex text shaping — no HarfBuzz — so an
 * Arabic string comes out as isolated, unjoined letterforms: الصورة rendered as
 * ا ل ص و ر ة, six shapes spelling nothing.
 *
 * That is not a rough edge on this page. It is precisely the failure §10 warns
 * about, in the primary locale, on the surface that decides whether a doctor
 * opens the link their colleague sent. So the card is rendered by the same
 * engine that will render the page: Chromium, through Playwright, which is
 * already a devDependency for the e2e suite. Perfect shaping, correct bidi,
 * and the type is the real type.
 *
 * Output is COMMITTED. A deploy needs neither Playwright nor a browser, and
 * the card cannot silently change under a font update.
 * ---------------------------------------------------------------------------
 *
 *   node apps/web/scripts/render-og.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const WEB_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(WEB_ROOT, 'public', 'og');

/** The card size every platform crops from. */
const WIDTH = 1200;
const HEIGHT = 630;

/*
 * The copy, duplicated from lib/site/copy.ts rather than imported.
 *
 * That module is TypeScript and this is a plain-node script with no build
 * step; importing it would mean adding a bundler to an asset pipeline that is
 * otherwise three files and a browser. `og.test.ts` asserts the two agree, so
 * the duplication cannot drift silently — which is the only condition under
 * which duplicating copy is acceptable.
 */
const CARDS = {
  ar: {
    dir: 'rtl',
    headline: 'الصورة تصل قبل المريض.',
    sub: 'نقل آمن للصور الطبية عبر الحدود — بموافقة المريض، ومع موعد جاهز.',
    trust: 'نقل مشفّر · سجل غير قابل للتعديل',
  },
  fr: {
    dir: 'ltr',
    headline: "L'examen arrive avant le patient.",
    sub: "Transfert sécurisé d'imagerie médicale transfrontalier — avec consentement et rendez-vous.",
    trust: 'Transfert chiffré · Journal inaltérable',
  },
  en: {
    dir: 'ltr',
    headline: 'Their scan arrives before they do.',
    sub: 'Secure cross-border medical imaging transfer — with consent, and an appointment waiting.',
    trust: 'Encrypted transfer · Immutable audit log',
  },
};

const font = (file) =>
  readFileSync(join(WEB_ROOT, 'app', 'fonts', file)).toString('base64');

const FONTS = {
  body: font('IBMPlexSansArabic-Regular.woff2'),
  bodyMedium: font('IBMPlexSansArabic-Medium.woff2'),
  display: font('IBMPlexSansArabic-Light.woff2'),
  sansFlex: font('GoogleSansFlex-latin.woff2'),
  mono: font('IBMPlexMono-Regular-latin.woff2'),
};

const poster = readFileSync(
  join(WEB_ROOT, 'public', 'seq', 'hero', 'poster.avif'),
).toString('base64');

/**
 * The card, as the page's own design system rather than as a separate style.
 *
 * Same palette, same plate, same reticle, same phosphor discipline — a shared
 * link that looks like the page it opens is worth more than a prettier one
 * that does not.
 */
function template(locale, card) {
  const isArabic = card.dir === 'rtl';
  return `<!doctype html>
<html lang="${locale}" dir="${card.dir}">
<head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Plex'; src: url(data:font/woff2;base64,${FONTS.body}) format('woff2'); font-weight: 400; }
  @font-face { font-family: 'Plex'; src: url(data:font/woff2;base64,${FONTS.bodyMedium}) format('woff2'); font-weight: 500; }
  @font-face { font-family: 'PlexArabicLight'; src: url(data:font/woff2;base64,${FONTS.display}) format('woff2'); }
  @font-face { font-family: 'SansFlex'; src: url(data:font/woff2;base64,${FONTS.sansFlex}) format('woff2'); }
  @font-face { font-family: 'PlexMono'; src: url(data:font/woff2;base64,${FONTS.mono}) format('woff2'); }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    inline-size: ${WIDTH}px;
    block-size: ${HEIGHT}px;
    background: #06080B;
    color: #E9E5DC;
    font-family: 'Plex', sans-serif;
    overflow: hidden;
  }

  .stage { position: relative; inline-size: 100%; block-size: 100%; padding: 64px 72px; display: flex; flex-direction: column; }

  /* The volume, behind everything, at the same 35% the hero uses. */
  .volume {
    position: absolute; inset: 0;
    background-image: url(data:image/avif;base64,${poster});
    background-size: cover; background-position: center;
    /* Lower than the hero's 35%: a card is looked at for half a second in a
       chat list, and the headline has to win that half second outright. */
    opacity: 0.2;
  }

  /* The plate frame, with its corner ticks. */
  .frame { position: absolute; inset: 40px; border: 1px solid #1E272F; border-radius: 2px; }
  .frame::before, .frame::after {
    content: ''; position: absolute; inline-size: 14px; block-size: 14px;
    border-color: #3FE0C5; opacity: 0.6;
  }
  .frame::before { inset-block-start: -1px; inset-inline-start: -1px; border-block-start: 2px solid; border-inline-start: 2px solid; }
  .frame::after  { inset-block-end: -1px;  inset-inline-end: -1px;  border-block-end: 2px solid;  border-inline-end: 2px solid; }

  .row { position: relative; display: flex; align-items: center; gap: 14px; }

  .reticle {
    position: relative; inline-size: 18px; block-size: 18px;
    border: 2px solid #3FE0C5; border-radius: 999px;
  }
  .reticle::before, .reticle::after { content: ''; position: absolute; background: #3FE0C5; }
  .reticle::before { inset-block: -6px; inset-inline-start: 50%; inline-size: 2px; }
  .reticle::after  { inset-inline: -6px; inset-block-start: 50%; block-size: 2px; }

  .mark { font-family: 'PlexMono', monospace; font-size: 22px; letter-spacing: 0.22em; }

  .headline {
    position: relative;
    margin-block-start: auto;
    font-family: ${isArabic ? "'PlexArabicLight', 'Plex'" : "'SansFlex', 'Plex'"}, sans-serif;
    font-size: ${isArabic ? 82 : 76}px;
    line-height: ${isArabic ? 1.3 : 1.08};
    font-weight: 500;
    max-inline-size: 20ch;
  }

  .sub {
    position: relative;
    margin-block-start: 22px;
    font-size: 26px;
    line-height: ${isArabic ? 1.75 : 1.5};
    color: #93A0AC;
    max-inline-size: ${isArabic ? 46 : 54}ch;
  }

  /*
   * The mono face is LATIN-ONLY, so the trust line keeps the body family.
   * IBM Plex Mono has no Arabic coverage; setting it here made the Arabic card
   * fall back per-glyph and render نقل مشفّر as spaced, unjoined letters —
   * the exact failure §10 warns about, reintroduced two lines below the
   * headline that was rendered correctly.
   */
  .foot {
    position: relative;
    margin-block-start: auto;
    padding-block-start: 26px;
    font-size: 20px;
    color: #5B6874;
    display: flex; justify-content: space-between; align-items: baseline;
  }

  /* Latin digits only, so mono is safe and correct here. */
  .slice { font-family: 'PlexMono', monospace; color: #3FE0C5; letter-spacing: 0.08em; }
</style></head>
<body>
  <div class="volume"></div>
  <div class="frame"></div>
  <div class="stage">
    <div class="row"><span class="reticle"></span><span class="mark">MIR</span></div>
    <h1 class="headline">${card.headline}</h1>
    <p class="sub">${card.sub}</p>
    <div class="foot"><span>${card.trust}</span><span class="slice" dir="ltr">001 / 180</span></div>
  </div>
</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  // 1× is the right density: every platform downscales these, and a 2×
  // render is four times the bytes for a thumbnail in a chat list.
  deviceScaleFactor: 1,
});

mkdirSync(OUT, { recursive: true });

for (const [locale, card] of Object.entries(CARDS)) {
  await page.setContent(template(locale, card), { waitUntil: 'load' });
  // Fonts are data URIs, so they cannot fail to load — but they still have to
  // finish parsing before the screenshot, or the card ships in a fallback face.
  await page.evaluate(() => document.fonts.ready);

  const file = join(OUT, `${locale}.png`);
  const shot = await page.screenshot({ type: 'png' });

  /*
   * Quantised to a palette before writing. The card is a dark ground, one
   * greyscale plate and two ink colours — 128 palette entries hold all of it,
   * and it cuts the file by two thirds. WhatsApp fetches this over the same
   * connection the page has to load on.
   */
  const optimised = await sharp(shot)
    .png({ palette: true, colours: 128, compressionLevel: 9, effort: 10 })
    .toBuffer();
  writeFileSync(file, optimised);
  console.log(`og/${locale}.png: ${(optimised.length / 1024).toFixed(1)} KB`);
}

await browser.close();

/*
 * A note that travels with the images, for the same reason SOURCE.md does.
 */
writeFileSync(
  join(OUT, 'README.md'),
  `# Open Graph cards

Generated — do not edit by hand:

    node apps/web/scripts/render-og.mjs

One card per locale, rendered in Chromium so Arabic is SHAPED correctly.
Satori (which \`next/og\` uses) has no complex-text shaping and renders Arabic
as isolated letterforms; §10 of the landing page specification calls that
"a first impression you do not recover from", and it is the reason this
pipeline exists.

The background is the same synthetic phantom frame as the hero — see
\`public/seq/hero/SOURCE.md\`. No patient data of any kind.

⚠ §10 also asks for these to be checked in WhatsApp specifically, which is how
this product actually spreads. That check is a person with a phone, and it is
recorded as open in \`docs/landing-page-status.md\`.
`,
);
