import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Google Sans Flex is vendored as a 300-500 variable face. Ask an element for
 * `font-display` and `font-bold` at once and the browser SYNTHESIZES the bold
 * by smearing the 500 — which looks like a rendering fault on exactly the
 * largest text on the page. Caught here rather than in review.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(WEB_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...tsxFilesUnder(rel));
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

const SOURCES = [...tsxFilesUnder('components'), ...tsxFilesUnder('app')].filter(
  (file) => !file.startsWith('components/corridor'),
);

const OUT_OF_RANGE = /font-(?:semibold|bold|extrabold|black)/;

describe('the display face is never asked for a weight it does not have', () => {
  it('scans a meaningful number of files, so a path change cannot make this vacuous', () => {
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it.each(SOURCES)('%s pairs font-display only with 300-500 weights', (file) => {
    const source = readFileSync(join(WEB_ROOT, file), 'utf8');
    for (const [line] of source.matchAll(/^.*font-display.*$/gm)) {
      expect(
        OUT_OF_RANGE.test(line),
        `${file}: font-display sits with a weight the face lacks, so the browser will synthesize it:\n  ${line.trim()}`,
      ).toBe(false);
    }
  });
});
