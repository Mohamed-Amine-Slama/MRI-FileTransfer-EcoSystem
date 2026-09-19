'use client';

import { Fragment, createElement, useEffect, useRef, useState } from 'react';
import { litCount } from '../../../lib/site/motion';
import { useSite } from '../../../lib/site/site-provider';
import { splitWords } from '../../../lib/site/split';
import { useGsapScope } from '../../../lib/site/use-gsap';

/**
 * Words that darken as the reader scrolls through them — spec 2026-09-10 §3.3.
 *
 * The resting state (server, Tier C, reduced motion) is plain ink text: the
 * split into muted words happens only on a tier whose ScrollTrigger will also
 * light them. Unlit words are `--c-ink-muted` (3.3:1), so this is for large
 * text only — a heading or a ≥ 24px statement.
 */
export function ScrollLitText({
  text,
  as = 'p',
  id,
  className = '',
}: {
  text: string;
  as?: 'h2' | 'p';
  id?: string;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const { budget } = useSite();
  const [split, setSplit] = useState(false);
  const animates = budget.planes > 0;

  /*
   * Tracks `animates` both ways. A demotion to Tier C — or the footer's
   * reduce-motion switch, which forces Tier C (site-provider.tsx) — kills
   * the ScrollTrigger below, but that only stops `data-lit` from being
   * written; it does not touch whatever value was written last. A one-way
   * latch here left every word frozen at `data-lit="off"` (muted) after the
   * drop, because the split words never went back to being the plain,
   * unsplit (and therefore un-mutable) text §8's Tier C row promises.
   */
  useEffect(() => {
    setSplit(animates);
  }, [animates]);

  useGsapScope(
    animates && split,
    ref,
    ({ ScrollTrigger }, element) => {
      const words = [...element.querySelectorAll<HTMLElement>('[data-lit]')];
      let lit = -1;
      const paint = (progress: number): void => {
        const n = litCount(progress, words.length);
        if (n === lit) return;
        lit = n;
        words.forEach((word, index) => {
          word.dataset['lit'] = index < n ? 'on' : 'off';
        });
      };
      const trigger = ScrollTrigger.create({
        trigger: element,
        start: 'top 75%',
        end: 'bottom 45%',
        onUpdate: (self) => paint(self.progress),
        onRefresh: (self) => paint(self.progress),
      });
      paint(trigger.progress);
      return undefined;
    },
    [animates, split, text],
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
              <span data-lit="off">{word}</span>
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
