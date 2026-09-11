import localFont from 'next/font/local';

/**
 * The landing page's added faces — spec 2026-09-10 §3.2.
 *
 * Plex Sans Arabic's text weights (Regular/Medium/SemiBold/Bold) are declared
 * in `app/layout.tsx` and shared with the whole application. Its Light 300 —
 * the Arabic display weight — lives here instead, with the other two
 * landing-only faces: the application never uses weight 300.
 *
 * `sansFlex` is the Latin BODY face (`--f-body`) as well as the Latin display
 * face, so it is preloaded: §8.2 technique 6 preloads the critical body
 * weights, and without that preload every fr/en paragraph paints in the
 * fallback at Plex's 400 weight and then swaps to Sans Flex 300 after first
 * paint — a layout shift the §10 zero-CLS budget doesn't allow. `plexMono`
 * (data readouts) and `plexArabicLight` (Arabic display) stay off the
 * preload list: neither sits on the critical body path, and a `swap` on them
 * costs a repaint of one line rather than a competing request in the first
 * round-trip.
 *
 * `adjustFontFallback: false` on all three: Next's synthetic Arial-derived
 * fallback would otherwise be inserted AHEAD of `--font-plex` in the font
 * stack, so Arabic glyphs would fall through to it instead of to Plex.
 * `sansFlex` and `plexMono` are Latin-only subsets; `plexArabicLight` is a
 * complete file carrying both scripts, not a subset.
 */

/** Latin display and body. Variable, weight 300–500. Preloaded: it's the
 *  critical Latin body face. */
export const sansFlex = localFont({
  src: '../../app/fonts/GoogleSansFlex-latin.woff2',
  weight: '300 500',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  variable: '--font-sans-flex',
});

/** Data, metadata, DICOM-style readouts. */
export const plexMono = localFont({
  src: '../../app/fonts/IBMPlexMono-Regular-latin.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-plex-mono',
});

/** Arabic display — IBM Plex Sans Arabic Light 300. A complete file (both scripts). */
export const plexArabicLight = localFont({
  src: '../../app/fonts/IBMPlexSansArabic-Light.woff2',
  weight: '300',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-plex-arabic-light',
});

export const CORRIDOR_FONT_CLASS = [
  sansFlex.variable,
  plexMono.variable,
  plexArabicLight.variable,
].join(' ');
