'use client';

import { useEffect, useState } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import { liftCurtain } from '../../../lib/site/curtain';

/**
 * Scene 00 — Load. Landing-Page-Specs §Scene 00.
 *
 * "Buy the 400 ms the fonts need, and set the tone before a single word is
 * read." A teal hairline draws across the mint curtain at 40% height, then
 * becomes the top edge of the hero plate.
 *
 * ---------------------------------------------------------------------------
 * EVERY RULE HERE IS A RULE ABOUT NOT WASTING THE USER'S TIME.
 *
 *   Maximum 900 ms. "A preloader that lasts longer than the thing it is
 *   loading is theatre and judges punish it." The doctor this page is for has
 *   thirty seconds of patience and has spent none of it yet.
 *
 *   Skippable by any click, key, or scroll — immediately, not after a fade.
 *
 *   Session-scoped. A returning visitor within the session never sees it
 *   twice, which is what stops it becoming a toll booth on the second visit.
 *
 *   Tier C never sees it at all. Someone who asked for reduced motion, or is
 *   paying for their bytes, gets the hero directly.
 *
 * It also NEVER BLOCKS THE PAGE. The hero is rendered, complete, underneath
 * this overlay from the first paint. If the timer failed and this element
 * never went away, the worst case is a veil over a working page — not a blank
 * screen. That is the only acceptable shape for a preloader.
 * ---------------------------------------------------------------------------
 *
 * Budget: 0 KB. Pure CSS and one number.
 */

const DURATION_MS = 900;
const SESSION_KEY = 'mir.site.loaded';

export function S00Load(): React.JSX.Element | null {
  const { t, budget, cue } = useSite();
  const [state, setState] = useState<'hidden' | 'running' | 'done'>('hidden');
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!budget.expressive && budget.planes === 0) return;

    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      // Storage unavailable — show it once and do not try to remember.
    }
    if (seen) {
      // A repeat visit shows no curtain, so nothing should wait for one.
      liftCurtain();
      return;
    }

    try {
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // As above.
    }

    setState('running');

    const started = performance.now();
    let raf = 0;

    const finish = (): void => {
      setState('done');
      liftCurtain();
      cue('scene');
    };

    const tick = (now: number): void => {
      const elapsed = now - started;
      setPercent(Math.min(100, Math.round((elapsed / DURATION_MS) * 100)));
      if (elapsed >= DURATION_MS) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    /*
     * Any gesture ends it. §Scene 00 lists click, key and scroll, and all
     * three are here — a user who has already started reading has told us the
     * page is ready, whatever the timer thinks.
     */
    const skip = (): void => {
      cancelAnimationFrame(raf);
      finish();
    };
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('wheel', skip, { once: true, passive: true });
    window.addEventListener('touchstart', skip, { once: true, passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('wheel', skip);
      window.removeEventListener('touchstart', skip);
    };
  }, [budget.expressive, budget.planes, cue]);

  if (state === 'hidden') return null;

  return (
    <div
      className="loader"
      data-state={state}
      /*
       * Hidden from assistive technology entirely. A screen-reader user is
       * already being read the hero underneath — announcing a decorative
       * progress number over the top of it would interrupt the one sentence
       * this page exists to deliver.
       */
      aria-hidden="true"
    >
      <span className="loader-line" />
      <span className="loader-count mono subtle">
        {t.loadingLabel} {String(percent).padStart(3, '0')}
      </span>
    </div>
  );
}
