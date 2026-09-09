#!/usr/bin/env node
/**
 * Renders the hero slice sequence — Landing-Page-Specs §7.1.
 *
 * The landing page's signature mechanic is scroll-as-slice: the hero is a
 * volume, and scrolling scrubs through it. This script produces that volume as
 * two AVIF sequences (one per delivery tier) plus a poster frame.
 *
 * ---------------------------------------------------------------------------
 * WHY A PHANTOM AND NOT THE DICOM FIXTURES
 *
 * §7.1 says to render the sequence from the de-identified DICOM fixtures that
 * BUILD_SPEC P0.2 requires. Two facts move this off that path:
 *
 *   1. This repository does not HAVE downloaded fixtures. ADR-7 and
 *      test-data/README.md are explicit that nothing under test-data/ may come
 *      from a clinical source, so `generate-fixtures.mjs` builds the corpus
 *      byte-by-byte. Its pixel data is a 16-bit gradient with a moving block —
 *      correct for a parser test, and a test card on a billboard.
 *   2. Pulling a TCIA collection to fix that would import someone else's
 *      de-identification as a dependency of the marketing site, which is the
 *      exact trade ADR-7 declines.
 *
 * A 3D Shepp-Logan phantom is the honest third option. It is the canonical
 * synthetic volume of computed tomography — Shepp & Logan 1974, and every
 * reconstruction paper since — so it is authentically radiological rather than
 * a sci-fi costume. It is defined by ten ellipsoids and a random seed, which
 * makes it provably synthetic in the strongest sense available: there is no
 * patient, anywhere, for it to have come from. §7.3's rule ("even synthetic-
 * looking imagery must be provably synthetic") is satisfied by construction
 * rather than by a licence file.
 *
 * Deterministic: the same bytes on every machine, every run. Committed output,
 * so a deploy needs neither this script nor sharp.
 * ---------------------------------------------------------------------------
 *
 * Usage: node apps/web/scripts/render-slices.mjs
 */

import { mkdirSync, rmSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WEB_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(WEB_ROOT, 'public', 'seq', 'hero');

/**
 * §7.1 budget: tier a under 260 KB total, tier b under 120 KB. Frame count is
 * the lever, quality is not — a 32-frame sequence at good quality beats a
 * 48-frame mush, and at scrub speed nobody sees the difference.
 *
 * §4's suggested 48 frames came to 326 KB at this quality, so the count came
 * down to 36 rather than the quality coming down to meet it. That is §7.1's
 * own instruction, and 36 frames over a ~1.6 viewport scrub is a slice every
 * ~30 px of travel — finer than the eye resolves at scrub speed.
 */
const TIERS = {
  a: { width: 1280, height: 720, frames: 36, quality: 44, budget: 260_000 },
  b: { width: 800, height: 450, frames: 24, quality: 42, budget: 120_000 },
};

/** Supersample factor. Ellipsoid edges alias badly at 1 sample per pixel. */
const SS = 2;

// ---------------------------------------------------------------------------
// The phantom
// ---------------------------------------------------------------------------

/**
 * The 3D Shepp-Logan head phantom (Kak & Slaney, *Principles of Computerized
 * Tomographic Imaging*, Table 3.1 extended to three dimensions).
 *
 * Each entry is an ellipsoid: semi-axes (a, b, c), centre (x0, y0, z0), a
 * rotation about the slice axis in degrees, and the attenuation it adds. The
 * volume is the SUM over every ellipsoid containing the point — which is why
 * the second entry is negative: it hollows the skull out to make the brain.
 */
const ELLIPSOIDS = [
  { a: 0.69, b: 0.92, c: 0.81, x: 0, y: 0, z: 0, phi: 0, v: 1.0 },
  { a: 0.6624, b: 0.874, c: 0.78, x: 0, y: -0.0184, z: 0, phi: 0, v: -0.8 },
  { a: 0.11, b: 0.31, c: 0.22, x: 0.22, y: 0, z: 0, phi: -18, v: -0.2 },
  { a: 0.16, b: 0.41, c: 0.28, x: -0.22, y: 0, z: 0, phi: 18, v: -0.2 },
  { a: 0.21, b: 0.25, c: 0.41, x: 0, y: 0.35, z: -0.15, phi: 0, v: 0.1 },
  { a: 0.046, b: 0.046, c: 0.05, x: 0, y: 0.1, z: 0.25, phi: 0, v: 0.1 },
  { a: 0.046, b: 0.046, c: 0.05, x: 0, y: -0.1, z: 0.25, phi: 0, v: 0.1 },
  { a: 0.046, b: 0.023, c: 0.05, x: -0.08, y: -0.605, z: 0, phi: 0, v: 0.1 },
  { a: 0.023, b: 0.023, c: 0.02, x: 0, y: -0.606, z: 0, phi: 0, v: 0.1 },
  { a: 0.023, b: 0.046, c: 0.02, x: 0.06, y: -0.605, z: 0, phi: 0, v: 0.1 },
];

const PRECOMPUTED = ELLIPSOIDS.map((e) => ({
  ...e,
  cos: Math.cos((e.phi * Math.PI) / 180),
  sin: Math.sin((e.phi * Math.PI) / 180),
}));

/** Attenuation at a point in the phantom's unit cube. */
function sample(x, y, z) {
  let acc = 0;
  for (const e of PRECOMPUTED) {
    const dx = x - e.x;
    const dy = y - e.y;
    const dz = z - e.z;
    const rx = dx * e.cos + dy * e.sin;
    const ry = -dx * e.sin + dy * e.cos;
    if (
      (rx * rx) / (e.a * e.a) + (ry * ry) / (e.b * e.b) + (dz * dz) / (e.c * e.c) <=
      1
    ) {
      acc += e.v;
    }
  }
  return acc;
}

/**
 * Deterministic value noise — a scanner's texture, not a random number
 * generator's. Reconstruction noise in CT is spatially correlated, so pure
 * per-pixel randomness reads as film grain rather than as tissue. This is a
 * cheap hash-lattice with bilinear interpolation, which correlates it over a
 * few pixels and is stable across runs and machines.
 */
function hash3(ix, iy, iz) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5;
}

