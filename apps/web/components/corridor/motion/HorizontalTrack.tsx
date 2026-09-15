'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { trackTravel, trackX } from '../../../lib/site/motion';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';

/**
 * A row of cards that moves sideways while the page scrolls down —
 * spec 2026-09-10 §3.3.
 *
 * THE PAGE'S ONE PIN (§6.4: "Never pin more than one element at a time.
 * Pinning is where scroll sites die."). Only with a fine pointer from 900px,
 * on a tier that animates; everywhere else the same row is a native,
 * snapping, horizontally scrollable strip — which is what a thumb expects.
 *
 * `x` and `end` are functions so they are recomputed on refresh: the row's
 * width changes with the locale, and Arabic runs longer.
 */
export function HorizontalTrack({
  pinRef,
  className = '',
  children,
}: {
  /** The section that is held while the row travels. */
  pinRef: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const { budget, sign } = useSite();

  useGsapScope(
    budget.planes > 0,
    viewportRef,
    ({ gsap }, viewport) => {
      const track = trackRef.current;
      const section = pinRef.current;
      if (track === null || section === null) return undefined;
      if (!window.matchMedia('(min-width: 900px) and (pointer: fine)').matches) return undefined;

      viewport.classList.add('is-pinned');
      const travel = (): number => trackTravel(track.scrollWidth, viewport.clientWidth);

      gsap.to(track, {
        x: () => trackX(travel(), sign),
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: () => `+=${travel()}`,
          scrub: 1,
          pin: true,
          invalidateOnRefresh: true,
        },
        ...promoting(track, 'transform'),
      });

      return () => viewport.classList.remove('is-pinned');
    },
    [budget.planes, sign],
  );

  return (
    <div ref={viewportRef} className={`track-viewport ${className}`.trim()}>
      <div ref={trackRef} className="track">
        {children}
      </div>
    </div>
  );
}
