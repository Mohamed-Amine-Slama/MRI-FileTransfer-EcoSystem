import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEQUENCE, bisectOrder, framePath } from './sequence';
import {
  TIER_BUDGET,
  demoted,
  isTier,
  tierFromSignals,
  tierOverride,
  type Signals,
} from './tier';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A device that would earn Tier A, as the baseline each case departs from. */
const CAPABLE: Signals = {
  reducedMotion: false,
  saveData: false,
  effectiveType: '4g',
  downlink: 10,
  memory: 8,
  cores: 8,
  coarsePointer: false,
  webgl2: true,
};

describe('tier selection (§6.3)', () => {
  it('gives a capable desktop the full experience', () => {
    expect(tierFromSignals(CAPABLE)).toBe('A');
  });

  it.each<[string, Partial<Signals>]>([
    ['a vestibular preference', { reducedMotion: true }],
    ['someone paying for their bytes', { saveData: true }],
    ['a 2g connection', { effectiveType: '2g' }],
    ['a slow-2g connection', { effectiveType: 'slow-2g' }],
    ['a measured downlink under 1.5 Mbit', { downlink: 1.2 }],
    ['a 2 GB device', { memory: 2 }],
  ])('never loads the experience for %s', (_why, override) => {
    expect(tierFromSignals({ ...CAPABLE, ...override })).toBe('C');
  });

  it('puts a capable phone on Tier B rather than Tier A', () => {
    // A coarse pointer is a phone. The cursor light has nothing to follow and
    // the thermal budget is not a desktop's, so the full path is not offered
    // even when every other signal is good.
    expect(tierFromSignals({ ...CAPABLE, coarsePointer: true })).toBe('B');
  });

  it.each<[string, Partial<Signals>]>([
    ['no WebGL2', { webgl2: false }],
    ['four cores', { cores: 4 }],
    ['4 GB of memory', { memory: 4 }],
    ['3g', { effectiveType: '3g' }],
    ['a 3 Mbit downlink', { downlink: 3 }],
  ])('falls back to Tier B on %s', (_why, override) => {
    expect(tierFromSignals({ ...CAPABLE, ...override })).toBe('B');
  });

  it('treats reduced motion as an exit, not a modifier', () => {
    // §6.8: "not smaller animations — none". If this ever returns B, the page
    // is animating for someone who asked it not to.
    expect(tierFromSignals({ ...CAPABLE, reducedMotion: true })).toBe('C');
  });

  it('demotes one step at a time and stops at C', () => {
    expect(demoted('A')).toBe('B');
    expect(demoted('B')).toBe('C');
    expect(demoted('C')).toBe('C');
  });
});

describe('the ?tier= override (§12 L3)', () => {
  it('accepts each tier in either case', () => {
    expect(tierOverride('?tier=A')).toBe('A');
    expect(tierOverride('?tier=b')).toBe('B');
    expect(tierOverride('?foo=1&tier=c')).toBe('C');
  });

  it('ignores anything that is not a tier', () => {
    expect(tierOverride('?tier=S')).toBeNull();
    expect(tierOverride('?tier=')).toBeNull();
    expect(tierOverride('')).toBeNull();
  });

  it('recognises exactly three tiers', () => {
    expect(isTier('A')).toBe(true);
    expect(isTier('D')).toBe(false);
    expect(isTier(undefined)).toBe(false);
  });
});

describe('what each tier ships', () => {
  it('gives Tier C no sequence, no planes, and no atmospherics', () => {
    // Tier C is the HTML response. If it ever grows a moving part, the "ship
    // Tier C first" guarantee (§8.2 technique 1) is gone.
    expect(TIER_BUDGET.C).toEqual({
      sequence: null,
      planes: 0,
      atmospherics: false,
      expressive: false,
      interactiveDemo: false,
    });
  });

  it('keeps the interactive upload demo on both tiers that can run it', () => {
    // §Scene 04 is the site's strongest argument and §16 forbids hiding it.
    // It is JS, not cinema, so it survives demotion from A to B.
    expect(TIER_BUDGET.A.interactiveDemo).toBe(true);
    expect(TIER_BUDGET.B.interactiveDemo).toBe(true);
  });

  it('reserves the atmospherics for Tier A alone', () => {
    expect(TIER_BUDGET.A.atmospherics).toBe(true);
    expect(TIER_BUDGET.B.atmospherics).toBe(false);
  });
});

describe('the slice sequence on disk (§6.5)', () => {
  it.each(['a', 'b'] as const)('has exactly the frames tier %s claims', (dir) => {
    const files = readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero', dir));
    expect(files.filter((f) => f.endsWith('.avif'))).toHaveLength(SEQUENCE.frames[dir]);
  });

  it('names every frame the way the player asks for it', () => {
    const files = new Set(readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero', 'a')));
    for (let i = 0; i < SEQUENCE.frames.a; i++) {
      expect(files.has(framePath('a', i).split('/').pop() ?? ''), `frame ${i}`).toBe(true);
    }
  });

  it('ships the poster Tier C renders instead of the canvas', () => {
    expect(readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero'))).toContain('poster.avif');
  });

  it('records where the imagery came from (§7.1, §14)', () => {
    // A dataset with no recorded provenance is the one thing §7.3 will not
    // permit, even when the answer is "it is a phantom and there is no dataset".
    expect(readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero'))).toContain('SOURCE.md');
  });
});

describe('bisect load order (§6.5)', () => {
  it('loads the ends first, so any scroll position has a nearby frame', () => {
    expect(bisectOrder(9).slice(0, 3)).toEqual([0, 8, 4]);
  });

  it('covers every frame exactly once', () => {
    for (const n of [1, 2, 3, 24, 36, 48]) {
      const order = bisectOrder(n);
      expect(new Set(order).size, `n=${n}`).toBe(n);
      expect([...order].sort((x, y) => x - y), `n=${n}`).toEqual(
        Array.from({ length: n }, (_, i) => i),
      );
    }
  });

  it('survives degenerate counts rather than looping forever', () => {
    expect(bisectOrder(0)).toEqual([]);
    expect(bisectOrder(1)).toEqual([0]);
    expect(bisectOrder(2)).toEqual([0, 1]);
  });
});
