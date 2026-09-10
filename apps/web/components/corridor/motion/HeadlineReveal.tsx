'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import { splitForAnimation } from '../../../lib/site/split';
import { useGsapScope } from '../../../lib/site/use-gsap';

/**
 * The hero headline resolving out of focal blur — §Scene 01's transition in.
 *
 * "Headline resolves out of focal blur (grapheme-split, 60 ms stagger, blur
 * 12px → 0, y 24px → 0). One moment, 1400 ms, never repeated."
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT ONLY EXISTS AFTER MOUNT, AND ONLY WHEN IT WILL BE ANIMATED.
 *
 * The server renders one text node. So does the first client render, so
 * hydration matches. Only then — and only on a tier that animates — is the
 * text replaced with per-unit spans.
 *
 * Three things fall out of that, all of which matter more than the animation:
 *
 *   1. A crawler, a WhatsApp preview, and a reader with JavaScript off all get
 *      `<h1>الصورة تصل قبل المريض.</h1>`, not forty spans.
 *   2. Tier C never pays for the split at all.
 *   3. `aria-label` carries the whole sentence regardless, so a screen reader
 *      reads one sentence rather than picking its way through inline boxes.
 *
 * `splitForAnimation` decides the granularity by script, and for Arabic that
 * is by WORD — see the long note in lib/site/split.ts. Splitting an Arabic
 * word into letter-spans renders نقل as three disconnected shapes spelling
 * nothing, and no amount of correct cluster detection prevents it.
 * ---------------------------------------------------------------------------
 */
export function HeadlineReveal({
  text,
  id,
  className = '',
}: {
  text: string;
  id?: string;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLHeadingElement>(null);
  const { locale, budget } = useSite();
  const [split, setSplit] = useState(false);

  const animates = budget.planes > 0;

  useEffect(() => {
    if (animates) setSplit(true);
  }, [animates]);

  useGsapScope(
    animates && split,
    ref,
    ({ gsap }, element) => {
      const units = element.querySelectorAll<HTMLElement>('[data-unit]');
      if (units.length === 0) return;

      gsap.fromTo(
        units,
        { opacity: 0, y: 24, filter: 'blur(12px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.9,
          ease: 'expo.out',
          stagger: 0.06,
          onStart: () => {
            for (const unit of units) unit.style.willChange = 'transform, filter, opacity';
          },
          onComplete: () => {
            // Released as one pass rather than per element: forty promoted
            // layers left behind is precisely the GPU exhaustion §6.6 warns
            // about, and the headline is the largest group on the page.
            for (const unit of units) unit.style.willChange = 'auto';
          },
        },
      );
    },
    [animates, split, locale],
  );

  const words = split ? groupIntoWords(splitForAnimation(text, locale)) : null;

  return (
    <h1 ref={ref} id={id} className={`display t-hero ${className}`.trim()} aria-label={text}>
      {words === null
        ? text
        : words.map((word, wordIndex) => (
            /*
             * Each word is one unbreakable box, and the animated units live
             * INSIDE it. The space between words is a SIBLING of that box.
             *
             * Both halves were learned the hard way at 1440px. Without the
             * box, every grapheme was its own inline-block and the browser was
             * entitled to wrap between any two letters: "Their scan arrive / s
             * before they do." With the space inside the box, it sat at the
             * edge of an inline-block and was trimmed away entirely:
             * "Theirscanarrives beforetheydo."
             *
             * A real text node between the boxes is also what a reader copies
             * to their clipboard, which forty spans otherwise are not.
             */
            <Fragment key={`w${wordIndex}`}>
              <span className="headline-word">
                {word.map((unit, unitIndex) => (
                  <span key={`u${unitIndex}`} data-unit className="inline-block">
                    {unit}
                  </span>
                ))}
              </span>
              {wordIndex < words.length - 1 ? ' ' : null}
            </Fragment>
          ))}
    </h1>
  );
}

/**
 * Regroup the flat unit list into words.
 *
 * `splitForAnimation` returns graphemes for Latin and whole words for a
 * joining script, with whitespace marked. Both shapes collapse to the same
 * thing here: a list of words, each a list of animatable units. Arabic words
 * simply contain one unit each, which is exactly the constraint that made them
 * words in the first place (see lib/site/split.ts).
 */
function groupIntoWords(units: { text: string; space: boolean }[]): string[][] {
  const words: string[][] = [];
  let current: string[] = [];

  for (const unit of units) {
    if (unit.space) {
      if (current.length > 0) words.push(current);
      current = [];
      continue;
    }
    current.push(unit.text);
  }
  if (current.length > 0) words.push(current);

  return words;
}
