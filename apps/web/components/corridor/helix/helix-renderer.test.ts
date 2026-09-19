import { describe, expect, it } from 'vitest';
import { ATTRIBUTES, UNIFORMS, densityScale, hexToRgb01 } from './helix-renderer';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './helix-shaders';

/**
 * The renderer and the shaders name the same things. GL does not fail when a
 * name drifts — `getUniformLocation` returns null and the uniform is silently
 * zero — so the agreement is checked here instead.
 */

function declared(source: string, qualifier: 'in' | 'uniform'): string[] {
  return [...source.matchAll(new RegExp(`^${qualifier}\\s+\\w+\\s+(\\w+)`, 'gm'))].map((m) => m[1] ?? '');
}

describe('shader / renderer agreement', () => {
  it('starts both shaders with the version directive, as GLSL ES 3.00 requires', () => {
    expect(VERTEX_SHADER.startsWith('#version 300 es\n')).toBe(true);
    expect(FRAGMENT_SHADER.startsWith('#version 300 es\n')).toBe(true);
  });

  it('binds exactly the attributes the vertex shader declares', () => {
    expect(declared(VERTEX_SHADER, 'in').sort()).toEqual([...ATTRIBUTES].sort());
  });

  it('sets every uniform either shader declares, and none that neither does', () => {
    const inShaders = new Set([...declared(VERTEX_SHADER, 'uniform'), ...declared(FRAGMENT_SHADER, 'uniform')]);
    expect(inShaders).toEqual(new Set(UNIFORMS));
  });
});

describe('hexToRgb01', () => {
  it('converts a 6-digit hex to unit floats', () => {
    const [r, g, b] = hexToRgb01('#246f65');
    expect(r).toBeCloseTo(36 / 255);
    expect(g).toBeCloseTo(111 / 255);
    expect(b).toBeCloseTo(101 / 255);
  });
});

describe('densityScale', () => {
  it('leaves the tuned density alone', () => {
    const [alpha, size] = densityScale(140_000, 1140, 900);
    expect(alpha).toBeCloseTo(1);
    expect(size).toBeCloseTo(1);
  });

  it('strengthens a sparser canvas and softens a denser one, within bounds', () => {
    const [sparseAlpha, sparseSize] = densityScale(48_000, 1140, 900);
    expect(sparseAlpha).toBeGreaterThan(1);
    expect(sparseSize).toBeGreaterThan(1);
    const [denseAlpha, denseSize] = densityScale(48_000, 390, 338);
    expect(denseAlpha).toBeLessThan(1);
    expect(denseSize).toBeLessThan(1);
    for (const [a, s] of [densityScale(1, 4000, 4000), densityScale(1e9, 10, 10)]) {
      expect(a).toBeGreaterThanOrEqual(0.55);
      expect(a).toBeLessThanOrEqual(2.4);
      expect(s).toBeGreaterThanOrEqual(0.85);
      expect(s).toBeLessThanOrEqual(1.5);
    }
  });
});
