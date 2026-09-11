import { HELIX } from './helix-config';

/**
 * Per-particle attributes for the helix — spec 2026-09-10 §5.2.
 *
 * Pure and seeded: no DOM, no GL, same output for the same seed. The shader
 * turns these into positions every frame, so nothing here is per-frame work.
 */

export const KIND = { strandA: 0, strandB: 1, rung: 2, dustA: 3, dustB: 4 } as const;

export interface HelixBuffers {
  count: number;
  kind: Float32Array;
  /** Position along the helix, 0..1. */
  t: Float32Array;
  /** 4 per particle: [radial jitter | rung chord 0..1, angular/axial jitter, size 0..1, tone 0..1]. */
  seed: Float32Array;
  /** 3 per particle: where the particle starts before the entrance assembles it. */
  scatter: Float32Array;
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

/** Standard normal by Box–Muller. `1 - rand()` keeps the log's argument off zero. */
export function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

export function kindCounts(count: number): { strand: number; rung: number; dust: number } {
  const strand = Math.round(count * HELIX.split.strand);
  const rung = Math.round(count * HELIX.split.rung);
  return { strand, rung, dust: Math.max(0, count - strand - rung) };
}

export function buildHelix({ count, seed = HELIX.seed }: { count: number; seed?: number }): HelixBuffers {
  const rand = mulberry32(seed);
  const kind = new Float32Array(count);
  const t = new Float32Array(count);
  const seeds = new Float32Array(count * 4);
  const scatter = new Float32Array(count * 3);

  const { strand, rung } = kindCounts(count);
  const halfStrand = Math.floor(strand / 2);
  const dustStart = strand + rung;
  const halfDust = Math.floor((count - dustStart) / 2);
  const reach = HELIX.radius * 3;

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
    } else {
      t[i] = rand();
      seeds[i * 4] = gaussian(rand);
    }
    seeds[i * 4 + 1] = gaussian(rand);
    seeds[i * 4 + 2] = rand();
    seeds[i * 4 + 3] = rand();

    // A uniform point in a ball: gaussian direction, cube-root radius.
    const x = gaussian(rand);
    const y = gaussian(rand);
    const z = gaussian(rand);
    const length = Math.hypot(x, y, z) || 1;
    const r = reach * Math.cbrt(rand());
    scatter[i * 3] = (x / length) * r;
    scatter[i * 3 + 1] = (y / length) * r;
    scatter[i * 3 + 2] = (z / length) * r;
  }

  return { count, kind, t, seed: seeds, scatter };
}
