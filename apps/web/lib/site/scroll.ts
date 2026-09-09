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

  /*
   * ---------------------------------------------------------------------------
   * THE SECOND LISTENER IS NOT REDUNDANT, AND LEAVING IT OUT IS A BLANK SCENE.
   *
   * ScrollTrigger is driven entirely by Lenis's `scroll` event above, so it
   * only learns about scrolling that Lenis performed. Anything that moves the
   * page WITHOUT going through Lenis — an in-page anchor, a browser restoring
   * a scroll position on reload, find-on-page, End, a screen reader moving
   * focus — leaves ScrollTrigger believing the page never moved. Every trigger
   * below the new position then stays unfired, and since `FocalReveal`
   * animates from `autoAlpha: 0`, the scenes it should have revealed are
   * simply not there.
   *
   * This page has four nav anchors and a hero CTA that all do exactly that.
   * `ScrollTrigger.update()` is cheap and idempotent, so the honest fix is to
   * let the native event drive it too.
   * ---------------------------------------------------------------------------
   */
  const onNativeScroll = (): void => ScrollTrigger.update();
  window.addEventListener('scroll', onNativeScroll, { passive: true });

  /*
   * ---------------------------------------------------------------------------
   * AN ANCHOR HAS TO BE RE-AIMED AFTER THE PAGE FINISHES BECOMING ITSELF.
   *
   * Scene 02 is pinned (§Scene 02's horizontal scrub, and the only pin on the
   * page). Pinning inserts a spacer roughly a viewport tall, so the moment
   * ScrollTrigger creates it, every scene below moves DOWN by that much.
   *
   * Anything that aimed at a scene before then is now aimed too high. Clicking
   * "الأمان" in the first seconds of a slow load scrolled to Scene 08's
   * position as the page was laid out *at that instant*, and then the pin
   * appeared and left the reader looking at Scene 06 — two scenes early, with
   * no indication anything had gone wrong. A deep link (`/ar#security`) breaks
   * identically, and worse, because the browser's own jump happens before any
   * of this code runs.
   *
   * So the target is remembered and re-aimed on every ScrollTrigger refresh,
   * which is the event that fires whenever the page's geometry is recomputed —
   * pin creation, fonts settling (§6.4), a resize. The memory is short-lived:
   * a refresh minutes later, when the reader has scrolled somewhere else
   * entirely, must not yank them back to a hash they have forgotten about.
   * ---------------------------------------------------------------------------
   */
  let pendingHash: string | null = null;
  let pendingUntil = 0;

  /** Aim at a hash, and keep aiming while the layout is still settling. */
  const aim = (id: string, immediate: boolean): void => {
    const target = document.getElementById(id);
    if (target === null) return;
    pendingHash = id;
    // Long enough to cover font loading and pin creation on a slow connection;
    // short enough that it can never surprise someone who has moved on.
    pendingUntil = performance.now() + 4000;
    lenis.scrollTo(target, { immediate, force: true });
  };

  const realign = (): void => {
    if (pendingHash === null) return;
    if (performance.now() > pendingUntil) {
      pendingHash = null;
      return;
    }
    const target = document.getElementById(pendingHash);
    if (target === null) return;
    // Immediate: this is a correction, not a journey. Animating it a second
    // time would read as the page drifting on its own.
    lenis.scrollTo(target, { immediate: true, force: true });
  };

  ScrollTrigger.addEventListener('refresh', realign);

  // A deep link that the browser already jumped to, before any of this existed.
  if (window.location.hash.length > 1) {
    aim(window.location.hash.slice(1), true);
  }

  /*
   * In-page anchors go through Lenis rather than around it.
   *
   * A native jump moves the document but not Lenis's own idea of where it is,
   * so on its very next frame Lenis animates back to the position it still
   * believes is current — the page visibly snaps back, which reads as the link
   * being broken. Delegated from the document so it covers the chrome nav, the
   * hero's "see how it works", and anything added later.
   */
  const onAnchorClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = (event.target as Element | null)?.closest?.('a[href^="#"]');
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const id = anchor.getAttribute('href')?.slice(1);
    if (id === undefined || id === '') return;

    const target = document.getElementById(id);
    if (target === null) return;

    event.preventDefault();

    // Remembered, so a pin or a font that lands mid-journey re-aims it.
    pendingHash = id;
    pendingUntil = performance.now() + 4000;

    lenis.scrollTo(target, {
      /*
       * The skip link must not be a scenic route. Everything else gets the
       * page's own easing; `#main` is an accessibility affordance and the
       * person using it has already waited long enough.
       */
      immediate: id === 'main',
      onComplete: () => {
        /*
         * Focus follows the jump, or a keyboard user is scrolled somewhere
         * their focus ring is not and the next Tab takes them back to the top
         * of the page.
         *
         * A `<section>` is not focusable, so it is made focusable for the
         * duration and then released — leaving `tabindex="-1"` on eleven
         * sections permanently would put them in nobody's way, but it would
         * also be eleven attributes nobody can explain later.
         */
        const hadTabIndex = target.hasAttribute('tabindex');
        if (!hadTabIndex) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        if (!hadTabIndex) {
          target.addEventListener('blur', () => target.removeAttribute('tabindex'), {
            once: true,
          });
        }
      },
    });
    // Keep the URL honest without triggering a second, native jump.
    history.pushState(null, '', `#${id}`);
  };
  document.addEventListener('click', onAnchorClick);

  const tick = (time: number): void => {
    // GSAP's ticker reports seconds; Lenis wants milliseconds.
    lenis.raf(time * 1000);
  };
  gsap.ticker.add(tick);

  return {
    refresh: () => ScrollTrigger.refresh(),
    destroy: () => {
      window.removeEventListener('scroll', onNativeScroll);
      document.removeEventListener('click', onAnchorClick);
      ScrollTrigger.removeEventListener('refresh', realign);
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
