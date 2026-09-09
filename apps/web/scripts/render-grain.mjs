#!/usr/bin/env node
/**
 * The grain tile — Landing-Page-Specs §3.4 material 1.
 *
 * A single tile, laid over the fixed viewport at 3.5% with
 * `mix-blend-mode: overlay`. §3.4 is right that this does more to kill the
 * flat-CSS-gradient look than anything else on the page, and it is the
 * cheapest effect here: one image, one compositor layer, no per-frame work.
 *
 * ---------------------------------------------------------------------------
 * WHY 64×64 AND NOT §3.4's 128×128
 *
 * §3.4 asks for a 128×128 tile at ≤3 KB. Those two numbers cannot both hold:
 * noise is incompressible by construction, and a 128×128 tile measures 10.9 KB
 * at 32 grey levels, 5.8 KB at 8, and still 3.4 KB when crushed to 4 levels —
 * by which point the grain has visible banding and reads as dither.
 *
 * The budget is the binding constraint (§8.1), so the tile shrinks instead of
 * the palette: 64×64 at 32 levels is 2.7 KB and keeps the full tonal range.
 * A 64 px repeat under a 3.5% overlay is not perceptible — the period is
 * shorter than the eye's threshold for detecting structure at that contrast,
 * which is the same reason film grain plates tile at all.
 * ---------------------------------------------------------------------------
 *
 * Deterministic. Committed. Regenerating it should produce identical bytes.
 *
 * Usage: node apps/web/scripts/render-grain.mjs
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WEB_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SIZE = 64;
const LEVELS = 32;

/**
 * A seeded 32-bit generator, so the tile is the same on every machine.
 * `Math.random()` would make this file change on every run and turn a
 * decorative asset into a permanent diff.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x0c0ff1de);
const buf = Buffer.alloc(SIZE * SIZE);

for (let i = 0; i < buf.length; i++) {
  /*
   * Two samples averaged, then quantised to 32 levels.
   *
   * A single uniform sample gives a harsh, evenly-distributed speckle that
   * reads as sensor noise. Averaging two pushes the distribution towards the
   * middle, which under an overlay blend is film grain — most pixels barely
   * move, a few carry the texture.
   */
  const v = (rand() + rand()) / 2;
  buf[i] = Math.round(Math.round(v * (LEVELS - 1)) * (255 / (LEVELS - 1)));
}

const png = await sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 1 } })
  .png({ palette: true, colours: LEVELS, compressionLevel: 9, effort: 10 })
  .toBuffer();

writeFileSync(join(WEB_ROOT, 'public', 'grain.png'), png);
console.log(`grain.png: ${SIZE}×${SIZE}, ${png.length} bytes (budget 3072)`);
if (png.length > 3072) process.exitCode = 1;
