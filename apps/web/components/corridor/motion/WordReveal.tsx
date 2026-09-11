'use client';

import { Fragment, createElement, useEffect, useRef, useState } from 'react';
import { onCurtainLifted } from '../../../lib/site/curtain';
import { REVEAL, REVEAL_TIMING, wordStagger, type RevealVariant } from '../../../lib/site/motion';
import { useSite } from '../../../lib/site/site-provider';
import { splitWords } from '../../../lib/site/split';
import { useGsapScope } from '../../../lib/site/use-gsap';

/**
 * Word-by-word blur reveal — spec 2026-09-10 §3.3. Replaces the hero-only
 * HeadlineReveal and generalises it to any heading or paragraph.
 *
 * THE RESTING STATE IS THE CORRECT STATE. The server and Tier C render one
 * text node; the split into word boxes happens after mount, and only on a
 * tier that animates. A word is always one text run, so Arabic keeps its
 * joined forms (lib/site/split.ts).
 *
 * Headings keep their accessible name through `aria-label`, as HeadlineReveal
 * did. `aria-label` is prohibited on a paragraph, so a split paragraph gets a
 * visually hidden copy of the sentence and hides the word boxes instead.
 */
export function WordReveal({
  text,
  as = 'p',
  variant = 'body',
  start = 'view',
  delay = 0,
  id,
  className = '',
}: {
  text: string;
  as?: 'h1' | 'h2' | 'h3' | 'p';
  variant?: RevealVariant;
  /** 'view': when scrolled into view. 'curtain': when the load curtain lifts (hero only). */
  start?: 'view' | 'curtain';
  /** Seconds after the start signal. */
  delay?: number;
  id?: string;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const { budget } = useSite();
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
      if (units.length === 0) return undefined;
      const { blur, y } = REVEAL[variant];
      const tween = gsap.fromTo(
        units,
        { opacity: 0, y, filter: `blur(${blur}px)` },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: REVEAL_TIMING.duration,
          ease: 'expo.out',
          stagger: wordStagger(units.length),
          delay,
          paused: start === 'curtain',
          ...(start === 'view'
            ? { scrollTrigger: { trigger: element, start: REVEAL_TIMING.start, once: true } }
            : {}),
          onStart: () => {
            for (const unit of units) unit.style.willChange = 'transform, filter, opacity';
          },
          onComplete: () => {
            // One pass, not per element: dozens of promoted layers left behind
            // is the GPU exhaustion §6.6 warns about.
            for (const unit of units) unit.style.willChange = 'auto';
          },
        },
      );
      return start === 'curtain' ? onCurtainLifted(() => tween.play()) : undefined;
    },
    [animates, split, variant, start, delay, text],
  );

  const heading = as !== 'p';
  const words = split ? splitWords(text) : null;

  const content =
    words === null ? (
      text
    ) : (
      <>
        {heading ? null : <span className="sr-only">{text}</span>}
        <span aria-hidden={heading ? undefined : true}>
          {words.map((word, index) => (
            <Fragment key={`${index}-${word}`}>
              <span data-unit className="reveal-word">
                {word}
              </span>
              {/* A real space between word boxes: it wraps, and it copies. */}
              {index < words.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </span>
      </>
    );

  return createElement(
    as,
    { ref, id, className: className === '' ? undefined : className, 'aria-label': heading ? text : undefined },
    content,
  );
}
