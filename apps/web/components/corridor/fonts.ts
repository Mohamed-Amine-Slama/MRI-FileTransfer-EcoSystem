import localFont from 'next/font/local';

/**
 * The landing page's added faces — spec 2026-09-10 §3.2.
 *
 * The Arabic faces (IBM Plex Sans Arabic, now including Light 300 for display)
 * are declared in `app/layout.tsx` and shared with the whole application; the
 * two here exist only on this page.
 *
 * `preload: false` on both, deliberately: §8.2 technique 6 preloads the
 * critical body weights and nothing else, and a `swap` on the headline costs a
 * repaint of one line rather than a competing request in the first round-trip.
 *
 * `adjustFontFallback: false` on both: they are Latin-only subsets, and Next's
 * synthetic Arial-derived fallback is inserted AHEAD of `--font-plex` in the
 * stack, so every Arabic glyph would fall through to it instead of to Plex.
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

export const CORRIDOR_FONT_CLASS = [sansFlex.variable, plexMono.variable].join(' ');
