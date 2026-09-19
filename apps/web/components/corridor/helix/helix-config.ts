/**
 * Every tunable number of the particle helix — spec 2026-09-10 §5.
 *
 * One place, so visual tuning never touches the renderer. World units are
 * arbitrary; the camera and field of view below frame a helix of `length`
 * so it overruns the top and bottom of its box, which is the look.
 *
 * The look is a smoky, dense double helix seen at an angle: the lower end
 * leans toward the camera (`pitchDeg`), so each turn reads as a ring rather
 * than a flat S-curve, the near coils are larger and out of focus (`dof`), and
 * the base pairs show as fine rungs between two ribbon-like backbones.
 */
export const HELIX = {
  /** PRNG seed — the live render, the posters and the tests all agree. */
  seed: 20260910,
  /** Share of particles per kind. Must sum to 1. */
  split: { strand: 0.5, rung: 0.16, dust: 0.34 },
  /** Base pairs along the visible length — ~10.5 per turn, as in B-DNA. */
  rungs: 20,
  turns: 1.9,
  radius: 2.15,
  length: 13,
  /**
   * How far strand B trails strand A around the axis, in radians. Less than
   * half a turn, so the two grooves differ in width (major and minor) the way
   * real DNA's do, instead of two identical interleaved springs.
   */
  groove: 2.9,
  /**
   * Each backbone is a ribbon lying on the helix's cylinder: `halfWidth`
   * across it, `thickness` through it. `edgeShare` of the strand particles sit
   * on the ribbon's two edges, which draws the darker outline the strands have.
   */
  ribbon: { halfWidth: 0.32, thickness: 0.1, edgeShare: 0.5 },
  /** The lower end tilts toward the camera by this much — the rings, and the depth. */
  pitchDeg: 14,
  /** Corner-to-corner lean. Negated in RTL — which keeps the helix right-handed. */
  rollDeg: -24,
  yawSwingDeg: 5,
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
  /** Point size ranges, CSS px, before perspective, depth of field and density. */
  size: { strand: [0.9, 2.2], rung: [0.8, 1.5], dust: [0.5, 1.5] },
  alpha: { strand: [0.42, 0.9], rung: [0.26, 0.55], dust: [0.1, 0.34] },
  /** Gaussian spread, world units: strand fuzz, rung fuzz, dust halo. */
  jitter: { strand: 0.06, rung: 0.04, dust: 0.34 },
  /**
   * Depth of field. The focal plane sits `focus` world units behind the
   * helix's centre; a particle's blur grows by `pxPerUnit` CSS px per unit
   * away from it, up to `maxPx`. Blurred particles grow and dim together, so
   * the near coil turns soft rather than bright.
   */
  dof: { focus: 0.8, pxPerUnit: 2.4, maxPx: 7 },
  /** Direction the light comes from, in view space (x right, y up, z away from the camera). */
  light: [-0.45, 0.7, -0.55],
  /** Forest → green → leaf → yellow-green → lime. Shadowed particles sit toward the start. */
  palette: ['#12361f', '#29672c', '#5b9934', '#a8cb45', '#e0ec8a'],
  cameraZ: 9.5,
  fovDeg: 46,
  /**
   * The density the look was tuned at — Tier A's count over the hero's canvas
   * at 1440×900, in particles per CSS px². A sparser canvas (Tier B, or a
   * larger screen) draws each particle a little larger and stronger, a denser
   * one (a phone's band) a little smaller and fainter, so the helix reads
   * the same weight everywhere.
   */
  referenceDensity: 140_000 / (1140 * 900),
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
