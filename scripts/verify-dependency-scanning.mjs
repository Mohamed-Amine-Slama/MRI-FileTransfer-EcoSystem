#!/usr/bin/env node
/**
 * Verifies that the P14.2 dependency scan actually blocks a vulnerable package.
 *
 * `pnpm audit` passing proves the dependency tree is currently clean. It does
 * NOT prove the check works. A severity threshold raised to `critical`, a
 * scanner pointed at a directory with no lockfile, or an `|| true` appended in
 * CI all leave the job green while enforcing nothing — invisible precisely
 * because green looks like health.
 *
 * So this plants a package with a known high-severity advisory, asserts the
 * scanner rejects it by name, removes it, and asserts the tree is clean again.
 *
 * Same shape as verify-boundary-enforcement.mjs, for the same reason.
 *
 * Run: node scripts/verify-dependency-scanning.mjs   (wired into CI)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'package.json');
const LOCKFILE = join(REPO, 'pnpm-lock.yaml');
const MANIFEST_BACKUP = join(REPO, 'package.json.scanprobe-backup');
const LOCKFILE_BACKUP = join(REPO, 'pnpm-lock.yaml.scanprobe-backup');

/**
 * minimist 1.2.5 — GHSA-xvch-5gv4-984h, prototype pollution, HIGH.
 *
 * Chosen because it is tiny, has no dependencies of its own, and the advisory
 * is long-published and stable.
 *
 * The assertion is on the ADVISORY ID and the package name, never on a CVSS
 * score: scores get revised, and asserting "high" would silently weaken if the
 * advisory were ever rescored downward.
 */
const PROBE_PACKAGE = 'minimist';
const PROBE_VERSION = '1.2.5';
const PROBE_ADVISORY = 'GHSA-xvch-5gv4-984h';

function run(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (err) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function backup() {
  copyFileSync(MANIFEST, MANIFEST_BACKUP);
  copyFileSync(LOCKFILE, LOCKFILE_BACKUP);
}

function restore() {
  if (existsSync(MANIFEST_BACKUP)) {
    copyFileSync(MANIFEST_BACKUP, MANIFEST);
    rmSync(MANIFEST_BACKUP, { force: true });
  }
  if (existsSync(LOCKFILE_BACKUP)) {
    copyFileSync(LOCKFILE_BACKUP, LOCKFILE);
    rmSync(LOCKFILE_BACKUP, { force: true });
  }
}

function plantVulnerableDependency() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

  // This repo force-upgrades several packages through pnpm.overrides. If one
  // ever pins the probe package, the planted version would be silently
  // upgraded out of vulnerability and this script would report a false
  // failure — so refuse to run rather than report a misleading result.
  if (manifest.pnpm?.overrides?.[PROBE_PACKAGE] !== undefined) {
    throw new Error(
      `pnpm.overrides pins ${PROBE_PACKAGE}; the probe would be neutralised. ` +
        `Choose a different probe package.`,
    );
  }

  // A PRODUCTION dependency, not a dev one: Trivy leaves devDependencies out
  // of pnpm lockfile results unless run with --include-dev-deps, and CI's
  // Trivy step does not pass it. A dev-dependency probe therefore proves
  // nothing about the scan CI actually runs — it just makes Trivy look blind.
  manifest.dependencies = {
    ...manifest.dependencies,
    [PROBE_PACKAGE]: PROBE_VERSION,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  // Resolve into the lockfile without linking anything into node_modules:
  // `pnpm audit` reads the lockfile, so that is all the scanner needs, and it
  // keeps the probe from disturbing the installed tree.
  const install = run('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile']);
  if (install.code !== 0) {
    throw new Error(`could not resolve the probe dependency:\n${install.output}`);
  }
}

let failures = 0;
function note(ok, message) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures += 1;
}

console.log('\nP14.2 — dependency scan enforcement\n' + '='.repeat(70));

const digestBefore = { manifest: digest(MANIFEST), lockfile: digest(LOCKFILE) };

backup();
try {
  // --- 1. baseline: the real tree must be clean ----------------------------
  const before = run('pnpm', ['audit', '--audit-level', 'high']);
  note(before.code === 0, 'baseline: pnpm audit passes on the real tree');
  if (before.code !== 0) {
    console.error(
      '\nThe repository has a pre-existing high/critical advisory. Fix or ' +
        'document it — do not weaken this probe to route around it.\n',
    );
    console.error(before.output.slice(-2000));
  }

  // --- 2. a planted vulnerability must be rejected -------------------------
  plantVulnerableDependency();

  const audited = run('pnpm', ['audit', '--audit-level', 'high']);
  note(
    audited.code !== 0,
    `planted ${PROBE_PACKAGE}@${PROBE_VERSION}: pnpm audit exits non-zero`,
  );
  note(
    audited.output.includes(PROBE_ADVISORY) || audited.output.includes(PROBE_PACKAGE),
    `pnpm audit names the advisory (${PROBE_ADVISORY}) or the package`,
  );

  // --- 3. Trivy, where available, must agree -------------------------------
  // Two scanners because they read different sources: pnpm audit reads the
  // lockfile against the GitHub advisory database, Trivy reads its own. One
  // going quiet should not take the other down with it.
  if (run('trivy', ['--version']).code === 0) {
    const trivy = run('trivy', [
      'fs',
      '--scanners',
      'vuln',
      '--severity',
      'HIGH,CRITICAL',
      '--exit-code',
      '1',
      '--quiet',
      REPO,
    ]);
    note(trivy.code !== 0, 'trivy independently flags the planted dependency');
  } else {
    console.log('  skip  trivy not installed locally; CI installs it');
  }
} catch (err) {
  note(false, `probe could not run: ${err.message}`);
} finally {
  // Always restore, even if a scanner throws. A probe that corrupts the
  // manifest or lockfile is worse than no probe at all.
  restore();
}

// --- 4. removing the probe must return the tree to clean --------------------

const after = run('pnpm', ['audit', '--audit-level', 'high']);
note(after.code === 0, 'probe removed: pnpm audit passes again');

// Compare against the bytes captured before the probe ran, NOT against git
// HEAD: the working tree may legitimately carry uncommitted changes, and this
// check is about whether the probe cleaned up after itself.
note(
  digest(MANIFEST) === digestBefore.manifest && digest(LOCKFILE) === digestBefore.lockfile,
  'manifest and lockfile restored byte-for-byte',
);

console.log('='.repeat(70));
if (failures > 0) {
  console.error(`\n${failures} check(s) failed. The dependency scan is NOT enforcing.\n`);
  process.exit(1);
}
console.log('\nDependency scanning is enforcing. (P14.2)\n');
