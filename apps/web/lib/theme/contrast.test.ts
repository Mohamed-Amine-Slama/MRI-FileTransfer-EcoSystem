import { describe, expect, it } from 'vitest';
import { readPalette } from './read-palette';

/**
 * The palette as an accessibility assertion — WCAG 2.2 AA.
 *
 * `tokens.test.ts` proves the palette is STRUCTURALLY complete: every light
 * token has a dark answer, and the two dark blocks agree. It says nothing
 * about whether the colours can be read. This does.
 *
 * 4.5:1 is the floor for text (SC 1.4.3). 3:1 is the floor for the boundary
 * of a control and for focus indicators (SC 1.4.11) — the rule the palette
 * before 2026-09-20 broke, with `--input` at 1.56:1.
 */

const LIGHT = readPalette(':root {');
const DARK = readPalette(":root[data-theme='dark']");

function channels(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex?.[1] === undefined) throw new Error(`not a 6-digit hex colour: ${value}`);
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(value: string): number {
  const [r, g, b] = channels(value).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(palette: Map<string, string>, fg: string, bg: string): number {
  const a = palette.get(fg);
  const b = palette.get(bg);
  if (a === undefined) throw new Error(`missing token: ${fg}`);
  if (b === undefined) throw new Error(`missing token: ${bg}`);
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum, what a failure would look like on screen] */
const PAIRS: ReadonlyArray<readonly [string, string, number, string]> = [
  ['--foreground', '--background', 4.5, 'body text on the page'],
  ['--foreground', '--card', 4.5, 'body text on a card'],
  ['--foreground', '--sidebar', 4.5, 'nav text on the sidebar'],
  ['--card-foreground', '--card', 4.5, 'card body text'],
  ['--muted-foreground', '--card', 4.5, 'secondary text on a card'],
  ['--muted-foreground', '--background', 4.5, 'secondary text on the page'],
  ['--muted-foreground', '--muted', 4.5, 'secondary text on a muted surface'],
  ['--primary-foreground', '--primary', 4.5, 'a primary button label'],
  ['--primary', '--card', 4.5, 'a link on a card'],
  ['--primary', '--background', 4.5, 'a link on the page'],
  ['--secondary-foreground', '--secondary', 4.5, 'a secondary button label'],
  ['--accent-foreground', '--accent', 4.5, 'accent text'],
  ['--destructive-foreground', '--destructive', 4.5, 'a destructive button label'],
  ['--success', '--success-surface', 4.5, 'a success badge'],
  ['--warning', '--warning-surface', 4.5, 'a warning badge'],
  ['--danger', '--danger-surface', 4.5, 'a danger badge'],
  ['--info', '--info-surface', 4.5, 'an info badge'],
  ['--highlight-foreground', '--highlight', 4.5, 'the CTA label on lime'],
  ['--input', '--card', 3, 'the border of a text input on a card'],
  ['--input', '--background', 3, 'the border of a text input on the page'],
  ['--ring', '--card', 3, 'the focus ring on a card'],
  ['--ring', '--background', 3, 'the focus ring on the page'],
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('the %s palette meets WCAG 2.2 AA', (_name, palette) => {
  it.each(PAIRS)('%s on %s clears %s:1 — %s', (fg, bg, min, what) => {
    const actual = ratio(palette, fg, bg);
    expect(actual, `${what}: ${fg} on ${bg} is ${actual.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});
