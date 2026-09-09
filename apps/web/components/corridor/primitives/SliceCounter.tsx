'use client';

import { useEffect, useRef } from 'react';
import { useSite } from '../../../lib/site/site-provider';

/**
 * The slice counter — Landing-Page-Specs §Scene 01 and §Scene 11.
 *
 * "The slice counter in the bottom-inline-end corner is the real scroll
 * progress indicator for the whole page. It replaces a scrollbar. This is the
 * single most memorable detail on the site and it costs nothing."
 *
 * It runs from 001 at the top of the hero to 180 at the final plate, where the
 * volume completes. 180 because that is a plausible length for a real CT
 * stack — a doctor reads the number and it means something to them, which is
 * the entire point of using this instead of a progress bar.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS UPDATES ON EVERY TIER, INCLUDING C
 *
 * §6.8 forces Tier C to run no timelines, and this is not one. It is a
 * position readout — the same category of thing as a scrollbar, which nobody
 * disables under `prefers-reduced-motion` because knowing where you are in a
 * document is not a vestibular hazard. Removing it on Tier C would also make
 * the layout tier-dependent, which §6.3 forbids for a much better reason.
 *
 * The cost is one passive scroll listener that sets a text node inside a
 * `requestAnimationFrame`, and nothing else — no layout read per event, no
 * React state, so no re-render of the page on scroll.
 *
 * §3.6: the count does NOT reverse under RTL. Scrolling down goes deeper in
 * every language, because a CT stack is not directional.
 * ---------------------------------------------------------------------------
 */

export const SLICE_TOTAL = 180;

export function SliceCounter({ className = '' }: { className?: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const { t, cue } = useSite();

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    let frame = 0;
    let lastShown = -1;

    const paint = (): void => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
      const slice = Math.min(
        SLICE_TOTAL,
        Math.max(1, Math.round(progress * (SLICE_TOTAL - 1)) + 1),
      );
      if (slice === lastShown) return;

      /*
       * The slice tick — §2.2 channel 5. Muted unless the user asked for it,
       * and fired only when the integer actually changes, so a slow scroll
       * produces a tick per slice rather than a tick per frame.
       */
      if (lastShown !== -1) cue('slice');
      lastShown = slice;
      node.textContent = `${String(slice).padStart(3, '0')} / ${SLICE_TOTAL}`;
    };

    const onScroll = (): void => {
      // Coalesce to one write per frame. A scroll event can fire several times
      // per frame on a trackpad, and each one would otherwise touch the DOM.
      if (frame === 0) frame = requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [cue]);

  return (
    <span
      ref={ref}
      className={`mono dim slice-counter ${className}`.trim()}
      /*
       * Announced on request rather than continuously. A live region here
       * would read a new number into a screen reader on every slice, which is
       * 180 interruptions per page; `aria-label` on a static role lets someone
       * ask where they are without being told constantly.
       */
      role="status"
      aria-live="off"
      aria-label={t.heroSliceCounterLabel}
    >
      001 / {SLICE_TOTAL}
    </span>
  );
}
