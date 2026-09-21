import localFont from 'next/font/local';

/**
 * Faces the whole application loads.
 *
 * `sansFlex` lived in `components/corridor/fonts.ts` while it was the landing
 * page's face alone. The application now uses it for display headings, so it
 * moves here and the corridor module re-exports it — one declaration, one
 * network request, whichever surface asks first.
 *
 * Its siblings stay landing-only. `plexArabicLight` in particular is the
 * Arabic DISPLAY weight (300), and the application has no weight-300 Arabic:
 * Arabic headings fall through to `--font-plex` at their normal weights.
 * `lib/site/fonts.test.ts` asserts that, so this file must not import it.
 *
 * WEIGHT RANGE IS LOAD-BEARING: this face carries 300-500 only. An element
 * pairing `font-display` with `font-semibold` (600) or `font-bold` (700) gets
 * a SYNTHESIZED bold, which is why `lib/theme/display-font.test.ts` exists.
 */
export const sansFlex = localFont({
  src: '../app/fonts/GoogleSansFlex-latin.woff2',
  weight: '300 500',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  variable: '--font-sans-flex',
});
