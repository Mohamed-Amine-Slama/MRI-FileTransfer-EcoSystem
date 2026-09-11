/**
 * Motion numbers the landing page's primitives share — spec 2026-09-10 §3.3.
 *
 * Pure functions and constants only, so every value a reveal or a track uses
 * is testable without a browser.
 */

export type RevealVariant = 'display' | 'body' | 'eyebrow';

/** Starting blur (px) and lift (px) per text role. Every reveal ends at 0 / 0. */
export const REVEAL: Readonly<Record<RevealVariant, { blur: number; y: number }>> = {
  display: { blur: 20, y: 60 },
  body: { blur: 12, y: 16 },
  eyebrow: { blur: 12, y: 12 },
};

export const REVEAL_TIMING = {
  /** Per-word tween, seconds. */
  duration: 0.9,
  /** Delay between consecutive words, seconds. */
  stagger: 0.04,
  /** A line never takes longer than this to START all its words, seconds. */
  maxSpread: 0.5,
  /** Block-level BlurIn tween, seconds. */
  block: 0.8,
  blockBlur: 12,
  /** 1.25rem at the root size. */
  blockY: 20,
  /** ScrollTrigger start for everything below the hero. */
  start: 'top 85%',
} as const;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Per-word stagger for a line of `count` words, capped so the spread ≤ maxSpread. */
export function wordStagger(count: number): number {
  if (count <= 1) return REVEAL_TIMING.stagger;
  return Math.min(REVEAL_TIMING.stagger, REVEAL_TIMING.maxSpread / (count - 1));
}

/** How far a horizontal track must travel to show its last card. Never negative. */
export function trackTravel(trackWidth: number, viewportWidth: number): number {
  return Math.max(0, Math.round(trackWidth - viewportWidth));
}

/**
 * The track's x at full travel: toward the reader's "forward" — leftward in
 * LTR, rightward in RTL (§3.6). Zero is returned as +0, never -0.
 */
export function trackX(travel: number, sign: 1 | -1): number {
  return travel === 0 ? 0 : -travel * sign;
}

/** How many words of a scroll-lit paragraph are lit at `progress`. */
export function litCount(progress: number, total: number): number {
  return Math.round(clamp01(progress) * total);
}