function valueNoise(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smoothstep the interpolant so the lattice does not show as a grid.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash3(ix, iy, z);
  const n10 = hash3(ix + 1, iy, z);
  const n01 = hash3(ix, iy + 1, z);
  const n11 = hash3(ix + 1, iy + 1, z);
  return (
    n00 * (1 - sx) * (1 - sy) + n10 * sx * (1 - sy) + n01 * (1 - sx) * sy + n11 * sx * sy
  );
}

// ---------------------------------------------------------------------------
// Windowing and tint
// ---------------------------------------------------------------------------

/**
 * Window/level, as a radiologist would set it — §7.1 uses a soft-tissue
 * window. The phantom's attenuation runs roughly 0 (air) to 1 (skull), so the
 * window is expressed in those units rather than in Hounsfield.
 */
const WINDOW_CENTER = 0.42;
const WINDOW_WIDTH = 0.72;

function windowed(v) {
  const lo = WINDOW_CENTER - WINDOW_WIDTH / 2;
  return Math.min(1, Math.max(0, (v - lo) / WINDOW_WIDTH));
}

/**
 * Map greyscale onto the palette — §7.1's `tint()`.
 *
 * Void at the bottom, a phosphor-lifted near-white at the top. The lift is
 * only 35% phosphor: the accent is a signal (§3.1) and a hero image made
 * entirely of it would spend the whole budget in one place.
 */
