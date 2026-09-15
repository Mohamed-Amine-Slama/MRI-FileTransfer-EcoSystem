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
