import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The vendored faces — spec 2026-09-10 §3.2, app/fonts/README.md.
 *
 * `next/font/local` fails the build on a missing file, but nothing notices a
 * file that nothing loads any more, or a face shipped without its licence.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string): string => readFileSync(join(WEB_ROOT, path), 'utf8');

const referenced = [
  ...read('components/corridor/fonts.ts').matchAll(/app\/fonts\/([\w.-]+\.woff2)/g),
  ...read('app/layout.tsx').matchAll(/\.\/fonts\/([\w.-]+\.woff2)/g),
].map((match) => match[1] ?? '');

const onDisk = readdirSync(join(WEB_ROOT, 'app', 'fonts')).filter((f) => f.endsWith('.woff2'));

describe('vendored faces (§3.2)', () => {
  it('finds the declarations at all, so a path change cannot make this vacuous', () => {
    expect(referenced.length).toBeGreaterThanOrEqual(7);
  });

  it('has every face that a declaration names', () => {
    for (const file of referenced) expect(onDisk, file).toContain(file);
  });

  it('ships no face that nothing loads', () => {
    for (const file of onDisk) expect(referenced, file).toContain(file);
  });

  it('carries the SIL OFL for Google Sans Flex', () => {
    expect(read('app/fonts/GoogleSansFlex-OFL.txt')).toMatch(/SIL Open Font License, Version 1\.1/);
  });

  it('declares a light weight for Arabic display', () => {
    expect(read('app/layout.tsx')).toMatch(/IBMPlexSansArabic-Light\.woff2', weight: '300'/);
  });
});
