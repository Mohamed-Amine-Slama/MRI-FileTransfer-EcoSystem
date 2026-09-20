import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The palette blocks of globals.css, read as data.
 *
 * Brace-matched rather than regex-to-the-next-`}`: a nested block would
 * otherwise truncate the capture silently and make every assertion that uses
 * this pass against half a palette.
 *
 * `lib/theme/tokens.test.ts` keeps its own copy of this logic on purpose. It
 * is the guard proving the two dark blocks agree, and it should not depend on
 * a module that could change underneath it.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(join(WEB_ROOT, 'app', 'globals.css'), 'utf8');

export function readPalette(selector: string): Map<string, string> {
  const found = new Map<string, string>();
  let cursor = 0;

  for (;;) {
    const start = CSS.indexOf(selector, cursor);
    if (start === -1) break;

    const open = CSS.indexOf('{', start);
    if (open === -1) break;

    let depth = 1;
    let i = open + 1;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === '{') depth += 1;
      else if (CSS[i] === '}') depth -= 1;
      i += 1;
    }

    for (const line of CSS.slice(open + 1, i - 1).split('\n')) {
      const match = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        found.set(match[1], match[2].trim());
      }
    }
    cursor = i;
  }

  return found;
}
