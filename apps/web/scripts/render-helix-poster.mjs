#!/usr/bin/env node
/**
 * Render the helix posters — spec 2026-09-10 §5.6.
 *
 * The poster is what Tier C shows and what every tier paints first, so it has
 * to be THIS renderer's output, not an approximation. The script drives the
 * real page: it loads the hero on Tier A with `?helix-still`, which makes
 * HelixCanvas draw one fully assembled frame at time 0 with no pointer, then
 * reads that canvas and encodes it.
 *
 * Needs the app running:
 *   pnpm --filter @mir/web build && pnpm --filter @mir/web start
 *   node apps/web/scripts/render-helix-poster.mjs [baseUrl]
 *
 * Pass the real base URL as the first argument. The default below, :3001, is
 * a Docker container running an old image in this environment — pointing
 * this script at it silently re-renders posters from stale code.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(WEB_ROOT, 'public', 'helix');
const BASE = process.argv[2] ?? 'http://127.0.0.1:3001';
const BUDGET = 60 * 1024;
const TARGETS = [
  ['ltr', '/fr'],
  ['rtl', '/ar'],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

for (const [dir, path] of TARGETS) {
  await page.goto(`${BASE}${path}?tier=A&helix-still`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('#hero .helix')?.getAttribute('data-helix-state') === 'still',
    null,
    { timeout: 30_000 },
  );
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('#hero .helix canvas');
    return canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : '';
  });
  if (!dataUrl.startsWith('data:image/png')) throw new Error(`no canvas to read for ${dir}`);

  const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const { width, height } = await sharp(png).metadata();
  // quality: 30 — 42 produced 72.5 KB / 74.0 KB, over the 60 KB BUDGET below.
  const avif = await sharp(png).avif({ quality: 30, effort: 6 }).toBuffer();
  writeFileSync(join(OUT, `poster-${dir}.avif`), avif);

  const ok = avif.length <= BUDGET;
  console.log(`poster-${dir}.avif  ${width}×${height}  ${(avif.length / 1024).toFixed(1)} KB ${ok ? 'OK' : 'OVER 60 KB'}`);
  if (!ok) process.exitCode = 1;
}

await browser.close();
