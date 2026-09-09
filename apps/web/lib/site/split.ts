/**
 * Text splitting for per-unit animation — Landing-Page-Specs §3.2 rule 5.
 *
 * ---------------------------------------------------------------------------
 * WHY ARABIC IS SPLIT BY WORD AND LATIN BY GRAPHEME
 *
 * §3.2 rule 5 says to split by grapheme cluster rather than by character,
 * using `Intl.Segmenter`, "or Arabic shaping collapses". That is the right
 * instinct and it does not go far enough, so this file goes the rest of the
 * way.
 *
 * Splitting `نقل` by `String.prototype.split('')` gives three code points and
 * loses the cluster boundaries — that is the bug rule 5 names. But CORRECT
 * cluster boundaries do not fix the real problem, because the damage is not
 * done by the boundaries. It is done by the boxes. Arabic is a joining script:
 * a letter's form depends on its neighbours WITHIN A TEXT RUN, and each
 * `<span>` starts a new run. Wrap every cluster in its own element and the
 * browser renders each letter in isolated form — نقل becomes ن ق ل, three
 * disconnected shapes, spelling nothing. The text is not merely ugly; a
 * reader sees letters where a word should be.
 *
 * Rule 5 anticipates this in its own escape hatch: "If your split library
 * cannot do this, animate Arabic by word or line instead." No library can do
 * it, because it is a property of inline layout rather than of the library.
 * So a joining script is split at word boundaries — every joining run stays
 * inside one element, shaping is untouched, and the stagger reads the same at
 * 60 ms.
 *
 * Latin has no joining behaviour, so it keeps the per-grapheme treatment and
 * the finer stagger that goes with it.
 *
 * The test string from rule 5 — نقل الصور الطبية عبر الحدود — is in
 * `split.test.ts`, asserting exactly this.
 * ---------------------------------------------------------------------------
 */

/**
 * Scripts whose letters change shape according to their neighbours. Splitting
 * inside a run of any of these breaks the word.
 *
 * Arabic is the one this page ships. The others are here because the failure
 * is identical and silent, and someone adding a locale should not have to
 * rediscover it.
 */
const JOINING_SCRIPTS = /[؀-ۿ܀-ݏݐ-ݿހ-޿ࢠ-ࣿﭐ-﷿ﹰ-﻿᠀-᢯]/;

export type SplitGranularity = 'grapheme' | 'word';

export function granularityFor(text: string): SplitGranularity {
  return JOINING_SCRIPTS.test(text) ? 'word' : 'grapheme';
}

export interface SplitUnit {
  text: string;
  /** True for a run of whitespace, which must not get its own animation. */
  space: boolean;
}

/**
 * Split text into animatable units, correctly for its script.
 *
 * Falls back to whole words — never to `split('')` — when `Intl.Segmenter` is
 * unavailable. A wrong-but-legible fallback is the only acceptable kind on a
 * page whose headline is the entire message.
 */
export function splitForAnimation(text: string, locale: string): SplitUnit[] {
  const granularity = granularityFor(text);

  const segmenter = makeSegmenter(locale, granularity);
  if (segmenter === null) return splitOnSpaces(text);

  const units: SplitUnit[] = [];
  for (const { segment } of segmenter.segment(text)) {
    if (segment === '') continue;
    units.push({ text: segment, space: /^\s+$/.test(segment) });
  }
  return units;
}

function makeSegmenter(
  locale: string,
  granularity: SplitGranularity,
): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  try {
    return new Intl.Segmenter(locale, { granularity });
  } catch {
    return null;
  }
}

/**
 * The fallback, and the shape of a word split: whitespace becomes its own unit
 * so that it can be rendered without a wrapper. A space inside an animated
 * inline element collapses differently from one outside it, which is how a
 * split headline ends up with the wrong word spacing.
 */
function splitOnSpaces(text: string): SplitUnit[] {
  return text
    .split(/(\s+)/)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, space: /^\s+$/.test(part) }));
}
