'use client';

import { useEffect, type RefObject } from 'react';
import { loadGsap, type GsapBundle } from './gsap';

/**
 * Run a GSAP setup function inside a scoped context — Landing-Page-Specs §6.4.
 *
 * "Every ScrollTrigger is created inside a `gsap.context()` scoped to its scene
 * component, and reverted on unmount. Leaked triggers across locale switches
 * will cause hard-to-find drift."
 *
 * `context.revert()` does more than kill the timelines: it restores every
 * inline style GSAP wrote. That is what makes the resting state survive an
 * unmount, and it is why the same component can be mounted under a new locale
 * without inheriting the previous direction's transforms.
 *
 * `enabled` is how tiering reaches the timelines. It is checked BEFORE the
 * runtime is even requested, so Tier C never downloads GSAP at all — §6.8's
 * "belt and braces": the CSS rule alone does not stop a timeline, and this is
 * the other half.
 */
export function useGsapScope(
  enabled: boolean,
  ref: RefObject<HTMLElement | null>,
  setup: (bundle: GsapBundle, element: HTMLElement) => void,
  deps: readonly unknown[],
): void {
  useEffect(() => {
    if (!enabled) return;

    const element = ref.current;
    if (element === null) return;

    let cancelled = false;
    let context: ReturnType<GsapBundle['gsap']['context']> | null = null;

    void loadGsap().then((bundle) => {
      // The component may have unmounted while the runtime was in flight. On a
      // slow connection that is the common case, not the edge one.
      if (cancelled) return;
      context = bundle.gsap.context(() => setup(bundle, element), element);
    });

    return () => {
      cancelled = true;
      context?.revert();
    };
    /*
     * `deps` is passed straight through from the caller. The exhaustive-deps
     * lint rule cannot see through that indirection — and this repository does
     * not load the plugin — so the discipline is the contract instead: every
     * caller lists what its setup closes over, and the tier flag is always
     * among them so a demotion tears the timeline down.
     */
  }, deps);
}

/**
 * §3.4 material 3, and §6.6's closing note — the difference between a smooth
 * page and one that crashes Chrome on a mid-range Android.
 *
 * `will-change` promotes an element to its own compositor layer. That is what
 * makes a blur cheap while it animates, and what makes forty of them a GPU
 * memory exhaustion. So it is set when a transition starts and removed the
 * instant it finishes, never declared in the stylesheet.
 */
export function promoting(element: ElementCSSInlineStyle, properties: string) {
  return {
    onStart: () => {
      element.style.willChange = properties;
    },
    onComplete: () => {
      element.style.willChange = 'auto';
    },
    // A scrubbed timeline can reverse past its start; release the layer there too.
    onReverseComplete: () => {
      element.style.willChange = 'auto';
    },
  };
}
