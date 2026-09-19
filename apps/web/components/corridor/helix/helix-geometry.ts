import { HELIX } from './helix-config';

/**
 * Per-particle attributes for the helix — spec 2026-09-10 §5.2.
 *
 * Pure and seeded: no DOM, no GL, same output for the same seed. The shader
 * turns these into positions every frame, so nothing here is per-frame work.
 *
 * Only what gives the helix its SHAPE is built here: which strand, where
 * along it, where across the ribbon. A particle's 3D fuzz and its entrance
 * scatter point are hashed from the vertex index in the shader instead —
 * this loop runs on the main thread, and at Tier A's count those two were
 * most of its cost.
 */

export const KIND = { strandA: 0, strandB: 1, rung: 2, dustA: 3, dustB: 4 } as const;

export interface HelixBuffers {
  count: number;
  kind: Float32Array;
  /** Position along the helix, 0..1. */
  t: Float32Array;
  /**
   * 4 per particle: [shape, radial jitter, size 0..1, tone 0..1]. `shape` is
   * where across its backbone ribbon a strand particle sits (-1..1), where
   * along the chord between the strands a rung particle sits (0..1), and a
   * radial normal for dust.
   */
  seed: Float32Array;
}

/** A small, fast, seedable PRNG. Not for anything but decoration. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normals by Box–Muller, two per draw: the sine term is kept for the
 * next call instead of thrown away, which halves the log/sqrt/trig work in
 * buildHelix. `1 - rand()` keeps the log's argument off zero.
 */
export function normals(rand: () => number): () => number {
  let spare = 0;
  let hasSpare = false;
  return () => {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }
    const r = Math.sqrt(-2 * Math.log(1 - rand()));
    const a = 2 * Math.PI * rand();
    spare = r * Math.sin(a);
    hasSpare = true;
    return r * Math.cos(a);
  };
}

export function kindCounts(count: number): { strand: number; rung: number; dust: number } {
  const strand = Math.round(count * HELIX.split.strand);
  const rung = Math.round(count * HELIX.split.rung);
  return { strand, rung, dust: Math.max(0, count - strand - rung) };
}

/**
 * Where across its ribbon a strand particle sits, -1..1. `edgeShare` of them
 * crowd the two edges (a half-normal inward from ±1), the rest fill the width
 * evenly — dense edges over a lighter fill is what reads as a flat, twisting
 * backbone rather than a tube.
 */
function ribbonOffset(rand: () => number, normal: () => number): number {
  if (rand() < HELIX.ribbon.edgeShare) {
    const inward = Math.min(1, Math.abs(normal()) * 0.09);
    return (rand() < 0.5 ? -1 : 1) * (1 - inward);
  }
  return rand() * 2 - 1;
}

export function buildHelix({ count, seed = HELIX.seed }: { count: number; seed?: number }): HelixBuffers {
  const rand = mulberry32(seed);
  const normal = normals(rand);
  const kind = new Float32Array(count);
  const t = new Float32Array(count);
  const seeds = new Float32Array(count * 4);

  const { strand, rung } = kindCounts(count);
  const halfStrand = Math.floor(strand / 2);
  const dustStart = strand + rung;
  const halfDust = Math.floor((count - dustStart) / 2);

  for (let i = 0; i < count; i++) {
    let k: number;
    if (i < strand) k = i < halfStrand ? KIND.strandA : KIND.strandB;
    else if (i < dustStart) k = KIND.rung;
    else k = i - dustStart < halfDust ? KIND.dustA : KIND.dustB;
    kind[i] = k;

    if (k === KIND.rung) {
      const pair = Math.floor(rand() * HELIX.rungs);
      t[i] = (pair + 0.5) / HELIX.rungs;
      // Where along the chord between the two strands this particle sits.
      seeds[i * 4] = rand();
    } else if (k === KIND.strandA || k === KIND.strandB) {
      t[i] = rand();
      seeds[i * 4] = ribbonOffset(rand, normal);
    } else {
      t[i] = rand();
      seeds[i * 4] = normal();
    }
    seeds[i * 4 + 1] = normal();
    seeds[i * 4 + 2] = rand();
    seeds[i * 4 + 3] = rand();
  }

  return { count, kind, t, seed: seeds };
}
