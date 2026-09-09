import localFont from 'next/font/local';

/**
 * The landing page's three added faces — Landing-Page-Specs §3.2.
 *
 * The body face (IBM Plex Sans Arabic) is declared in `app/layout.tsx` and
 * shared with the whole application; these three exist only here.
 *
 * `preload: false` on all of them, deliberately. §8.2 technique 6 says to
 * preload the two critical font files "and nothing else", and the two critical
 * ones are the body weights the root layout already handles. Display type
 * appears in exactly one place above the fold — the hero headline — and a
 * `swap` there costs a repaint of one line, while three more preload links
 * would compete with the hero poster for the first round-trip on a 2 Mbit
 * connection. The poster wins that trade every time.
 */

/*
 * Arabic display. A modern Kufic — geometric and architectural, and genuinely
 * a display Arabic rather than a bolded text face, which is what gives the
 * Arabic hero more presence than the Latin one. That is the correct priority
 * for this audience (§3.2).
 *
 * `adjustFontFallback: false`: Next's synthetic fallback derives its metrics
 * from Arial, which has no relationship to Kufic proportions and would make
 * the swap shift MORE, not less. The fallback stack in corridor.css names real
 * Arabic faces instead.
 */
export const reemKufi = localFont({
  src: '../../app/fonts/ReemKufi-Medium-arabic.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-reem',
});

/**
 * Latin display, paired with Reem Kufi at the same optical weight.
 *
 * `adjustFontFallback: false` on both this and the mono face below, for a
 * reason that only shows up in the Arabic locale. Next injects a synthetic
 * "<name> Fallback" family, derived from Arial, at the FRONT of the stack —
 * ahead of `--font-plex`. Both of these faces are Latin-only subsets, so every
 * Arabic glyph fell through to that Arial-derived family instead of to Plex
 * Sans Arabic, and the mono readouts rendered in whatever the system produced:
 * airy, loosely fitted, and visibly not the page's typeface.
 *
 * The fallback exists to reduce swap CLS. These two faces set metadata and one
 * headline, so the layout cost of losing it is a few pixels; the cost of
 * keeping it was every mono line in the primary locale.
 */
export const spaceGrotesk = localFont({
  src: '../../app/fonts/SpaceGrotesk-Medium-latin.woff2',
  weight: '300 700',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-grotesk',
});

/**
 * Data, metadata, and the DICOM-tag readouts. Same superfamily as the body
 * face, so a mono line of metadata sits beside Arabic body copy without
 * looking imported from another design.
 */
export const plexMono = localFont({
  src: '../../app/fonts/IBMPlexMono-Regular-latin.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-plex-mono',
});

/** Applied together on the corridor root, where the CSS variables resolve. */
export const CORRIDOR_FONT_CLASS = [
  reemKufi.variable,
  spaceGrotesk.variable,
  plexMono.variable,
].join(' ');
