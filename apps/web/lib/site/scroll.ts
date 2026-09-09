import { loadGsap } from './gsap';
import type { Tier } from './tier';

/**
 * Scroll orchestration — Landing-Page-Specs §6.4.
 *
 * ONE Lenis instance, ONE GSAP ticker, ONE source of truth for scroll
 * position. Multiple scroll systems fighting each other is the most common
 * cause of jank on sites like this, and the symptom — a canvas that lags the
 * scrollbar by a few frames — reads as a slow device rather than as a bug, so
 * it survives review.
 */

export interface ScrollSystem {
  /** Recompute every trigger. Call after fonts load and after a locale change. */
  refresh: () => void;
  /** Tear the whole system down: triggers, ticker callback, and Lenis. */
  destroy: () => void;
}

/**
 * Start smooth scrolling and hand ScrollTrigger a stable value to scrub
 * against.
 *
 * Returns `null` for Tier C, which uses native scroll: no smoothing, no
 * ticker, no cost. That is not a degraded experience, it is the correct one
 * for someone who asked for reduced motion or is paying for their bytes.
 */
export async function initScroll(tier: Tier): Promise<ScrollSystem | null> {
  if (tier === 'C') return null;
  if (typeof window === 'undefined') return null;

  const [{ gsap, ScrollTrigger }, { default: Lenis }] = await Promise.all([
    loadGsap(),
    import('lenis'),
  ]);

  const lenis = new Lenis({
    duration: 1.1,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    /*
     * NEVER smooth touch scrolling. §6.4 is emphatic and it is right: a phone
     * user did not ask for their scroll to be reinterpreted, and a smoothed
     * touch scroll feels like a page that is not keeping up — which, on the
     * device this page is designed for, is the exact impression to avoid.
     * It also costs frames on the hardware that has fewest to spare.
     */
    syncTouch: false,
  });

  lenis.on('scroll', ScrollTrigger.update);

  const tick = (time: number): void => {
    // GSAP's ticker reports seconds; Lenis wants milliseconds.
    lenis.raf(time * 1000);
  };
  gsap.ticker.add(tick);

  return {
    refresh: () => ScrollTrigger.refresh(),
    destroy: () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      /*
       * Kill every trigger this page created. §6.4 warns that leaked triggers
       * across locale switches cause drift that is very hard to find later —
       * the page works, but the scrub is subtly ahead of the scrollbar and
       * nobody can say when it started.
       */
      ScrollTrigger.getAll().forEach((t) => t.kill());
    },
  };
}

/**
 * Run something once the browser is idle, or soon anyway.
 *
 * `requestIdleCallback` is still missing on Safari for iOS in the versions
 * this page has to serve, and there it must not simply never fire — that would
 * mean no animation runtime at all on a large share of the audience.
 */
export function whenIdle(fn: () => void, timeout = 2000): () => void {
  if (typeof window === 'undefined') return () => {};

  /*
   * A `typeof` check, not `'requestIdleCallback' in window`. lib.dom declares
   * the method as always present, so an `in` narrowing types the fallback
   * branch as `never` — the compiler would be certain of something the runtime
   * disagrees with on every iOS device this page has to serve.
   */
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}
