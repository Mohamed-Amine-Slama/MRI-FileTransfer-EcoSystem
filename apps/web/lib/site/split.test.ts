import { describe, expect, it } from 'vitest';
import { granularityFor, splitForAnimation, splitWords } from './split';

/**
 * §3.2 rule 5 names a test string and says to run it before shipping:
 * نقل الصور الطبية عبر الحدود. This is that instruction, automated.
 */
const ARABIC = 'نقل الصور الطبية عبر الحدود';
const LATIN = 'Their scan arrives before they do.';

describe('splitting for animation (§3.2 rule 5)', () => {
  it('splits a joining script by word, never inside a word', () => {
    expect(granularityFor(ARABIC)).toBe('word');

    const units = splitForAnimation(ARABIC, 'ar');
    const words = units.filter((u) => !u.space).map((u) => u.text);

    // Five words, each intact. If any element here is a single letter, the
    // headline will render as disconnected glyphs in the browser.
    expect(words).toEqual(['نقل', 'الصور', 'الطبية', 'عبر', 'الحدود']);
  });

  it('never emits a lone Arabic letter, which would break shaping', () => {
    for (const unit of splitForAnimation(ARABIC, 'ar')) {
      if (unit.space) continue;
      expect(unit.text.length, `"${unit.text}" is a single letter`).toBeGreaterThan(1);
    }
  });

  it('reassembles to exactly the original text', () => {
    // The units are what gets rendered. If they do not concatenate back to the
    // source, the headline on screen is not the headline in the copy deck.
    for (const [text, locale] of [
      [ARABIC, 'ar'],
      [LATIN, 'en'],
      ["L'examen arrive avant le patient.", 'fr'],
    ] as const) {
      expect(splitForAnimation(text, locale).map((u) => u.text).join('')).toBe(text);
    }
  });

  it('splits Latin by grapheme, which has no joining to lose', () => {
    expect(granularityFor(LATIN)).toBe('grapheme');
    const units = splitForAnimation('scan', 'en');
    expect(units.map((u) => u.text)).toEqual(['s', 'c', 'a', 'n']);
  });

  it('keeps a combining mark with its base letter', () => {
    // The reason rule 5 says grapheme and not character: "é" written as e +
    // U+0301 is one thing on screen and must animate as one.
    const units = splitForAnimation('été', 'fr');
    expect(units.map((u) => u.text)).toEqual(['é', 't', 'é']);
  });

  it('marks whitespace as its own unit rather than animating it', () => {
    const units = splitForAnimation('deux mots', 'fr');
    const spaces = units.filter((u) => u.space);
    expect(spaces).toHaveLength(1);
    expect(spaces[0]?.text).toBe(' ');
  });

  it('treats mixed text as joining if any of it joins', () => {
    // A French sentence with an Arabic clinic name in it must not be split
    // through the Arabic. Erring towards word granularity costs a little
    // animation detail and cannot corrupt a word.
    expect(granularityFor('Cabinet نقل, Tunis')).toBe('word');
  });

  it('returns nothing for empty text instead of an empty unit', () => {
    expect(splitForAnimation('', 'ar')).toEqual([]);
  });
});

describe('splitWords', () => {
  it('keeps Arabic words whole', () => {
    expect(splitWords('نقل الصور الطبية عبر الحدود')).toEqual(['نقل', 'الصور', 'الطبية', 'عبر', 'الحدود']);
  });

  it('splits Latin on any run of whitespace and drops the empties', () => {
    expect(splitWords('  The study   arrives\nfirst. ')).toEqual(['The', 'study', 'arrives', 'first.']);
  });
});
