'use client';

import { useEffect, useRef, useState } from 'react';
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

  return (
    <h1 ref={ref} id={id} className={`display t-hero ${className}`.trim()} aria-label={text}>
      {split
        ? splitForAnimation(text, locale).map((unit, index) =>
            unit.space ? (
              // Whitespace stays a bare text node. Wrapping it in an
              // inline-block would collapse it and close the word gap.
              <span key={`s${index}`}> </span>
            ) : (
              <span key={`u${index}`} data-unit className="inline-block">
                {unit.text}
              </span>
            ),
          )
        : text}
    </h1>
  );
}
