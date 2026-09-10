import localFont from 'next/font/local';

/**
 * The landing page's added faces — spec 2026-09-10 §3.2.
 *
 * Plex Sans Arabic's text weights (Regular/Medium/SemiBold/Bold) are declared
 * in `app/layout.tsx` and shared with the whole application. Its Light 300 —
 * the Arabic display weight — lives here instead, with the other two
 * landing-only faces: the application never uses weight 300, and §3.2 keeps
 * every display face off the preload list, so it does not belong in the
 * shared, preloaded declaration.
 *
 * `preload: false` on all three, deliberately: §8.2 technique 6 preloads the
 * critical body weights and nothing else, and a `swap` on the headline costs a
 * repaint of one line rather than a competing request in the first round-trip.
 *
 * `adjustFontFallback: false` on all three: they are Latin-only subsets, and
 * Next's synthetic Arial-derived fallback is inserted AHEAD of `--font-plex`
 * in the stack, so every Arabic glyph would fall through to it instead of to
 * Plex.
 */

/** Latin display and body. Variable, weight 300–500. */
export const sansFlex = localFont({
  src: '../../app/fonts/GoogleSansFlex-latin.woff2',
  weight: '300 500',
  style: 'normal',
  display: 'swap',
  preload: false,
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
