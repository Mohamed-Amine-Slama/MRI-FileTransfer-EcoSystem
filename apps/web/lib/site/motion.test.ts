import { describe, expect, it } from 'vitest';
import { REVEAL, REVEAL_TIMING, clamp01, litCount, trackTravel, trackX, wordStagger } from './motion';

describe('reveal presets (spec §3.3)', () => {
  it('lifts and blurs display text furthest', () => {
    expect(REVEAL.display).toEqual({ blur: 20, y: 60 });
    expect(REVEAL.body).toEqual({ blur: 12, y: 16 });
    expect(REVEAL.eyebrow).toEqual({ blur: 12, y: 12 });
  });

  it('staggers words 40 ms apart but never spreads a line over more than half a second', () => {
    expect(wordStagger(5)).toBeCloseTo(0.04);
    expect(wordStagger(40)).toBeCloseTo(REVEAL_TIMING.maxSpread / 39);
    expect(wordStagger(1)).toBeCloseTo(0.04);
    expect((wordStagger(40) * 39)).toBeLessThanOrEqual(REVEAL_TIMING.maxSpread + 1e-9);
  });
});

describe('clamp01', () => {
  it('pins values to the unit interval', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(3)).toBe(1);
  });
});

describe('horizontal track maths', () => {
  it('travels exactly the overflow, and never backwards', () => {
    expect(trackTravel(2063, 1440)).toBe(623);
    expect(trackTravel(900, 1440)).toBe(0);
  });

  it('moves toward the reader\'s forward in both directions (§3.6)', () => {
    expect(trackX(623, 1)).toBe(-623);
    expect(trackX(623, -1)).toBe(623);
    expect(trackX(0, 1)).toBe(0);
    expect(trackX(0, -1)).toBe(0);
  });
});

describe('scroll-lit words', () => {
  it('lights a share of the words proportional to progress', () => {
    expect(litCount(0, 10)).toBe(0);
    expect(litCount(0.5, 10)).toBe(5);
    expect(litCount(1, 10)).toBe(10);
    expect(litCount(1.4, 10)).toBe(10);
    expect(litCount(-1, 10)).toBe(0);
  });
});
