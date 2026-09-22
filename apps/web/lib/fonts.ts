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
 *
 * PRELOADED ON EVERY ROUTE, INCLUDING THE VIEWER — AND THAT WAS MEASURED.
 * The viewer renders no display text, so on that screen this preload looked
 * like pure cost against P9.1's hard five-second gate (see app/layout.tsx).
 * It is not: e2e/viewer.spec.ts's gate test, 2 Mbit / 200 ms, three runs each
 * (2026-09-22), gave 3544 / 3554 / 3557 ms with the preload and 3595 / 3661 /
 * 3661 ms without — no measurable cost, well inside the budget. Without it,
 * every other screen's headings would paint in Plex and swap a beat late.
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
