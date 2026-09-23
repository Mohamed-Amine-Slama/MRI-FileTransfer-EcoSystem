#!/usr/bin/env node
/**
 * Verifies that the P1.4 boundary rules actually block violations.
 *
 * `pnpm boundaries` proves the tree is currently clean. It does NOT prove the
 * rules still work — a config edit that quietly narrows a `from` path, or a
 * severity dropped to "warn", leaves the check passing forever while enforcing
 * nothing. That failure is invisible precisely because green looks like health.
 *
 * So this script plants known violations, asserts the checker rejects them by
 * name, removes them, and asserts the tree is clean again.
 *
 * Run: node scripts/verify-boundary-enforcement.mjs   (wired into CI)
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each fixture must be rejected by at least one of the named rules. */
const FIXTURES = [
  {
    path: 'apps/api/src/modules/patients/internal/__boundary_probe_target.ts',
    content: `export const probe = 'boundary probe target';\n`,
    expectRules: [],
  },
  {
    path: 'apps/api/src/modules/imaging/internal/__boundary_probe_cross.ts',
    content:
      `// Boundary probe: imaging reaching into patients' internals.\n` +
      `import { probe } from '../../patients/internal/__boundary_probe_target';\n` +
      `export const leaked = probe;\n`,
    expectRules: ['no-other-module-internal', 'cross-module-via-index-only'],
  },
  {
    path: 'apps/api/src/shared/__boundary_probe_shared.ts',
    content:
      `// Boundary probe: shared/ importing from modules/.\n` +
      `import { probe } from '../modules/patients/internal/__boundary_probe_target';\n` +
      `export const alsoLeaked = probe;\n`,
    expectRules: ['shared-must-not-import-modules', 'no-cross-module-internal'],
  },
];

// Resolved through the package's own `bin` map, not a hardcoded file: 18.4
// renamed bin/dependency-cruise.mjs to bin/dependency-cruiser.mjs, and a
// hardcoded path turned a minor bump into a MODULE_NOT_FOUND that this script
// reported as "the repository has boundary violations".
const CRUISER_DIR = join(REPO, 'node_modules', 'dependency-cruiser');
const CRUISER_BIN = join(
  CRUISER_DIR,
  JSON.parse(readFileSync(join(CRUISER_DIR, 'package.json'), 'utf8')).bin['dependency-cruise'],
);

function runCruiser() {
  try {
    const stdout = execFileSync(
      'node',
      [
        CRUISER_BIN,
        '--config',
        '.dependency-cruiser.cjs',
        'apps/api/src',
      ],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, output: stdout };
  } catch (err) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

function fail(message, detail) {
  console.error(`\nFAIL: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function plant() {
  for (const f of FIXTURES) {
    const abs = join(REPO, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
}

function unplant() {
  for (const f of FIXTURES) {
    rmSync(join(REPO, f.path), { force: true });
  }
}

// --- 1. baseline: the real tree must be clean -------------------------------

const before = runCruiser();
if (before.code !== 0) {
  fail(
    'the repository has boundary violations before any probe was planted.',
    before.output,
  );
}
console.log('OK  baseline: tree is clean (exit 0)');

// --- 2. planted violations must be rejected, by name ------------------------

let planted;
try {
  plant();
  planted = runCruiser();
} finally {
  // Always remove the probes, even if the cruiser throws. Leaving them behind
  // would break every subsequent run and look like a real violation.
  unplant();
}

if (planted.code === 0) {
  fail(
    'planted boundary violations were NOT detected. The P1.4 rules are not ' +
      'enforcing anything — check .dependency-cruiser.cjs for a narrowed path ' +
      'or a severity downgraded to "warn".',
    planted.output,
  );
}

const expected = [...new Set(FIXTURES.flatMap((f) => f.expectRules))];
const missing = expected.filter((rule) => !planted.output.includes(rule));
if (missing.length > 0) {
  fail(
    `violations were detected, but not by the expected rules: ${missing.join(', ')}.\n` +
      'A different rule catching the probe by accident is not the same as the ' +
      'intended rule working.',
    planted.output,
  );
}
console.log(`OK  probes rejected (exit ${planted.code}) by: ${expected.join(', ')}`);

// --- 3. cleanup must restore a clean tree -----------------------------------

const after = runCruiser();
if (after.code !== 0) {
  fail('probe cleanup left the tree dirty.', after.output);
}
console.log('OK  cleanup: tree is clean again (exit 0)');

console.log('\nBoundary enforcement verified: rules block violations and the tree is clean.');
