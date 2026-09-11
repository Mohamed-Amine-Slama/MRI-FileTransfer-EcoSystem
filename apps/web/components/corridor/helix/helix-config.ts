/**
 * Every tunable number of the particle helix — spec 2026-09-10 §5.
 *
 * One place, so visual tuning never touches the renderer. World units are
 * arbitrary; the camera and field of view below frame a helix of `length`
 * so it overruns the top and bottom of its box slightly, which is the look.
 */
export const HELIX = {
  /** PRNG seed — the live render, the posters and the tests all agree. */
  seed: 20260910,
  /** Share of particles per kind. Must sum to 1. */
  split: { strand: 0.45, rung: 0.15, dust: 0.4 },
  /** Base pairs along the visible length. */
  rungs: 26,
  turns: 2.2,
  radius: 1.75,
  length: 10,
  /** Corner-to-corner lean. Negated in RTL — which keeps the helix right-handed. */
  rollDeg: -28,
  yawSwingDeg: 6,
  /** Spin at rest, radians per second. */
  spin: 0.12,
  /** Spin and dust-spread multipliers once the host has fully scrolled out. */
  scrollSpinBoost: 3,
  scrollDustBoost: 1.6,
  assembleSeconds: 1.6,
  pointer: {
    /** Repulsion radius, as a share of the canvas's shorter side. */
    radiusFrac: 0.16,
    /** Largest push, CSS px. */
    maxPx: 38,
    /** Time to relax fully once the pointer leaves or rests. */
    releaseMs: 600,
    /** A pointer that has not moved for this long counts as resting. */
    idleMs: 1200,
  },
  /** Point size ranges, CSS px, before perspective and depth. */
  size: { strand: [1.2, 3.2], rung: [0.8, 1.6], dust: [0.6, 1.8] },
  alpha: { strand: [0.55, 0.9], rung: [0.25, 0.5], dust: [0.08, 0.35] },
  /** Gaussian spread around the strand, world units. */
  jitter: { strand: 0.12, rung: 0.05, dust: 0.55 },
  /** Deep teal → teal → leaf → chartreuse → lime. Far particles sit toward the start. */
  palette: ['#054038', '#246f65', '#4f8a3c', '#9fbf4a', '#e5ed9b'],
  cameraZ: 12,
  fovDeg: 38,
} as const;

/**
 * The still frame Tier C shows, and every tier paints first. Two files rather
 * than one mirrored image: a helix flipped with `scaleX(-1)` turns left-handed.
 * Rendered by `scripts/render-helix-poster.mjs`.
 */
export const HELIX_POSTER = {
  ltr: '/helix/poster-ltr.avif',
  rtl: '/helix/poster-rtl.avif',
  width: 1140,
  height: 900,
} as const;
