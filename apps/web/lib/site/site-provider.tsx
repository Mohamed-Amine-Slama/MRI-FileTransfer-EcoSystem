'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { UiLocale } from '@mir/contracts';
import { SITE_COPY, SITE_TEMPLATES, type SiteCopy } from './copy';
import { dirOf, directionOf } from './dir';
import { initScroll, whenIdle, type ScrollSystem } from './scroll';
import { setSoundEnabled, soundEnabled, closeSound, playCue, type Cue } from './sound';
import { DEMOTION, TIER_BUDGET, demoted, detectTier, type Tier, type TierBudget } from './tier';

/**
 * The landing page's one context — Landing-Page-Specs §6.3, §6.4, §6.8.
 *
 * Everything the scenes need to know about the environment lives here: which
 * tier is in force, which way the page runs, what the copy says, and whether
 * the user has asked for quiet. One provider rather than four, because every
 * scene needs all of it and four contexts is four subscriptions per scene.
 *
 * ---------------------------------------------------------------------------
 * THE TIER STARTS AT C AND CAN ONLY GO DOWN.
 *
 * The server renders Tier C, because the static HTML has to be correct for
 * everybody and Tier C's page is the one that is. Detection runs after mount
 * and may promote once; after that the only permitted movement is downward,
 * one step at a time, and it must be invisible (§6.3). If a demotion causes a
 * visible jump, the layout was tier-dependent, which is a bug in the scene,
 * not in this file.
 * ---------------------------------------------------------------------------
 */

const REDUCED_MOTION_KEY = 'mir.site.reduced-motion';

interface SiteContextValue {
  locale: UiLocale;
  dir: 'rtl' | 'ltr';
  /** +1 for LTR, -1 for RTL. Every horizontal value passes through this (§3.6). */
  sign: 1 | -1;
  t: SiteCopy;
  tpl: (typeof SITE_TEMPLATES)[UiLocale];

  tier: Tier;
  budget: TierBudget;
  /** Step the tier down one level. One-way, and silent. */
  demote: (why: string) => void;

  /** The manual "reduce motion on this site" switch (§6.8). */
  reducedMotion: boolean;
  setReducedMotion: (on: boolean) => void;

  sound: boolean;
  setSound: (on: boolean) => void;
  /** Play a cue, subject to the tier budget and the user's toggle. */
  cue: (cue: Cue) => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function useSite(): SiteContextValue {
  const ctx = useContext(SiteContext);
  if (ctx === null) throw new Error('useSite must be used inside SiteProvider');
  return ctx;
}

export function SiteProvider({
  locale,
  children,
}: {
  locale: UiLocale;
  children: ReactNode;
}): React.JSX.Element {
  const [tier, setTier] = useState<Tier>('C');
  const [reducedMotion, setReducedMotionState] = useState(false);
  const [sound, setSoundState] = useState(false);

  // A ref as well as state: the demotion callbacks fire from a ticker and an
  // image handler, where a stale closure over `tier` would let two demotions
  // race and skip a level.
  const tierRef = useRef<Tier>('C');

  const demote = useCallback((why: string): void => {
    const next = demoted(tierRef.current);
    if (next === tierRef.current) return;
    tierRef.current = next;
    setTier(next);
    // Warn rather than log: this is a signal that detection disagreed with
    // reality, and it is the thing to look at when a device feels slow.
    console.warn(`[corridor] tier demoted to ${next}: ${why}`);
  }, []);

  /*
   * Detection, after mount.
   *
   * The stored manual preference is read FIRST and wins outright: §6.8 says to
   * honour it above detection, because someone who found the switch has told
   * us something more specific than a media query can.
   */
  useEffect(() => {
    let stored = false;
    try {
      stored = window.localStorage.getItem(REDUCED_MOTION_KEY) === 'on';
    } catch {
      // No stored preference available. Fall through to detection.
    }
    setReducedMotionState(stored);
    setSoundState(soundEnabled());

    const detected = stored ? 'C' : detectTier();
    tierRef.current = detected;
    setTier(detected);
  }, []);

  /*
   * Runtime demotion by frame rate — §6.3.
   *
   * Detection lies: a good `effectiveType` on a congested tower is common in
   * exactly the places this page has to work. Sustained frame rate is the
   * measurement that catches it, and it is sampled over a two-second window
   * rather than per-frame so that one long GC pause does not demote a device
   * that is otherwise fine.
   */
  useEffect(() => {
    if (tier === 'C') return;

    let frames = 0;
    let start = performance.now();
    let raf = 0;
    let cancelled = false;

    const tick = (now: number): void => {
      if (cancelled) return;
      frames += 1;
      const elapsed = now - start;
      if (elapsed >= DEMOTION.fpsWindowMs) {
        const fps = (frames * 1000) / elapsed;
        if (fps < DEMOTION.minFps) {
          demote(`sustained ${fps.toFixed(0)} fps over ${DEMOTION.fpsWindowMs} ms`);
          return;
        }
        frames = 0;
        start = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [tier, demote]);

  /*
   * The scroll system. Started from an idle callback so the animation runtime
   * is fetched AFTER the hero has painted (§8.2 technique 4), and torn down
   * completely on demotion to C — including every ScrollTrigger, because a
   * leaked trigger keeps scrubbing a canvas that is no longer there.
   */
  useEffect(() => {
    if (tier === 'C') return;

    let system: ScrollSystem | null = null;
    let disposed = false;

    const cancelIdle = whenIdle(() => {
      void initScroll(tier).then((created) => {
        if (disposed) {
          created?.destroy();
          return;
        }
        system = created;
        /*
         * Arabic and Latin have different content heights, so every trigger's
         * start and end are wrong until the real font has painted. §6.4 asks
         * for a refresh after fonts load; this is it.
         */
        void document.fonts?.ready.then(() => {
          if (!disposed) system?.refresh();
        });
      });
    });

    return () => {
      disposed = true;
      cancelIdle();
      system?.destroy();
    };
  }, [tier]);

  useEffect(() => closeSound, []);

  const setReducedMotion = useCallback((on: boolean): void => {
    setReducedMotionState(on);
    try {
      window.localStorage.setItem(REDUCED_MOTION_KEY, on ? 'on' : 'off');
    } catch {
      // Not persisted; still applied for this session.
    }
    /*
     * Turning it ON forces Tier C immediately. Turning it OFF does NOT restore
     * the previous tier: demotion is one-way within a session (§6.3), and a
     * page that rebuilt its whole animation system mid-visit would be exactly
     * the visible change §6.3 forbids. A reload gives the full experience back.
     */
    if (on) {
      tierRef.current = 'C';
      setTier('C');
    }
  }, []);

  const setSound = useCallback((on: boolean): void => {
    setSoundEnabled(on);
    setSoundState(on);
  }, []);

  const budget = TIER_BUDGET[tier];

  const cue = useCallback(
    (name: Cue): void => {
      if (!TIER_BUDGET[tierRef.current].expressive) return;
      playCue(name);
    },
    [],
  );

  const value = useMemo<SiteContextValue>(
    () => ({
      locale,
      dir: directionOf(locale),
      sign: dirOf(locale),
      t: SITE_COPY[locale],
      tpl: SITE_TEMPLATES[locale],
      tier,
      budget,
      demote,
      reducedMotion,
      setReducedMotion,
      sound,
      setSound,
      cue,
    }),
    [locale, tier, budget, demote, reducedMotion, setReducedMotion, sound, setSound, cue],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
