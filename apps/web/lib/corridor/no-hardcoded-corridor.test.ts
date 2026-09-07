import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Brief §4.3: "No UI copy, routing, or business logic should assume
 * Libya/Tunisia specifically as constants."
 *
 * `lib/corridor/registry.ts` is the one permitted exception — it is where
 * corridors are configured, so it necessarily names them. Everything else must
 * go through `sideForRole` / `getCorridor`.
 *
 * This test also records a known debt: V0's screens predate the corridor layer
 * and still branch on role literals. `ALLOWED` lists them, and the list may
 * only ever SHRINK. Deleting an entry as each screen is migrated is what turns
 * the rule into a ratchet rather than a comment nobody enforces.
 *
 * `app/doctor/availability/page.tsx` came off the list when /schedule replaced
 * it: the new workspace gates on PROVIDER_ROLES rather than naming the
 * receiving role, so both corridor sides get a calendar from the same screen.
 * The route now 308s to /schedule/availability (next.config.mjs).
 *
 * `app/consent/page.tsx` came off the list by being deleted: migration 0021
 * removed patient accounts, and that screen existed only so a signed-in
 * patient could grant consent. Consent is now an attestation the referring
 * doctor makes, so there is no user for that screen to serve.
 */

// Resolved from this file, not from cwd, so the test does not depend on where
// the runner was invoked.
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTS = ['app', 'components'];

const ALLOWED = new Set([
  'app/appointments/[id]/page.tsx',
  'app/appointments/new/page.tsx',
  'app/appointments/page.tsx',
  'app/doctor/page.tsx',
  'app/layout.tsx',
  'app/page.tsx',
  'app/patients/[id]/page.tsx',
  'app/patients/new/page.tsx',
  'app/patients/page.tsx',
  'app/upload/page.tsx',
]);

const FORBIDDEN = /\b(libya_doctor|tunisia_doctor|Libya|Tunisia|Libye|Tunisie)\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Repo-relative, forward-slashed, so the allowlist reads the same on Windows. */
function key(absolute: string): string {
  return relative(WEB_ROOT, absolute).split('\\').join('/');
}

describe('no hardcoded corridor (§4.3)', () => {
  const files = ROOTS.flatMap((root) => walk(join(WEB_ROOT, root)));

  it('finds screens to check at all, so a bad path cannot make this vacuous', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no unlisted screen naming a country or a country-specific role', () => {
    const offenders = files
      .map(key)
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => FORBIDDEN.test(readFileSync(join(WEB_ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keeps the debt list honest — a cleaned-up screen must leave ALLOWED', () => {
    // A deleted screen counts as stale rather than throwing ENOENT, so a
    // forgotten entry reads as the ratchet failing instead of the test file
    // crashing on a path that is gone.
    const present = new Set(files.map(key));
    const stale = [...ALLOWED].filter(
      (file) =>
        !present.has(file) ||
        !FORBIDDEN.test(readFileSync(join(WEB_ROOT, file), 'utf8')),
    );
    expect(stale).toEqual([]);
  });

  it('keeps the new case layer clean — it consumes corridors, it does not name them', () => {
    // registry.ts and its test are the configuration exception: one declares
    // the corridors, the other asserts on what it declared. Everything built
    // on top of them must resolve sides instead.
    for (const file of [
      'lib/api/cases.ts',
      'lib/api/mock/mock-cases.ts',
      'lib/api/mock/fixtures.ts',
      'lib/i18n/provider.tsx',
    ]) {
      expect(FORBIDDEN.test(readFileSync(join(WEB_ROOT, file), 'utf8')), file).toBe(false);
    }
  });
});
