'use client';

import { useRef, type ReactNode } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';

/**
 * Depth — Landing-Page-Specs §2.2 channel 1 and §6.6.
 *
 * ---------------------------------------------------------------------------
 * TWO MOTIONS, AND THEY ARE NOT THE SAME MOTION.
 *
 * §2.2 channel 1 asks for "5 parallax z-planes, real focal falloff (blur +
 * scale + opacity as a function of distance from the focal plane)". That is
 * one continuous relationship to the scroll position, not an event.
 *
 * This component first shipped with only the second half — a one-shot entrance
 * that blurred in once and then sat still. Everything below the fold arrived
 * with a fade-and-slide, which §3.5 names as the templated default and which
 * the brief explicitly rules out: "no elements that fly in once and then sit
 * there." The page had depth for 620 ms and was flat for the rest of the
 * visit.
 *
 * So there are two tweens on two nested elements, and they must not share a
 * property or they fight over it:
 *
 *   OUTER  `data-parallax` — continuous. Translates on `y` at a rate set by the
 *          plane, scrubbed against the element's whole passage through the
 *          viewport. This is the parallax.
 *   INNER  `data-plane`    — once. Opacity, scale and blur resolving out of the
 *          focal plane on arrival. This is the focus pull.
 *
 * The reveal stays on the inner element deliberately: `e2e/corridor.spec.ts`
 * asserts that every `[data-plane]` resolves to full opacity and zero blur,
 * and moving the reveal outward would leave that test passing against an
 * element that never animates.
 * ---------------------------------------------------------------------------
 *
 * THE RESTING STATE IS THE CORRECT STATE (§3.5). Nothing here is hidden in
 * CSS. With no JavaScript, on Tier C, or while the runtime is still in flight,
 * the page is finished — it is just still. That is also why there is no
 * `opacity: 0` anywhere in corridor.css: one would turn a JS failure into a
 * blank page.
 *
 * `plane` is clamped by the tier budget: 5 planes on Tier A, 2 on Tier B, 0 on
 * Tier C. A plane beyond the budget collapses to the nearest one inside it, so
 * the choreography compresses rather than disappearing.
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
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const { budget } = useSite();

  // Tier B has two planes, so plane 4 becomes plane 1 rather than plane 4.
  const depth = budget.planes === 0 ? 0 : Math.min(plane, budget.planes - 1);

  // --- continuous: the parallax --------------------------------------------
  useGsapScope(
    budget.planes > 0 && depth > 0,
    outerRef,
    ({ gsap }, element) => {
      /*
       * Deeper planes travel further, which is what makes them read as
       * further away. The numbers are small on purpose: §3.5 allows one
       * orchestrated moment and asks everything else to answer the scroll, and
       * a plane sliding 200 px past its neighbours stops being depth and
       * becomes an effect.
       */
      const travel = depth * 22;

      gsap.fromTo(
        element,
        { y: travel },
        {
          y: -travel,
          ease: 'none',
          scrollTrigger: {
            trigger: element,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.9,
            invalidateOnRefresh: true,
          },
          ...promoting(element, 'transform'),
        },
      );
    },
    [budget.planes, depth],
  );

  // --- once: the focus pull -------------------------------------------------
  useGsapScope(
    budget.planes > 0,
    innerRef,
    ({ gsap }, element) => {
      gsap.fromTo(
        element,
        {
          autoAlpha: 0,
          y: 22,
          scale: 1 - depth * 0.015,
          // §3.4 caps blur at 8px. Past that it stops reading as depth and
          // starts reading as a rendering fault.
          filter: `blur(${Math.min(8, 2 + depth * 1.6)}px)`,
        },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.7,
          ease: 'expo.out',
          scrollTrigger: { trigger: element, start: 'top 85%', once: true },
          ...promoting(element, 'transform, filter, opacity'),
        },
      );
    },
    [budget.planes, depth],
  );

  /*
   * Always divs, never a polymorphic `as`. The semantic element belongs
   * OUTSIDE this wrapper — `<section className="scene"><FocalReveal>…` — which
   * keeps the landmark structure readable in one place instead of assembled
   * from props, and keeps both refs honestly typed.
   */
  return (
    /*
     * `className` stays on the OUTER element, where it was before this
     * component grew a second layer. Callers use it for layout — a grid child,
     * a margin — and moving it inward would have made the un-classed wrapper
     * the grid item and quietly changed several scenes' geometry.
     */
    <div
      ref={outerRef}
      className={className}
      data-parallax={depth > 0 ? depth : undefined}
    >
      <div ref={innerRef} data-plane={depth}>
        {children}
      </div>
    </div>
  );
}