const VOID = [6, 8, 11];
const HIGH = [
  0.35 * 63 + 0.65 * 255,
  0.35 * 224 + 0.65 * 255,
  0.35 * 197 + 0.65 * 255,
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * One slice, as a raw RGB buffer.
 *
 * `z` walks the slice axis. The phantom occupies |z| <= 0.81, and the sequence
 * runs a little short of that at each end so the first and last frames still
 * carry anatomy — a stack that opens and closes on empty black reads as a
 * loading failure, which is the one thing the hero may not look like.
 */
function renderSlice(z, width, height) {
  const w = width * SS;
  const h = height * SS;
  const buf = Buffer.alloc(w * h * 3);

  // The phantom is square; the frame is 16:9. Fit to height and centre.
  const scale = 2 / h;
  const cx = w / 2;
  const cy = h / 2;

  for (let py = 0; py < h; py++) {
    const y = (py - cy) * scale;
    for (let px = 0; px < w; px++) {
      const x = (px - cx) * scale;

      let g = 0;
      if (x * x + y * y < 1.4) {
        // Attenuation, then noise only where there is tissue to be noisy.
        const a = sample(x, y, z);
        g = windowed(a > 0 ? a + valueNoise(px / SS / 3, py / SS / 3, Math.round(z * 40)) * 0.06 : 0);
      }

      const o = (py * w + px) * 3;
      buf[o] = Math.round(VOID[0] + (HIGH[0] - VOID[0]) * g);
      buf[o + 1] = Math.round(VOID[1] + (HIGH[1] - VOID[1]) * g);
      buf[o + 2] = Math.round(VOID[2] + (HIGH[2] - VOID[2]) * g);
    }
  }

  return { buf, w, h };
}

async function encode(z, tier, quality) {
  const { buf, w, h } = renderSlice(z, tier.width, tier.height);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .resize(tier.width, tier.height, { kernel: 'lanczos3' })
    .avif({ quality, effort: 6, chromaSubsampling: '4:2:0' })
    .toBuffer();
}

const Z_START = -0.66;
const Z_END = 0.66;

function totalBytes(dir) {
  return readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });

  for (const [name, tier] of Object.entries(TIERS)) {
    const dest = join(OUT, name);
    mkdirSync(dest, { recursive: true });

    for (let i = 0; i < tier.frames; i++) {
      const z = Z_START + ((Z_END - Z_START) * i) / (tier.frames - 1);
      const avif = await encode(z, tier, tier.quality);
      writeFileSync(join(dest, `${String(i + 1).padStart(4, '0')}.avif`), avif);
    }

    const bytes = totalBytes(dest);
    const ok = bytes <= tier.budget;
    console.log(
      `tier ${name}: ${tier.frames} frames @ ${tier.width}px — ` +
        `${(bytes / 1024).toFixed(1)} KB (budget ${(tier.budget / 1024).toFixed(0)} KB) ${ok ? 'OK' : 'OVER'}`,
    );
    if (!ok) process.exitCode = 1;
  }

  /*
   * The poster is what Tier C sees and what every tier paints before the
   * first frame decodes, so it is encoded at a higher quality than the
   * sequence: it is a still that someone may look at for the length of their
   * whole visit, not a frame that flicks past in 30 ms.
   */
  const poster = await encode(0, TIERS.a, 58);
  writeFileSync(join(OUT, 'poster.avif'), poster);
  console.log(`poster: ${(poster.length / 1024).toFixed(1)} KB`);

  writeFileSync(join(OUT, 'SOURCE.md'), SOURCE_MD);
}

const SOURCE_MD = `# Hero slice sequence — provenance

**These images contain no patient data of any kind, from any source.**

They are not a de-identified study. They are not a study at all. Every frame is
computed from an analytic phantom by \`apps/web/scripts/render-slices.mjs\`,
which contains the ten ellipsoids that define it and nothing else. There is no
person for this volume to have come from.

## What it is

The **3D Shepp-Logan head phantom** — Shepp, L. A. & Logan, B. F., "The Fourier
reconstruction of a head section", *IEEE Transactions on Nuclear Science* 21(3),
1974; the three-dimensional parameters as tabulated in Kak, A. C. & Slaney, M.,
*Principles of Computerized Tomographic Imaging*, IEEE Press 1988, Table 3.1.

The phantom is the standard synthetic test object of computed tomography. It is
a mathematical definition published in the open literature, not a dataset, and
so carries no licence, no attribution requirement, and no data-protection
question.

## Why not a public de-identified collection

Landing-Page-Specs §7.1 suggests rendering from the TCIA / IDC fixtures that
BUILD_SPEC P0.2 asks for. This repository deliberately has none: ADR-7 and
\`test-data/README.md\` require every fixture to be generated byte-by-byte
rather than downloaded, so that a real patient's data cannot reach the
repository even by accident. Pulling a clinical collection to feed the
marketing site would make someone else's de-identification a dependency of the
public web page — the trade ADR-7 exists to refuse.

§7.3 requires that even synthetic-looking imagery be *provably* synthetic. A
phantom defined by ten ellipsoids and a seeded hash is the strongest available
form of that proof.

## Reproducing

\`\`\`bash
node apps/web/scripts/render-slices.mjs
\`\`\`

Deterministic: identical bytes on every machine and every run. The output is
committed, so neither a deploy nor CI needs sharp or this script.
`;

await main();
