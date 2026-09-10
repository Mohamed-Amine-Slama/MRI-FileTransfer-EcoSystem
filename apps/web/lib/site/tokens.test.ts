import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The light palette's contrast, as a test — spec 2026-09-10 §3.1.
 *
 * Parses the first `.corridor {` rule of corridor.css, composites any alpha
 * colour over its background, and computes WCAG 2.x contrast. A palette tweak
 * that quietly fails AA fails here instead of in an audit.
 */

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'corridor.css'),
  'utf8',
);

function tokens(): Map<string, string> {
  const start = CSS.search(/^\.corridor \{$/m);
  const end = CSS.indexOf('\n}', start);
  const body = CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return map;
}

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const n = parseInt(hex[1] ?? '0', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  }
  throw new Error(`unparseable colour: ${value}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fgToken: string, bgToken: string): number {
  const t = tokens();
  const bg = parse(t.get(bgToken) ?? '');
  const fg = over(parse(t.get(fgToken) ?? ''), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PALETTE = [
  '--c-ground', '--c-panel', '--c-panel-deep', '--c-ink', '--c-ink-subtle', '--c-ink-muted',
  '--c-line', '--c-accent', '--c-accent-deep', '--c-on-accent', '--c-lime', '--c-lime-edge',
  '--c-glass', '--c-glass-soft', '--c-glass-strong', '--c-alert',
];

/** Pairs that carry normal-size text. */
const TEXT: [string, string][] = [
  ['--c-ink', '--c-ground'],
  ['--c-ink', '--c-panel'],
  ['--c-ink', '--c-panel-deep'],
  ['--c-ink', '--c-lime'],
  ['--c-ink-subtle', '--c-ground'],
  ['--c-ink-subtle', '--c-panel'],
  ['--c-ink-subtle', '--c-panel-deep'],
  ['--c-accent', '--c-ground'],
  ['--c-accent', '--c-panel'],
  ['--c-accent', '--c-panel-deep'],
  ['--c-on-accent', '--c-accent'],
  ['--c-alert', '--c-ground'],
  ['--c-alert', '--c-panel'],
];

/** `--c-ink-muted` is for large text (≥ 24px) and decoration only. */
const LARGE: [string, string][] = [
  ['--c-ink-muted', '--c-ground'],
  ['--c-ink-muted', '--c-panel'],
  ['--c-ink-muted', '--c-panel-deep'],
];

describe('the light palette (spec §3.1)', () => {
  it('declares every palette token', () => {
    const t = tokens();
    for (const name of PALETTE) expect(t.has(name), name).toBe(true);
  });

  it.each(TEXT)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LARGE)('%s on %s reaches 3:1 for large text', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it('retires every dark-room token name', () => {
    expect(CSS).not.toMatch(/--c-(void|surface|raised|bone|ash|dim|phosphor|sand|clay)\b/);
    expect(CSS).not.toMatch(/--r-(plate|control)\b/);
  });
});
