'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { clamp01, trackTravel, trackX } from '../../../lib/site/motion';
import { scrollToY } from '../../../lib/site/scroll';
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
  const animates = budget.planes > 0;

  useGsapScope(
    animates,
    viewportRef,
    ({ gsap }, viewport) => {
      const track = trackRef.current;
      const section = pinRef.current;
      if (track === null || section === null) return undefined;

      /*
       * `gsap.matchMedia`, not a one-off `window.matchMedia(...).matches`.
       * The check used to run once, at setup, so the track kept whichever
       * mode the page loaded in: a window narrowed from desktop to phone
       * width stayed pinned and scroll-jacked where a swipe strip belongs,
       * and one widened from phone width never pinned, leaving a mouse user
       * a sideways strip the wheel cannot move. gsap.matchMedia builds the
       * pin when the query starts matching and reverts it — spacer,
       * transform, listener — when it stops.
       */
      const media = gsap.matchMedia();
      media.add('(min-width: 900px) and (pointer: fine)', () => {
        viewport.classList.add('is-pinned');
        const travel = (): number => trackTravel(track.scrollWidth, viewport.clientWidth);

        const tween = gsap.to(track, {
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

        /*
         * Tabbing into a door only clips it correctly — the section is pinned
         * horizontally, so a card off to the side stays clipped by the
         * viewport even after the browser's own focus-follows-scroll brings
         * the SECTION into view vertically. Nothing was moving the track
         * itself, so a focused card could sit ~90% off-screen with a focus
         * ring nobody could see.
         *
         * The fix moves the page to whichever vertical scroll position makes
         * this pin's horizontal progress center the focused card, computed
         * from the same `x(progress) = -progress * travel * sign` the tween
         * above scrubs against (`trackX`), solved for the progress that
         * centers the card, then mapped back onto this ScrollTrigger's own
         * scroll range.
         *
         * Keyboard focus only. Chrome focuses a link on mousedown, so without
         * the `:focus-visible` check a press on a half-hidden door moved the
         * page hundreds of pixels before the button came back up.
         */
        const onFocusIn = (event: FocusEvent): void => {
          const focused = event.target;
          if (!(focused instanceof HTMLElement)) return;
          if (!focused.matches(':focus-visible')) return;
          const card = focused.closest<HTMLElement>('[data-testid]');
          if (card === null || !track.contains(card)) return;

          const trigger = tween.scrollTrigger;
          const total = travel();
          if (trigger === undefined || total <= 0) return;

          const currentX = Number(gsap.getProperty(track, 'x')) || 0;
          const cardRect = card.getBoundingClientRect();
          const viewportRect = viewport.getBoundingClientRect();
          // The card's position in the track's own, untransformed layout —
          // undoing whatever the tween has already scrubbed `x` to.
          const cardLeft = cardRect.left - viewportRect.left - currentX;
          const desiredX = viewportRect.width / 2 - (cardLeft + cardRect.width / 2);
          const progress = clamp01((-sign * desiredX) / total);

          scrollToY(trigger.start + progress * (trigger.end - trigger.start), { immediate: true });
        };
        viewport.addEventListener('focusin', onFocusIn);

        return () => {
          viewport.classList.remove('is-pinned');
          viewport.removeEventListener('focusin', onFocusIn);
        };
      });
      return () => media.revert();
    },
    [animates, sign],
  );

  return (
    <div ref={viewportRef} className={`track-viewport ${className}`.trim()}>
      <div ref={trackRef} className="track">
        {children}
      </div>
    </div>
  );
}
