'use client';

import { useRef, type ReactNode } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';

/**
 * The windowing wipe — §Scene 02's transition in.
 *
 * "The brightness/contrast of the entire viewport ramps as in a radiology
 * window/level adjustment, from crushed blacks to normal, over 600 ms. It is
 * one CSS filter on a wrapper. Cheap, and unmistakably radiological."
 *
 * Window/level is the first thing a radiologist touches when a study opens: it
 * maps a 12-bit range onto a screen that can show eight, and moving it is how
 * you find soft tissue in what looked like a black rectangle. Borrowing it as
 * a scene transition is the difference between a design that could only exist
 * for this product and one that could exist for anyone (§2.2).
 *
 * One filter, on one wrapper, animated once. `brightness` and `contrast` are
 * both compositor-friendly on their own; what makes this affordable is that
 * the layer is promoted for the 600 ms it moves and released immediately after
 * (§6.6), so the scene underneath is not permanently rasterised.
 */
export function WindowingWipe({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { budget } = useSite();

  useGsapScope(
    budget.planes > 0,
    ref,
    ({ gsap }, element) => {
      gsap.fromTo(
        element,
        // Crushed blacks and a lifted floor: the window sitting too narrow and
        // too low, which is what a study looks like before anyone adjusts it.
        { filter: 'brightness(0.45) contrast(1.9)' },
        {
          filter: 'brightness(1) contrast(1)',
          duration: 0.6,
          ease: 'power2.inOut',
          scrollTrigger: { trigger: element, start: 'top 78%', once: true },
          ...promoting(element, 'filter'),
        },
      );
    },
    [budget.planes],
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
