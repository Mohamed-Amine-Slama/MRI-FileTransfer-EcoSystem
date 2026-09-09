'use client';

import { useRef, type ReactNode } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';

/**
 * The focal-depth entrance — Landing-Page-Specs §6.6.
 *
 * One helper, used everywhere, so the whole page shares a single motion
 * vocabulary. Depth is expressed the way a slice expresses it: blur, scale and
 * opacity as a function of distance from the focal plane. Elements on plane 0
 * are in focus and barely move; elements on plane 3 arrive from behind the
 * focal plane, out of focus, and resolve.
 *
 * ---------------------------------------------------------------------------
 * THE RESTING STATE IS THE CORRECT STATE.
 *
 * §3.5, and it is the rule that makes §9 possible. Nothing here is hidden in
 * CSS. The element renders complete, in place, at full opacity; the timeline
 * moves it to a start state and back only when GSAP has actually loaded. With
 * JavaScript disabled, on Tier C, or while the runtime is still in flight, the
 * page is finished — it is just still.
 *
 * This is also why there is no `opacity: 0` anywhere in corridor.css. A single
 * one would turn a JS failure into a blank page.
 * ---------------------------------------------------------------------------
 *
 * `planes` is clamped by the tier budget: 5 on Tier A, 2 on Tier B, 0 on
 * Tier C. A plane beyond the budget collapses to the nearest one that is
 * inside it, so the choreography compresses rather than disappearing.
 */
export function FocalReveal({
  plane = 0,
  className = '',
  children,
}: {
  /** Depth, 0 (at the focal plane) to 4 (furthest back). */
  plane?: number;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { budget } = useSite();

  // Tier B has two planes, so plane 4 becomes plane 1 rather than plane 4.
  const depth = budget.planes === 0 ? 0 : Math.min(plane, budget.planes - 1);

  useGsapScope(
    budget.planes > 0,
    ref,
    ({ gsap }, element) => {
      const offset = depth * 40;

      gsap.fromTo(
        element,
        {
          autoAlpha: 0,
          y: 28 + offset * 0.4,
          scale: 1 - depth * 0.02,
          // §3.4 material 3 caps blur at 8px. Past that it is expensive and
          // stops reading as depth — it reads as a rendering fault.
          filter: `blur(${Math.min(8, 3 + depth * 2)}px)`,
        },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.62,
          ease: 'expo.out',
          scrollTrigger: {
            trigger: element,
            start: 'top 82%',
            // Once. §3.5 forbids elements that fly in, sit there, and fly in
            // again on the way back up — that is the fade-and-slide-up default
            // and it reads as templated.
            once: true,
          },
          ...promoting(element, 'transform, filter, opacity'),
        },
      );
    },
    [budget.planes, depth],
  );

  /*
   * Always a div, never a polymorphic `as`. The semantic element belongs
   * OUTSIDE this wrapper — `<section className="scene"><FocalReveal>…` — which
   * keeps the landmark structure readable in one place instead of being
   * assembled from props, and keeps this component's ref honestly typed.
   */
  return (
    <div ref={ref} data-plane={depth} className={className}>
      {children}
    </div>
  );
}
