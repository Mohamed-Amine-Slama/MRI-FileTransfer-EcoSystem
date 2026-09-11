import { describe, expect, it } from 'vitest';
import { HELIX } from './helix-config';
import { KIND, buildHelix, kindCounts, mulberry32 } from './helix-geometry';

describe('mulberry32', () => {
  it('stays in [0, 1) and repeats for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const value = a();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(b()).toBe(value);
    }
  });
});

describe('the particle split (spec §5.2)', () => {
  it('sums the configured shares to one', () => {
    expect(HELIX.split.strand + HELIX.split.rung + HELIX.split.dust).toBeCloseTo(1);
  });

  it('gives Tier A 45% strand, 15% rung, 40% dust, and loses nobody', () => {
    expect(kindCounts(36_000)).toEqual({ strand: 16_200, rung: 5_400, dust: 14_400 });
    const odd = kindCounts(14_001);
    expect(odd.strand + odd.rung + odd.dust).toBe(14_001);
  });
});

describe('buildHelix', () => {
  it('is deterministic for a seed, so posters, tests and the live page agree', () => {
    const a = buildHelix({ count: 2_000, seed: 7 });
    const b = buildHelix({ count: 2_000, seed: 7 });
    expect(a.kind).toEqual(b.kind);
    expect(a.t).toEqual(b.t);
    expect(a.seed).toEqual(b.seed);
    expect(a.scatter).toEqual(b.scatter);
  });

  it('changes with the seed', () => {
    expect(buildHelix({ count: 500, seed: 1 }).t).not.toEqual(buildHelix({ count: 500, seed: 2 }).t);
  });

  it('sizes every buffer to the particle count', () => {
    const h = buildHelix({ count: 1_234 });
    expect(h.count).toBe(1_234);
    expect(h.kind).toHaveLength(1_234);
    expect(h.t).toHaveLength(1_234);
    expect(h.seed).toHaveLength(1_234 * 4);
    expect(h.scatter).toHaveLength(1_234 * 3);
  });

  it('labels particles with their kind in the configured proportion', () => {
    const h = buildHelix({ count: 1_000 });
    const counts = [0, 0, 0, 0, 0];
    for (const kind of h.kind) counts[kind] = (counts[kind] ?? 0) + 1;
    expect((counts[KIND.strandA] ?? 0) + (counts[KIND.strandB] ?? 0)).toBe(450);
    expect(counts[KIND.rung]).toBe(150);
    expect((counts[KIND.dustA] ?? 0) + (counts[KIND.dustB] ?? 0)).toBe(400);
  });

  it('keeps every particle inside the helix length', () => {
    for (const t of buildHelix({ count: 5_000 }).t) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('puts every rung particle on a base pair, between the two strands', () => {
    const h = buildHelix({ count: 5_000 });
    h.kind.forEach((kind, i) => {
      if (kind !== KIND.rung) return;
      const pair = (h.t[i] ?? 0) * HELIX.rungs - 0.5;
      expect(Math.abs(pair - Math.round(pair))).toBeLessThan(1e-4);
      const chord = h.seed[i * 4] ?? -1;
      expect(chord).toBeGreaterThanOrEqual(0);
      expect(chord).toBeLessThan(1);
    });
  });

  it('scatters the entrance positions inside a ball three radii wide', () => {
    const h = buildHelix({ count: 3_000 });
    const reach = HELIX.radius * 3 + 1e-4;
    for (let i = 0; i < h.count; i++) {
      const d = Math.hypot(h.scatter[i * 3] ?? 0, h.scatter[i * 3 + 1] ?? 0, h.scatter[i * 3 + 2] ?? 0);
      expect(d).toBeLessThanOrEqual(reach);
    }
  });
});
