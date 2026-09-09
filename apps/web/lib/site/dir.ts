import { UI_LOCALE_DIRECTION, type UiLocale } from '@mir/contracts';

/**
 * The direction multiplier — Landing-Page-Specs §3.6.
 *
 * RTL is not a stylesheet at the end. It is a constraint on the motion system
 * from the first line, and this is the whole of it: every horizontal value on
 * the page passes through `dirOf(locale)` before it reaches a transform.
 *
 *   gsap.to(el, { x: 140 * dir })
 *
 * CSS has the same multiplier as `--dir`, set on `.corridor` in corridor.css,
 * so a value written in a stylesheet and a value written in a timeline cannot
 * disagree about which way "forward" is.
 *
 * Direction itself is never inferred from the language tag; it comes from the
 * shared table in @mir/contracts, which is the same table the API and the
 * Keycloak realm read (D4). That is what makes it impossible to ship a locale
 * with the wrong direction.
 */
export function dirOf(locale: UiLocale): 1 | -1 {
  return UI_LOCALE_DIRECTION[locale] === 'rtl' ? -1 : 1;
}

export function directionOf(locale: UiLocale): 'rtl' | 'ltr' {
  return UI_LOCALE_DIRECTION[locale];
}

/**
 * Things that mirror under RTL, and things that do not — §3.6.
 *
 * Arrows, chevrons and progress bars mirror, because they point at something
 * on a mirrored layout. Clocks, play buttons and the slice-stack indicator do
 * not: a CT stack is not directional, and scrolling down goes deeper in every
 * language. Getting this backwards is the failure that makes a bilingual site
 * feel machine-translated even when every word is right.
 */
export const MIRRORS_UNDER_RTL = {
  arrows: true,
  progress: true,
  sliceStack: false,
  clock: false,
} as const;
