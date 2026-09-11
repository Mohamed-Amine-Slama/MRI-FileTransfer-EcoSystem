'use client';

import { useRef, type ReactNode } from 'react';
import { onCurtainLifted } from '../../../lib/site/curtain';
import { REVEAL_TIMING } from '../../../lib/site/motion';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';

/**
 * Block-level blur-in — spec 2026-09-10 §3.3.
 *
 * Opacity, not `autoAlpha`: `autoAlpha` sets `visibility: hidden`, and a
 * control inside a hidden subtree cannot take focus until its reveal has run
 * (the consent test in e2e/corridor.spec.ts learned that the hard way).
 * `data-reveal` is what the e2e reveal guard polls to prove every one of
 * these resolves.
 */
export function BlurIn({
  children,
  className = '',
  delay = 0,
  start = 'view',
}: {
  children: ReactNode;
  className?: string;
  /** Seconds after the start signal. */
  delay?: number;
  start?: 'view' | 'curtain';
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { budget } = useSite();

  useGsapScope(
    budget.planes > 0,
    ref,
    ({ gsap }, element) => {
      const tween = gsap.fromTo(
        element,
        { opacity: 0, y: REVEAL_TIMING.blockY, filter: `blur(${REVEAL_TIMING.blockBlur}px)` },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: REVEAL_TIMING.block,
          ease: 'expo.out',
          delay,
          paused: start === 'curtain',
          ...(start === 'view'
            ? { scrollTrigger: { trigger: element, start: REVEAL_TIMING.start, once: true } }
            : {}),
          ...promoting(element, 'transform, filter, opacity'),
        },
      );
      return start === 'curtain' ? onCurtainLifted(() => tween.play()) : undefined;
    },
    [budget.planes, delay, start],
  );

  return (
    <div ref={ref} className={className === '' ? undefined : className} data-reveal="">
      {children}
    </div>
  );
}
