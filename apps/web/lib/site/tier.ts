/**
 * Capability tiering — Landing-Page-Specs §6.3.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE IS THE ARCHITECTURE. Everything else on the landing page depends
 * on it.
 *
 * The brief asks for two things that look like they are fighting: an
 * award-standard cinematic site, and a page that loads in under two seconds
 * for a doctor on 3 Mbit in a clinic, on a five-year-old Android, with thirty
 * seconds of patience. Both are satisfiable, but only if the cinema is a
 * LAYER over a page that was already complete without it.
 *
 * So:
 *   Tier C is the page. Static, correct, complete, ~34 KB of JS. It is what
 *          the HTML response contains and what renders if no script ever runs.
 *   Tier B adds the slice sequence at half resolution and two depth planes.
 *   Tier A adds the full helix, five planes, sound and haptics.
 *
 * The layout is IDENTICAL in all three. That is not a nicety — it is the
 * property that makes silent demotion possible, and §6.3 is explicit that a
 * demotion causing a visible jump is a bug, because it means the layout was
 * tier-dependent.
 * ---------------------------------------------------------------------------
 */

export type Tier = 'A' | 'B' | 'C';

export const TIERS: readonly Tier[] = ['A', 'B', 'C'];

export function isTier(value: unknown): value is Tier {
  return value === 'A' || value === 'B' || value === 'C';
}

/**
 * The signals detection reads. Named as a type rather than inlined so the
 * thresholds below can be tested against a fabricated set — the alternative
 * is testing tier selection by mocking half the `navigator` object.
 */
export interface Signals {
  reducedMotion: boolean;
  saveData: boolean;
  /** '4g' | '3g' | '2g' | 'slow-2g' — the Network Information API's vocabulary. */
  effectiveType: string;
  /** Mbit/s estimate. */
  downlink: number;
  /** GB, coarse. */
  memory: number;
  cores: number;
  coarsePointer: boolean;
  webgl2: boolean;
}

/**
 * Tier from signals, with no DOM access — the decision, separated from the
 * reading of it.
 */
export function tierFromSignals(s: Signals): Tier {
  /*
   * Tier C — never load the experience. These are non-negotiable exits, and
   * each is a person telling us something:
   *
   *   reducedMotion  a vestibular condition. §6.8: none, not "smaller".
   *   saveData       "I am paying for these bytes."
   *   2g / slow-2g   the cinema would arrive after they had gone.
   *   downlink       measured, and below the point where the sequence helps.
   *   memory ≤ 2 GB  the device would drop frames rendering it.
   */
  if (s.reducedMotion) return 'C';
  if (s.saveData) return 'C';
  if (s.effectiveType === 'slow-2g' || s.effectiveType === '2g') return 'C';
  if (s.downlink < 1.5) return 'C';
  if (s.memory <= 2) return 'C';

  // Tier A — the full cinematic path. Every clause must hold.
  if (
    s.webgl2 &&
    s.cores >= 8 &&
    s.memory >= 8 &&
    !s.coarsePointer &&
    s.effectiveType === '4g' &&
    s.downlink >= 5
  ) {
    return 'A';
  }

  return 'B';
}

/** The subset of `navigator` this needs, without reaching for `any`. */
interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
}

interface CapableNavigator extends Navigator {
  connection?: NetworkInformation;
  deviceMemory?: number;
}

export function readSignals(): Signals {
  const nav = navigator as CapableNavigator;
  const conn = nav.connection ?? {};

  return {
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: conn.saveData === true,
    effectiveType: conn.effectiveType ?? '4g',
    downlink: conn.downlink ?? 10,
    memory: nav.deviceMemory ?? 4,
    cores: nav.hardwareConcurrency ?? 4,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    /*
     * Probed rather than assumed, and the context is released immediately.
     * A WebGL context left on a throwaway canvas counts against the browser's
     * hard limit (typically 8–16), and exhausting it makes an unrelated
     * context — the one the handoff actually wants — fail to create.
     */
    webgl2: probeWebgl2(),
  };
}

function probeWebgl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * The `?tier=` override — §12 L3 requires one so each tier can be forced in
 * review and in the e2e suite.
 *
 * Read from the URL only, never persisted. A sticky override is a way to see
 * the wrong page for a week and not know it.
 */
export function tierOverride(search: string): Tier | null {
  const value = new URLSearchParams(search).get('tier')?.toUpperCase();
  return isTier(value) ? value : null;
}

export function detectTier(): Tier {
  // SSR renders the safe tier. The static HTML is Tier C's page, which is the
  // one that is correct for everybody.
  if (typeof window === 'undefined') return 'C';

  const forced = tierOverride(window.location.search);
  if (forced !== null) return forced;

  return tierFromSignals(readSignals());
}

/** One step down. Demotion is one-way within a session (§6.3). */
export function demoted(from: Tier): Tier {
  return from === 'A' ? 'B' : 'C';
}

/**
 * Detection lies, so it is checked against reality — §6.3.
 *
 * A good `effectiveType` on a congested tower is common in exactly the places
 * this page has to work, and the Network Information API reports the radio's
 * capability rather than the tower's current mood. These two thresholds are
 * the measurement that catches it.
 */
export const DEMOTION = {
  /** ms to load the first 8 sequence frames, above which the tier was wrong. */
  firstFramesMs: 1200,
  /** How many frames to time before deciding. */
  sampleFrames: 8,
  /** Sustained fps below this over the window means the device cannot keep up. */
  minFps: 45,
  /** Window over which frame rate is averaged, in ms. */
  fpsWindowMs: 2000,
} as const;

/** What each tier actually ships — §6.3's table, as data. */
export interface TierBudget {
  /** Which rendered sequence directory to load, or null for the poster alone. */
  sequence: 'a' | 'b' | null;
  /** Parallax z-planes. */
  planes: number;
  /** Sound cues and haptics may be OFFERED. Both stay off until asked for. */
  expressive: boolean;
  /** The upload demo is interactive rather than three static states. */
  interactiveDemo: boolean;
}

export const TIER_BUDGET: Record<Tier, TierBudget> = {
  A: { sequence: 'a', planes: 5, expressive: true, interactiveDemo: true },
  B: { sequence: 'b', planes: 2, expressive: true, interactiveDemo: true },
  C: { sequence: null, planes: 0, expressive: false, interactiveDemo: false },
};
