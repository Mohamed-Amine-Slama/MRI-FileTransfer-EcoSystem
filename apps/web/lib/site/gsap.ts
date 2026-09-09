import type { gsap as GsapType } from 'gsap';
import type { ScrollTrigger as ScrollTriggerType } from 'gsap/ScrollTrigger';

/**
 * The single registration point for the animation runtime — §6.1, §6.4, §8.2.
 *
 * Two rules live here and nowhere else:
 *
 * 1. **GSAP is imported dynamically, after LCP.** GSAP + ScrollTrigger is
 *    ~48 KB gzipped and the first-load JS budget is 110 KB (§8.1). Putting it
 *    in the critical path would spend nearly half the budget on a runtime that
 *    animates content the user cannot see yet. `loadGsap()` is called from an
 *    idle callback once the hero has painted.
 *
 * 2. **`registerPlugin` runs exactly once.** Registering twice is harmless,
 *    but two modules each importing GSAP their own way is how a page ends up
 *    with two tickers and two ideas of the scroll position — §6.4's "most
 *    common cause of jank on sites like this".
 *
 * The promise is memoised, so concurrent callers during the same idle tick
 * share one network request and one registration.
 */

export interface GsapBundle {
  gsap: typeof GsapType;
  ScrollTrigger: typeof ScrollTriggerType;
}

let pending: Promise<GsapBundle> | null = null;

export function loadGsap(): Promise<GsapBundle> {
  pending ??= (async () => {
    const [core, trigger] = await Promise.all([
      import('gsap'),
      import('gsap/ScrollTrigger'),
    ]);
    const { gsap } = core;
    const { ScrollTrigger } = trigger;
    gsap.registerPlugin(ScrollTrigger);
    /*
     * `lagSmoothing(0)` — §6.4.
     *
     * By default GSAP detects a long frame and pretends less time passed, to
     * keep animations from jumping after a stall. That is right for a timed
     * animation and wrong for a SCRUBBED one: a scrub is driven by scroll
     * position, so smoothing the clock desynchronises the canvas from the
     * scrollbar and the slice count drifts away from where the user is.
     */
    gsap.ticker.lagSmoothing(0);
    return { gsap, ScrollTrigger };
  })();

  return pending;
}

/**
 * Whether the runtime has already been fetched.
 *
 * Used to decide if a late-arriving scene can animate its entrance or should
 * simply be in its resting state. Never used to BLOCK anything: every resting
 * state is the correct state (§3.5), so "not loaded yet" is always a complete
 * answer rather than a reason to wait.
 */
export function gsapReady(): boolean {
  return pending !== null;
}
