# Landing Re-theme · Plan 1 of 3 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dark corridor landing page into the light mint/teal/lime register — tokens, typefaces, base controls, motion helpers — and retire the dark-room effects, without yet changing any scene's layout.

**Architecture:** All landing styling lives in `apps/web/app/corridor.css`, scoped under `.corridor`. This plan replaces the palette tokens (with a contrast test that parses that file), swaps the landing typefaces, restyles buttons/chips, adds pure motion helpers plus a one-shot "curtain lifted" signal that later reveals wait on, and deletes the grain/cursor-light/phosphor-caustic layers. Scenes keep their current markup until Plans 2 and 3.

**Tech Stack:** Next.js 15 (app router), React 19, TypeScript, plain CSS (Tailwind v4 preflight present), GSAP + ScrollTrigger, Lenis, Vitest (node env), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-landing-light-retheme-design.md`

**Plan series:** this is plan 1 of 3. Plan 2 (`2026-09-10-retheme-2-hero-helix.md`) builds the hero and the particle helix; Plan 3 (`2026-09-10-retheme-3-scenes-chrome.md`) re-skins scenes 02–11, the header and the footer. Run them in order.

## Global Constraints

- Scope: the public landing page only — `apps/web/components/corridor/**`, `apps/web/app/corridor.css`, `apps/web/lib/site/**`, landing e2e specs, landing docs. The signed-in application's theme and components are untouched.
- Provenance: the reference site supplies direction only (palette values, proportions, motion vocabulary). All code is original; all copy comes from `apps/web/lib/site/copy.ts`; no marks, logos or photographs from the reference.
- Palette (spec §3.1, with one correction recorded in this plan): `--c-ground #ffffff`, `--c-panel #eff4f2`, `--c-panel-deep #e5f1ed`, `--c-ink #000000`, `--c-ink-subtle rgb(0 0 0 / 0.62)`, `--c-ink-muted rgb(0 0 0 / 0.45)`, `--c-line rgb(0 0 0 / 0.1)`, `--c-accent #246f65`, `--c-accent-deep #054038`, `--c-on-accent #ffffff`, `--c-lime #f8ffb4`, `--c-lime-edge #e5ed9b`, `--c-glass rgb(255 255 255 / 0.8)`, `--c-glass-soft rgb(255 255 255 / 0.5)`, `--c-glass-strong rgb(255 255 255 / 0.9)`, `--glass-blur 10px`, `--c-alert #b3261e`, `--r-section 48px`, `--r-card 24px`, `--r-chip 37px`, `--r-pill 46px`, `--r-tile 8px`, `--ease-entrance cubic-bezier(.2, 0, 0, 1)`, `--dur-fast 150ms`, `--dur-normal 250ms`.
  - **Correction:** the spec listed `--c-ink-muted` at 40% and `--c-ink-subtle` at 50% black while also requiring every text pair ≥ 4.5:1. 50% black on white is 3.9:1 and 40% is 2.8:1, so those values cannot satisfy the spec's own rule. `--c-ink-subtle` is set to 62% (6.2:1 on white, ≥ 5.6:1 on both mints) and used for secondary text; `--c-ink-muted` is set to 45% (≥ 3.3:1) and is used **only** for large text (≥ 24px) and non-text decoration. Task 1's test enforces both thresholds.
- Contrast: every token pair used for normal text ≥ 4.5:1; `--c-ink-muted` pairs ≥ 3:1 (large text only). Enforced by `apps/web/lib/site/tokens.test.ts`.
- Layout is identical across tiers A/B/C (Landing-Page-Specs §6.3). The resting state is the correct state: nothing a reader needs is hidden by CSS at rest (`opacity: 0` only on a decorative layer with a visible stand-in, such as Plan 2's helix canvas over its poster); reveals animate only from JavaScript on tiers A/B.
- Direction: logical properties only (`inset-inline-*`, `margin-inline-*`, …); horizontal motion multiplies by `sign` from `useSite()`. Arabic text is never split below the word.
- Copy rules: every locale in `SITE_COPY` (`ar`, `fr`, `en`) has the same keys; no empty values; no exclamation marks; the §1.4 banned-claims test in `copy.test.ts` must stay green.
- Fonts are vendored (`font-src 'self'` is enforced); never load from a third-party origin at runtime.
- Commands run from the repository root unless stated. Web unit tests: `pnpm --filter @mir/web exec vitest run <path>` (node env, no database — safe while the local API runs). Do **not** run the API suite.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
  ```

---

## File map (this plan)

| File | Change | Responsibility |
|---|---|---|
| `apps/web/app/corridor.css` | modify | tokens, type scale, buttons/chips, removal of dark-room rules |
| `apps/web/lib/site/tokens.test.ts` | create | parses the token rule, asserts WCAG contrast |
| `apps/web/components/corridor/**/*.tsx` | modify | utility class rename (`ash`→`subtle`, …) |
| `apps/web/scripts/fetch-fonts.sh` | modify | vendors Google Sans Flex, Plex Sans Arabic Light, the OFL |
| `apps/web/app/fonts/*` | modify | add 2 faces + licence, remove Reem Kufi and Space Grotesk |
| `apps/web/components/corridor/fonts.ts` | modify | landing face declarations |
| `apps/web/app/layout.tsx` | modify | Plex Sans Arabic gains weight 300 |
| `apps/web/lib/site/fonts.test.ts` | create | every referenced face exists, none orphaned, licence present |
| `apps/web/lib/site/motion.ts` (+ `.test.ts`) | create | reveal presets, track maths, lit-word maths |
| `apps/web/lib/site/curtain.ts` (+ `.test.ts`) | create | one-shot "curtain lifted" signal |
| `apps/web/lib/site/split.ts` (+ test) | modify | `splitWords()` |
| `apps/web/lib/site/use-gsap.ts` | modify | setup may return a cleanup function |
| `apps/web/components/corridor/scenes/S00Load.tsx` | modify | lifts the curtain |
| `apps/web/components/corridor/Corridor.tsx` | modify | drops grain, CursorLight, WebGLHandoff |
| `apps/web/lib/site/tier.ts` (+ test) | modify | drops `atmospherics` |
| deleted | — | `motion/CursorLight.tsx`, `motion/WebGLHandoff.tsx`, `motion/webgl-handoff.ts`, `public/grain.png`, `scripts/render-grain.mjs` |
| `docs/landing-page-status.md` | modify | tree, asset pipeline, deviation row |

---

### Task 1: Palette tokens, utility classes, contrast test

**Files:**
- Create: `apps/web/lib/site/tokens.test.ts`
- Modify: `apps/web/app/corridor.css` (token rule at lines 36–160; utility lines; four dark-ground fixes)
- Modify: every `apps/web/components/corridor/**/*.tsx` that uses `bone|ash|dim|phosphor|sand` as a class or tone

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties listed in Global Constraints; utility classes `.ink`, `.subtle`, `.muted`, `.accent`, `.alert`. The rename is `bone→ink`, `ash→subtle`, **`dim→subtle`**, `phosphor→accent`, `sand→alert` — `dim` folds into `subtle` because it was used for small mono text, which `--c-ink-muted` (3.3:1) may not carry. `.muted` exists for large text only and nothing is renamed to it. S04's `LogLine['tone']` becomes `'subtle' | 'alert' | 'accent'`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/site/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The light palette's contrast, as a test — spec 2026-09-10 §3.1.
 *
 * Parses the first `.corridor {` rule of corridor.css, composites any alpha
 * colour over its background, and computes WCAG 2.x contrast. A palette tweak
 * that quietly fails AA fails here instead of in an audit.
 */

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'corridor.css'),
  'utf8',
);

function tokens(): Map<string, string> {
  const start = CSS.search(/^\.corridor \{$/m);
  const end = CSS.indexOf('\n}', start);
  const body = CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return map;
}

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const n = parseInt(hex[1] ?? '0', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  }
  throw new Error(`unparseable colour: ${value}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fgToken: string, bgToken: string): number {
  const t = tokens();
  const bg = parse(t.get(bgToken) ?? '');
  const fg = over(parse(t.get(fgToken) ?? ''), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PALETTE = [
  '--c-ground', '--c-panel', '--c-panel-deep', '--c-ink', '--c-ink-subtle', '--c-ink-muted',
  '--c-line', '--c-accent', '--c-accent-deep', '--c-on-accent', '--c-lime', '--c-lime-edge',
  '--c-glass', '--c-glass-soft', '--c-glass-strong', '--c-alert',
];

/** Pairs that carry normal-size text. */
const TEXT: [string, string][] = [
  ['--c-ink', '--c-ground'],
  ['--c-ink', '--c-panel'],
  ['--c-ink', '--c-panel-deep'],
  ['--c-ink', '--c-lime'],
  ['--c-ink-subtle', '--c-ground'],
  ['--c-ink-subtle', '--c-panel'],
  ['--c-ink-subtle', '--c-panel-deep'],
  ['--c-accent', '--c-ground'],
  ['--c-accent', '--c-panel'],
  ['--c-accent', '--c-panel-deep'],
  ['--c-on-accent', '--c-accent'],
  ['--c-alert', '--c-ground'],
  ['--c-alert', '--c-panel'],
];

/** `--c-ink-muted` is for large text (≥ 24px) and decoration only. */
const LARGE: [string, string][] = [
  ['--c-ink-muted', '--c-ground'],
  ['--c-ink-muted', '--c-panel'],
  ['--c-ink-muted', '--c-panel-deep'],
];

describe('the light palette (spec §3.1)', () => {
  it('declares every palette token', () => {
    const t = tokens();
    for (const name of PALETTE) expect(t.has(name), name).toBe(true);
  });

  it.each(TEXT)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LARGE)('%s on %s reaches 3:1 for large text', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it('retires every dark-room token name', () => {
    expect(CSS).not.toMatch(/--c-(void|surface|raised|bone|ash|dim|phosphor|sand|clay)\b/);
    expect(CSS).not.toMatch(/--r-(plate|control)\b/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mir/web exec vitest run lib/site/tokens.test.ts`
Expected: FAIL — `declares every palette token` fails on `--c-ground`, and `retires every dark-room token name` fails.

- [ ] **Step 3: Replace the token rule**

In `apps/web/app/corridor.css`, replace the whole first rule — from the line `.corridor {` (line 36) down to and including its closing `}` in column 0 (line 160), comments included — with exactly:

```css
.corridor {
  /*
   * -------------------------------------------------------------------------
   * THE LIGHT PALETTE — spec 2026-09-10 §3.1.
   *
   * A clinical, calm register: white ground, mint panels, one teal accent and
   * one lime highlight. Contrast is asserted by lib/site/tokens.test.ts, which
   * parses THIS rule — keep every colour a 6-digit hex or `rgb(r g b / a)`.
   *
   * `--c-ink-muted` is 3.3:1 at best: large text (≥ 24px) and decoration only.
   * Secondary body copy uses `--c-ink-subtle`.
   * -------------------------------------------------------------------------
   */
  --c-ground: #ffffff;
  --c-panel: #eff4f2;
  --c-panel-deep: #e5f1ed;
  --c-ink: #000000;
  --c-ink-subtle: rgb(0 0 0 / 0.62);
  --c-ink-muted: rgb(0 0 0 / 0.45);
  --c-line: rgb(0 0 0 / 0.1);
  --c-accent: #246f65;
  --c-accent-deep: #054038;
  --c-on-accent: #ffffff;
  --c-lime: #f8ffb4;
  --c-lime-edge: #e5ed9b;
  --c-glass: rgb(255 255 255 / 0.8);
  --c-glass-soft: rgb(255 255 255 / 0.5);
  --c-glass-strong: rgb(255 255 255 / 0.9);
  --c-alert: #b3261e;
  --glass-blur: 10px;

  /* Shape */
  --r-section: 48px;
  --r-card: 24px;
  --r-chip: 37px;
  --r-pill: 46px;
  --r-tile: 8px;

  /* Motion */
  --ease-entrance: cubic-bezier(0.2, 0, 0, 1);
  --dur-fast: 150ms;
  --dur-normal: 250ms;
  --e-out: cubic-bezier(0.16, 1, 0.3, 1);
  --e-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --e-snap: cubic-bezier(0.34, 1.56, 0.64, 1);
  --d-micro: 140ms;
  --d-enter: 620ms;
  --d-scene: 900ms;
  --d-hero: 1400ms;
  --stagger: 60ms;

  /* Direction, rhythm and type (type is replaced in Task 2) */
  --dir: 1;
  --script-scale: 1;
  --leading-body: 1.55;
  --margin: clamp(20px, 5vw, 120px);
  --content-max: 1440px;
  --measure: 68ch;
  --t-hero: calc(clamp(2.5rem, 1.4rem + 4.8vw, 5.75rem) * var(--script-scale));
  --t-h1: calc(clamp(2.25rem, 1.5rem + 3.4vw, 4.25rem) * var(--script-scale));
  --t-h2: calc(clamp(1.75rem, 1.35rem + 1.9vw, 2.75rem) * var(--script-scale));
  --t-h3: calc(clamp(1.375rem, 1.2rem + 0.8vw, 1.75rem) * var(--script-scale));
  --t-body-l: calc(clamp(1.0625rem, 1rem + 0.3vw, 1.25rem) * var(--script-scale));
  --t-body: calc(1rem * var(--script-scale));
  --t-meta: calc(0.8125rem * var(--script-scale));
  --f-display-latin: var(--font-grotesk), 'Segoe UI', system-ui, sans-serif;
  --f-display-arabic: var(--font-reem), var(--font-plex), 'Noto Kufi Arabic', sans-serif;
  --f-body: var(--font-plex), system-ui, -apple-system, 'Segoe UI', Tahoma, 'Noto Sans Arabic', sans-serif;
  --f-mono: var(--font-plex-mono), var(--font-plex), ui-monospace, 'SFMono-Regular', monospace;
  --scene-progress: 0;

  color-scheme: light;
  background-color: var(--c-ground);
  color: var(--c-ink);
  font-family: var(--f-body);
  font-size: var(--t-body);
  line-height: var(--leading-body);
  overflow-x: clip;
}
```

- [ ] **Step 4: Rename every remaining dark-room token in the stylesheet**

Run from `apps/web`:

```bash
perl -pi -e '
  s/--c-bone-soft\b/--c-ink/g;  s/--c-bone\b/--c-ink/g;
  s/--c-void\b/--c-ground/g;    s/--c-surface\b/--c-panel/g;  s/--c-raised\b/--c-panel-deep/g;
  s/--c-ash\b/--c-ink-subtle/g; s/--c-dim\b/--c-ink-subtle/g;
  s/--c-phosphor-d\b/--c-accent-deep/g; s/--c-phosphor\b/--c-accent/g;
  s/--c-sand\b/--c-alert/g;     s/--c-clay\b/--c-alert/g;
  s/--r-plate\b/--r-card/g;     s/--r-control\b/--r-tile/g;
  s/rgb\(63 224 197/rgb(36 111 101/g;
' app/corridor.css
```

- [ ] **Step 5: Replace the five colour utilities**

In `apps/web/app/corridor.css`, the five one-line utilities now read `.corridor .bone { color: var(--c-ink); }` … `.corridor .sand { color: var(--c-alert); }`. Replace those five lines with (`.muted` is new, for large text only):

```css
.corridor .ink { color: var(--c-ink); }
.corridor .subtle { color: var(--c-ink-subtle); }
.corridor .muted { color: var(--c-ink-muted); }
.corridor .accent { color: var(--c-accent); }
.corridor .alert { color: var(--c-alert); }
```

- [ ] **Step 6: Fix the four rules that only made sense on a dark ground**

Run from `apps/web`:

```bash
perl -0pi -e '
  s/background-color: rgb\(6 8 11 \/ 0\.86\);/background-color: var(--c-glass);\n  backdrop-filter: blur(var(--glass-blur));/;
  s/\n[ \t]*text-shadow: [^;]*;//g;
  s/rgb\(0 0 0 \/ 0\.8\)/rgb(0 0 0 \/ 0.18)/;
  s/#57eed5/var(--c-accent-deep)/;
' app/corridor.css
```

Then replace the `.corridor .plate { … }` rule (the one with `linear-gradient` and the three-layer `box-shadow`) with:

```css
.corridor .plate {
  position: relative;
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  background-color: var(--c-ground);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.04),
    0 24px 48px -32px rgb(0 0 0 / 0.18);
}
```

And delete the three rules that draw the phosphor corner ticks: `.corridor .plate::before, .corridor .plate::after { … }`, `.corridor .plate::before { … }` and `.corridor .plate::after { … }` (a 9px square tick does not sit on a 24px corner).

- [ ] **Step 7: Rename the utility classes and tones in the components**

Run from `apps/web`:

```bash
perl -pi -e '
  BEGIN { %m = (bone => "ink", ash => "subtle", dim => "subtle", phosphor => "accent", sand => "alert"); }
  s{(className=(?:"|\{`)[^"`]*)}{ my $x = $1; $x =~ s/\b(bone|ash|dim|phosphor|sand)\b/$m{$1}/g; $x }ge;
  s{\x27(bone|ash|dim|phosphor|sand)\x27}{"\x27$m{$1}\x27"}ge;
  s{var\(--c-phosphor\)}{var(--c-accent)}g;
' $(grep -rlE "\b(bone|ash|dim|phosphor|sand)\b|--c-phosphor" components/corridor --include=*.tsx)
```

Verify nothing was missed:

```bash
grep -rnE "className=[^>]*\b(bone|ash|dim|phosphor|sand)\b|'(bone|ash|dim|phosphor|sand)'|--c-phosphor" components/corridor --include=*.tsx
```
Expected: no output.

- [ ] **Step 8: Run the tests and the type check**

Run: `pnpm --filter @mir/web exec vitest run lib/site/tokens.test.ts`
Expected: PASS (all 18 cases).

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web exec vitest run`
Expected: typecheck exits 0 (S04's tone union changed consistently); all web unit tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/corridor.css apps/web/lib/site/tokens.test.ts apps/web/components/corridor
git commit -m "$(cat <<'EOF'
feat(landing): light palette tokens with an enforced contrast test

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 2: Typefaces, type scale, buttons, chips

**Files:**
- Create: `apps/web/lib/site/fonts.test.ts`, `apps/web/app/fonts/GoogleSansFlex-latin.woff2`, `apps/web/app/fonts/GoogleSansFlex-OFL.txt`, `apps/web/app/fonts/IBMPlexSansArabic-Light.woff2`
- Delete: `apps/web/app/fonts/ReemKufi-Medium-arabic.woff2`, `apps/web/app/fonts/SpaceGrotesk-Medium-latin.woff2`
- Modify: `apps/web/scripts/fetch-fonts.sh`, `apps/web/components/corridor/fonts.ts`, `apps/web/app/layout.tsx:59-68`, `apps/web/app/fonts/README.md`, `apps/web/app/corridor.css`

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: CSS variables `--font-sans-flex` (on `.corridor` via `CORRIDOR_FONT_CLASS`), `--t-pill`, `--leading-display`, `--w-body`; classes `.eyebrow`, `.btn--secondary`, `.chip`; `.btn--primary` / `.btn--ghost` restyled as pills.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/site/fonts.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mir/web exec vitest run lib/site/fonts.test.ts`
Expected: FAIL — `ships no face that nothing loads` and the OFL / light-weight cases fail.

- [ ] **Step 3: Replace the font fetch script**

Replace `apps/web/scripts/fetch-fonts.sh` with:

```bash
#!/usr/bin/env bash
# Re-download the landing page's vendored faces — app/fonts/README.md.
#
# Google Fonts serves a different file per User-Agent; this one asks for woff2.
# Re-running picks up whatever version is served today, so diff before
# committing: a font update is a visual change.
set -euo pipefail
cd "$(dirname "$0")/../app/fonts"

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

# get <css2 family query> <subset comment> <output file>
get() {
  local url
  url=$(curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=$1&display=swap" \
    | awk -v want="/* $2 */" 'index($0,want){f=1;next} f&&/src: url\(/{match($0,/https:[^)]*/); print substr($0,RSTART,RLENGTH); exit}')
  [ -n "$url" ] || { echo "no $2 subset found for $1" >&2; exit 1; }
  echo "$3 <- $url"
  curl -sS -o "$3" "$url"
}

# Latin display + body. Variable, weight 300–500; the latin subset covers fr and en.
get "Google+Sans+Flex:wght@300..500" latin GoogleSansFlex-latin.woff2
# Data, metadata and DICOM-style readouts.
get "IBM+Plex+Mono:wght@400"         latin IBMPlexMono-Regular-latin.woff2

# Arabic display weight. A COMPLETE file (both scripts), like the four Plex
# Sans Arabic weights the root layout already ships — from IBM's own release.
curl -sS -o IBMPlexSansArabic-Light.woff2 \
  https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans-arabic/fonts/complete/woff2/IBMPlexSansArabic-Light.woff2

# Google Sans Flex's licence text, from the family's own download manifest.
curl -sS 'https://fonts.google.com/download/list?family=Google%20Sans%20Flex' \
  | python3 -c 'import json,sys; t=sys.stdin.read(); d=json.loads(t[t.index("{"):]); print(next(f["contents"] for f in d["manifest"]["files"] if f["filename"]=="OFL.txt"), end="")' \
  > GoogleSansFlex-OFL.txt

ls -la ./*.woff2 ./GoogleSansFlex-OFL.txt
```

- [ ] **Step 4: Fetch the faces and remove the retired ones**

Run from `apps/web`:

```bash
bash scripts/fetch-fonts.sh
rm app/fonts/ReemKufi-Medium-arabic.woff2 app/fonts/SpaceGrotesk-Medium-latin.woff2
head -c 120 app/fonts/GoogleSansFlex-OFL.txt; echo
```
Expected: `GoogleSansFlex-latin.woff2` (roughly 40–90 KB), `IBMPlexSansArabic-Light.woff2` (~75 KB) listed; the OFL begins `This Font Software is licensed under the SIL Open Font License, Version 1.1.` If the OFL line is anything else, stop — the spec's fallback is Figtree (OFL) and the plan must be revised before continuing.

- [ ] **Step 5: Replace the landing face declarations**

Replace `apps/web/components/corridor/fonts.ts` with:

```ts
import localFont from 'next/font/local';

/**
 * The landing page's added faces — spec 2026-09-10 §3.2.
 *
 * The Arabic faces (IBM Plex Sans Arabic, now including Light 300 for display)
 * are declared in `app/layout.tsx` and shared with the whole application; the
 * two here exist only on this page.
 *
 * `preload: false` on both, deliberately: §8.2 technique 6 preloads the
 * critical body weights and nothing else, and a `swap` on the headline costs a
 * repaint of one line rather than a competing request in the first round-trip.
 *
 * `adjustFontFallback: false` on both: they are Latin-only subsets, and Next's
 * synthetic Arial-derived fallback is inserted AHEAD of `--font-plex` in the
 * stack, so every Arabic glyph would fall through to it instead of to Plex.
 */

/** Latin display and body. Variable, weight 300–500. */
export const sansFlex = localFont({
  src: '../../app/fonts/GoogleSansFlex-latin.woff2',
  weight: '300 500',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-sans-flex',
});

/** Data, metadata, DICOM-style readouts. */
export const plexMono = localFont({
  src: '../../app/fonts/IBMPlexMono-Regular-latin.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-plex-mono',
});

export const CORRIDOR_FONT_CLASS = [sansFlex.variable, plexMono.variable].join(' ');
```

- [ ] **Step 6: Give Plex Sans Arabic its light weight**

In `apps/web/app/layout.tsx`, inside the `plex` declaration's `src` array, add as the first entry (above the Regular line):

```ts
    { path: './fonts/IBMPlexSansArabic-Light.woff2', weight: '300', style: 'normal' },
```

Application screens never request weight 300, so they never download this file.

- [ ] **Step 7: Replace the type tokens and heading rules**

In `apps/web/app/corridor.css`, inside the `.corridor { … }` rule, replace the block from `--leading-body: 1.55;` through `--f-mono: …;` with:

```css
  --leading-body: 1.2;
  --leading-display: 1.1;
  --w-body: 300;
  --margin: clamp(20px, 5vw, 120px);
  --content-max: 1440px;
  --measure: 68ch;
  --t-hero: calc(clamp(2.5rem, 1.6rem + 2.4vw, 3.75rem) * var(--script-scale));
  --t-h1: calc(clamp(2.5rem, 1.6rem + 2.4vw, 3.75rem) * var(--script-scale));
  --t-h2: calc(clamp(1.5rem, 1.2rem + 0.9vw, 2rem) * var(--script-scale));
  --t-h3: calc(clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem) * var(--script-scale));
  --t-body-l: calc(clamp(1rem, 0.95rem + 0.25vw, 1.125rem) * var(--script-scale));
  --t-body: calc(1rem * var(--script-scale));
  --t-meta: calc(0.875rem * var(--script-scale));
  --t-pill: calc(1.25rem * var(--script-scale));
  --f-display-latin: var(--font-sans-flex), var(--font-plex), 'Segoe UI', system-ui, sans-serif;
  --f-display-arabic: var(--font-plex), 'Noto Sans Arabic', sans-serif;
  --f-body: var(--font-sans-flex), var(--font-plex), system-ui, -apple-system, 'Segoe UI', Tahoma, 'Noto Sans Arabic', sans-serif;
  --f-mono: var(--font-plex-mono), var(--font-plex), ui-monospace, 'SFMono-Regular', monospace;
```

In the same rule, directly under `font-size: var(--t-body);`, add `font-weight: var(--w-body);`.

Replace the `.corridor[dir='rtl'] { … }` rule (lines ~165–170) with:

```css
.corridor[dir='rtl'] {
  --dir: -1;
  --script-scale: 1.08;
  /* The Latin 1.1 / 1.2 clip Arabic ascenders and descenders (spec §3.2). */
  --leading-display: 1.25;
  --leading-body: 1.5;
  --w-body: 400;
  --measure: 60ch;
}
```

Replace the three rules `.corridor :where(h1, h2, h3, h4) { … }`, `.corridor .display { … }` and `.corridor[dir='rtl'] .display, .corridor :lang(ar) .display { … }` with:

```css
.corridor :where(h1, h2, h3, h4) {
  color: var(--c-ink);
  font-weight: 300;
  line-height: var(--leading-display);
  text-wrap: balance;
  margin: 0;
}

.corridor .display {
  font-family: var(--f-display-latin);
  font-weight: 300;
  letter-spacing: -0.01em;
}

.corridor[dir='rtl'] .display,
.corridor :lang(ar) .display {
  font-family: var(--f-display-arabic);
  letter-spacing: normal;
  line-height: var(--leading-display);
}

/* The one kind of label above a heading this page allows (spec §4.1). */
.corridor .eyebrow {
  margin: 0;
  color: var(--c-accent);
  font-size: var(--t-meta);
  font-weight: 500;
  line-height: var(--leading-body);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.corridor[dir='rtl'] .eyebrow,
.corridor :lang(ar) .eyebrow {
  letter-spacing: normal;
  text-transform: none;
}
```

- [ ] **Step 8: Restyle buttons as pills and add chips**

In `apps/web/app/corridor.css`, replace the rules `.corridor .btn { … }`, `.corridor .btn--primary { … }`, `.corridor .btn--primary:hover { … }`, `.corridor .btn--ghost { … }` and `.corridor .btn--ghost:hover { … }` with:

```css
.corridor .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-block-size: 3rem;
  min-inline-size: 11.25rem;
  padding-inline: 2rem;
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  font-size: var(--t-pill);
  font-weight: 300;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-entrance),
    border-color var(--dur-fast) var(--ease-entrance),
    color var(--dur-fast) var(--ease-entrance);
}

.corridor .btn--primary {
  background-color: var(--c-accent);
  border-color: var(--c-accent-deep);
  color: var(--c-on-accent);
}

.corridor .btn--primary:hover {
  background-color: var(--c-accent-deep);
}

.corridor .btn--secondary {
  background-color: var(--c-lime);
  border-color: var(--c-lime-edge);
  color: var(--c-ink);
}

.corridor .btn--secondary:hover {
  background-color: var(--c-lime-edge);
}

.corridor .btn--ghost {
  background-color: transparent;
  border-color: var(--c-line);
  color: var(--c-ink);
}

.corridor .btn--ghost:hover {
  border-color: var(--c-ink-subtle);
}

.corridor .chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border: 1px solid var(--c-line);
  border-radius: var(--r-chip);
  background-color: var(--c-glass-soft);
  backdrop-filter: blur(var(--glass-blur));
  color: var(--c-ink);
  font-size: var(--t-meta);
  font-weight: 300;
  line-height: var(--leading-body);
}

@media (min-width: 1000px) {
  .corridor .chip {
    padding: 1rem 2rem;
    font-size: var(--t-body);
  }
}
```

- [ ] **Step 9: Update the fonts README**

In `apps/web/app/fonts/README.md`, change "All four families are **SIL Open Font License 1.1**. Full licence text for IBM Plex is in `LICENSE.txt`; Reem Kufi and Space Grotesk carry the same licence, reproduced at <https://openfontlicense.org>." to "All three families are **SIL Open Font License 1.1**. Full licence text for IBM Plex is in `LICENSE.txt`, and for Google Sans Flex in `GoogleSansFlex-OFL.txt`." Then replace the table with:

```markdown
| File | Family | Role | Bytes | Coverage |
|---|---|---|---|---|
| `IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.woff2` | IBM Plex Sans Arabic | Application + landing body, both scripts | ~72–76 KB each | full |
| `IBMPlexSansArabic-Light.woff2` | IBM Plex Sans Arabic | Arabic **display** (weight 300) — landing only; the app never requests 300 | ~75 KB | full |
| `GoogleSansFlex-latin.woff2` | Google Sans Flex (variable, wght 300–500) | Latin display + body — landing only | see `ls -la` | Latin subset |
| `IBMPlexMono-Regular-latin.woff2` | IBM Plex Mono | Data, metadata, DICOM-style readouts — landing only | 14.7 KB | Latin subset |
```

Fill the Google Sans Flex byte count from Step 4's `ls -la` output (e.g. `61.2 KB`).

- [ ] **Step 10: Verify nothing still names a retired face**

Run from `apps/web`: `grep -rnE "font-reem|font-grotesk|reemKufi|spaceGrotesk|ReemKufi|SpaceGrotesk" app components lib scripts`
Expected: no output.

- [ ] **Step 11: Run tests, type check, build**

Run: `pnpm --filter @mir/web exec vitest run lib/site/fonts.test.ts lib/site/tokens.test.ts`
Expected: PASS.

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build`
Expected: both exit 0.

- [ ] **Step 12: Commit**

```bash
git add apps/web/scripts/fetch-fonts.sh apps/web/app/fonts apps/web/components/corridor/fonts.ts apps/web/app/layout.tsx apps/web/app/corridor.css apps/web/lib/site/fonts.test.ts
git commit -m "$(cat <<'EOF'
feat(landing): Google Sans Flex and Plex Arabic Light, pill buttons, glass chips

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 3: Motion helpers and the curtain signal

**Files:**
- Create: `apps/web/lib/site/motion.ts`, `apps/web/lib/site/motion.test.ts`, `apps/web/lib/site/curtain.ts`, `apps/web/lib/site/curtain.test.ts`
- Modify: `apps/web/lib/site/split.ts` (append), `apps/web/lib/site/split.test.ts` (append), `apps/web/lib/site/use-gsap.ts:23-57`, `apps/web/components/corridor/scenes/S00Load.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Plans 2 and 3):
  - `motion.ts`: `type RevealVariant = 'display' | 'body' | 'eyebrow'`; `REVEAL: Record<RevealVariant, { blur: number; y: number }>`; `REVEAL_TIMING = { duration: 0.9, stagger: 0.04, maxSpread: 0.5, block: 0.8, blockBlur: 12, blockY: 20, start: 'top 85%' }`; `clamp01(n: number): number`; `wordStagger(count: number): number`; `trackTravel(trackWidth: number, viewportWidth: number): number`; `trackX(travel: number, sign: 1 | -1): number`; `litCount(progress: number, total: number): number`.
  - `curtain.ts`: `liftCurtain(): void`; `onCurtainLifted(fn: () => void): () => void`; `curtainLifted(): boolean`; `resetCurtainForTests(): void`.
  - `split.ts`: `splitWords(text: string): string[]`.
  - `use-gsap.ts`: `useGsapScope(enabled, ref, setup: (bundle, element) => void | (() => void), deps)` — a returned function runs when the scope reverts.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/site/motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REVEAL, REVEAL_TIMING, clamp01, litCount, trackTravel, trackX, wordStagger } from './motion';

describe('reveal presets (spec §3.3)', () => {
  it('lifts and blurs display text furthest', () => {
    expect(REVEAL.display).toEqual({ blur: 20, y: 60 });
    expect(REVEAL.body).toEqual({ blur: 12, y: 16 });
    expect(REVEAL.eyebrow).toEqual({ blur: 12, y: 12 });
  });

  it('staggers words 40 ms apart but never spreads a line over more than half a second', () => {
    expect(wordStagger(5)).toBeCloseTo(0.04);
    expect(wordStagger(40)).toBeCloseTo(REVEAL_TIMING.maxSpread / 39);
    expect(wordStagger(1)).toBeCloseTo(0.04);
    expect((wordStagger(40) * 39)).toBeLessThanOrEqual(REVEAL_TIMING.maxSpread + 1e-9);
  });
});

describe('clamp01', () => {
  it('pins values to the unit interval', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(3)).toBe(1);
  });
});

describe('horizontal track maths', () => {
  it('travels exactly the overflow, and never backwards', () => {
    expect(trackTravel(2063, 1440)).toBe(623);
    expect(trackTravel(900, 1440)).toBe(0);
  });

  it('moves toward the reader\'s forward in both directions (§3.6)', () => {
    expect(trackX(623, 1)).toBe(-623);
    expect(trackX(623, -1)).toBe(623);
    expect(trackX(0, 1)).toBe(0);
    expect(trackX(0, -1)).toBe(0);
  });
});

describe('scroll-lit words', () => {
  it('lights a share of the words proportional to progress', () => {
    expect(litCount(0, 10)).toBe(0);
    expect(litCount(0.5, 10)).toBe(5);
    expect(litCount(1, 10)).toBe(10);
    expect(litCount(1.4, 10)).toBe(10);
    expect(litCount(-1, 10)).toBe(0);
  });
});
```

Create `apps/web/lib/site/curtain.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { curtainLifted, liftCurtain, onCurtainLifted, resetCurtainForTests } from './curtain';

describe('the load curtain signal', () => {
  beforeEach(() => resetCurtainForTests());

  it('tells a waiting listener when the curtain lifts, once', () => {
    const fn = vi.fn();
    onCurtainLifted(fn);
    expect(fn).not.toHaveBeenCalled();
    liftCurtain();
    liftCurtain();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(curtainLifted()).toBe(true);
  });

  it('runs a listener that arrives late immediately', () => {
    liftCurtain();
    const fn = vi.fn();
    onCurtainLifted(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('lets a listener leave before the lift', () => {
    const fn = vi.fn();
    const off = onCurtainLifted(fn);
    off();
    liftCurtain();
    expect(fn).not.toHaveBeenCalled();
  });
});
```

Append to `apps/web/lib/site/split.test.ts` (keep the existing imports and add `splitWords` to the import from `./split`):

```ts
describe('splitWords', () => {
  it('keeps Arabic words whole', () => {
    expect(splitWords('نقل الصور الطبية عبر الحدود')).toEqual(['نقل', 'الصور', 'الطبية', 'عبر', 'الحدود']);
  });

  it('splits Latin on any run of whitespace and drops the empties', () => {
    expect(splitWords('  The study   arrives\nfirst. ')).toEqual(['The', 'study', 'arrives', 'first.']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @mir/web exec vitest run lib/site/motion.test.ts lib/site/curtain.test.ts lib/site/split.test.ts`
Expected: FAIL — `Cannot find module './motion'`, `Cannot find module './curtain'`, and `splitWords` is not exported.

- [ ] **Step 3: Implement `motion.ts`**

Create `apps/web/lib/site/motion.ts`:

```ts
/**
 * Motion numbers the landing page's primitives share — spec 2026-09-10 §3.3.
 *
 * Pure functions and constants only, so every value a reveal or a track uses
 * is testable without a browser.
 */

export type RevealVariant = 'display' | 'body' | 'eyebrow';

/** Starting blur (px) and lift (px) per text role. Every reveal ends at 0 / 0. */
export const REVEAL: Readonly<Record<RevealVariant, { blur: number; y: number }>> = {
  display: { blur: 20, y: 60 },
  body: { blur: 12, y: 16 },
  eyebrow: { blur: 12, y: 12 },
};

export const REVEAL_TIMING = {
  /** Per-word tween, seconds. */
  duration: 0.9,
  /** Delay between consecutive words, seconds. */
  stagger: 0.04,
  /** A line never takes longer than this to START all its words, seconds. */
  maxSpread: 0.5,
  /** Block-level BlurIn tween, seconds. */
  block: 0.8,
  blockBlur: 12,
  /** 1.25rem at the root size. */
  blockY: 20,
  /** ScrollTrigger start for everything below the hero. */
  start: 'top 85%',
} as const;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Per-word stagger for a line of `count` words, capped so the spread ≤ maxSpread. */
export function wordStagger(count: number): number {
  if (count <= 1) return REVEAL_TIMING.stagger;
  return Math.min(REVEAL_TIMING.stagger, REVEAL_TIMING.maxSpread / (count - 1));
}

/** How far a horizontal track must travel to show its last card. Never negative. */
export function trackTravel(trackWidth: number, viewportWidth: number): number {
  return Math.max(0, Math.round(trackWidth - viewportWidth));
}

/**
 * The track's x at full travel: toward the reader's "forward" — leftward in
 * LTR, rightward in RTL (§3.6). Zero is returned as +0, never -0.
 */
export function trackX(travel: number, sign: 1 | -1): number {
  return travel === 0 ? 0 : -travel * sign;
}

/** How many words of a scroll-lit paragraph are lit at `progress`. */
export function litCount(progress: number, total: number): number {
  return Math.round(clamp01(progress) * total);
}
```

- [ ] **Step 4: Implement `curtain.ts`**

Create `apps/web/lib/site/curtain.ts`:

```ts
/**
 * "The load curtain has lifted" — a one-shot signal, spec 2026-09-10 §4.4.
 *
 * The hero's entrance waits for it so the reveal is not spent under the
 * curtain. `S00Load` lifts it on every animating tier: at once for a repeat
 * visit, or when the curtain finishes. Tier C never waits on it, because Tier C
 * never animates.
 */

let lifted = false;
const listeners = new Set<() => void>();

export function liftCurtain(): void {
  if (lifted) return;
  lifted = true;
  for (const listener of listeners) listener();
  listeners.clear();
}

/** Run `fn` when the curtain lifts — immediately if it already has. Returns an unsubscribe. */
export function onCurtainLifted(fn: () => void): () => void {
  if (lifted) {
    fn();
    return () => {};
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function curtainLifted(): boolean {
  return lifted;
}

/** Module state survives between test cases; this is the reset. */
export function resetCurtainForTests(): void {
  lifted = false;
  listeners.clear();
}
```

- [ ] **Step 5: Add `splitWords`**

Append to `apps/web/lib/site/split.ts`:

```ts
/**
 * Whitespace-separated words, for effects that address whole words in every
 * script — WordReveal and ScrollLitText. A word is always one text run, so an
 * Arabic word keeps its joined forms (see the note at the top of this file).
 */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== '');
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @mir/web exec vitest run lib/site/motion.test.ts lib/site/curtain.test.ts lib/site/split.test.ts`
Expected: PASS.

- [ ] **Step 7: Let a GSAP scope return its own cleanup**

In `apps/web/lib/site/use-gsap.ts`, change the `setup` parameter type in `useGsapScope`'s signature from

```ts
  setup: (bundle: GsapBundle, element: HTMLElement) => void,
```
to
```ts
  /**
   * May return a function; `gsap.context()` calls it on revert. Use it for
   * anything the context cannot see — a listener registered outside GSAP.
   */
  setup: (bundle: GsapBundle, element: HTMLElement) => void | (() => void),
```

No other change is needed: the context function is `() => setup(bundle, element)`, which already returns whatever `setup` returns, and `gsap.context()` runs a returned function on `revert()`.

- [ ] **Step 8: Lift the curtain from `S00Load`**

In `apps/web/components/corridor/scenes/S00Load.tsx`:

1. Add the import: `import { liftCurtain } from '../../../lib/site/curtain';`
2. In the effect, directly after the session-storage read, replace

```ts
    if (seen) return;
```
with
```ts
    if (seen) {
      // A repeat visit shows no curtain, so nothing should wait for one.
      liftCurtain();
      return;
    }
```
3. Change `finish` to

```ts
    const finish = (): void => {
      setState('done');
      liftCurtain();
      cue('scene');
    };
```

Leave the Tier C early return (`if (!budget.expressive && budget.planes === 0) return;`) as it is: the first effect pass always runs at Tier C before detection promotes, and lifting there would release the hero's entrance under a curtain that is about to appear.

- [ ] **Step 9: Type check and run all web unit tests**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web exec vitest run`
Expected: exit 0; all PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/site/motion.ts apps/web/lib/site/motion.test.ts apps/web/lib/site/curtain.ts apps/web/lib/site/curtain.test.ts apps/web/lib/site/split.ts apps/web/lib/site/split.test.ts apps/web/lib/site/use-gsap.ts apps/web/components/corridor/scenes/S00Load.tsx
git commit -m "$(cat <<'EOF'
feat(landing): shared motion maths and a curtain-lifted signal

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 4: Retire the dark-room effects

**Files:**
- Delete: `apps/web/components/corridor/motion/CursorLight.tsx`, `apps/web/components/corridor/motion/WebGLHandoff.tsx`, `apps/web/components/corridor/motion/webgl-handoff.ts`, `apps/web/public/grain.png`, `apps/web/scripts/render-grain.mjs`
- Modify: `apps/web/components/corridor/Corridor.tsx`, `apps/web/components/corridor/primitives/Plate.tsx`, `apps/web/components/corridor/scenes/S01Hero.tsx:44-53`, `apps/web/lib/site/tier.ts:184-202`, `apps/web/lib/site/tier.test.ts:95-119`, `apps/web/app/corridor.css`, `apps/web/Dockerfile:122-123`, `docs/landing-page-status.md`

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: `TierBudget` without `atmospherics` (fields now `sequence`, `planes`, `expressive`, `interactiveDemo`). `Plate` loses its `scanline` prop.

- [ ] **Step 1: Update the tier test first**

In `apps/web/lib/site/tier.test.ts`, replace the `'gives Tier C no sequence, no planes, and no atmospherics'` test with:

```ts
  it('gives Tier C no sequence, no planes, and nothing expressive', () => {
    // Tier C is the HTML response. If it ever grows a moving part, the "ship
    // Tier C first" guarantee (§8.2 technique 1) is gone.
    expect(TIER_BUDGET.C).toEqual({
      sequence: null,
      planes: 0,
      expressive: false,
      interactiveDemo: false,
    });
  });
```

and delete the whole `'reserves the atmospherics for Tier A alone'` test.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @mir/web exec vitest run lib/site/tier.test.ts`
Expected: FAIL — the received object still has `atmospherics: false`.

- [ ] **Step 3: Drop `atmospherics` from the budget**

In `apps/web/lib/site/tier.ts`, delete these two lines from `interface TierBudget`:

```ts
  /** Cursor-following light and the WebGL scene handoff. */
  atmospherics: boolean;
```

and replace `TIER_BUDGET` with:

```ts
export const TIER_BUDGET: Record<Tier, TierBudget> = {
  A: { sequence: 'a', planes: 5, expressive: true, interactiveDemo: true },
  B: { sequence: 'b', planes: 2, expressive: true, interactiveDemo: true },
  C: { sequence: null, planes: 0, expressive: false, interactiveDemo: false },
};
```

In the header comment of the same file, change "Tier A adds the full sequence, five planes, the cursor light, the WebGL handoff, sound and haptics." to "Tier A adds the full helix, five planes, sound and haptics."

- [ ] **Step 4: Delete the effect components and their assets**

```bash
git rm apps/web/components/corridor/motion/CursorLight.tsx apps/web/components/corridor/motion/WebGLHandoff.tsx apps/web/components/corridor/motion/webgl-handoff.ts apps/web/public/grain.png apps/web/scripts/render-grain.mjs
```

- [ ] **Step 5: Remove them from the composition**

In `apps/web/components/corridor/Corridor.tsx`: delete the imports `import { CursorLight } from './motion/CursorLight';` and `import { WebGLHandoff } from './motion/WebGLHandoff';`, and delete these three lines from the JSX:

```tsx
        <span className="grain" aria-hidden="true" />
        <CursorLight />
        <WebGLHandoff />
```

- [ ] **Step 6: Remove the scanline option from `Plate`**

In `apps/web/components/corridor/primitives/Plate.tsx`, delete the `scanline = false,` destructured parameter, the `scanline?: boolean;` type member (and its doc comment), and the line `if (scanline) classes.push('scanline');`.

In `apps/web/components/corridor/scenes/S01Hero.tsx`, delete the `scanline` attribute line from the `<Plate …>` element.

- [ ] **Step 7: Delete their CSS and turn the curtain mint**

In `apps/web/app/corridor.css`, delete these rules entirely (each with any comment block directly above it): `.corridor .grain { … }`, `.corridor .scanline::after { … }`, `.corridor .bloom { … }`, `.corridor .cursor-light { … }`, `.corridor .handoff-canvas { … }`.

In the `.corridor .loader { … }` rule, change `background-color: var(--c-ground);` to `background-color: var(--c-panel);`.

- [ ] **Step 8: Confirm nothing references them**

Run from `apps/web`: `grep -rnE "CursorLight|WebGLHandoff|webgl-handoff|atmospherics|grain\.png|render-grain|scanline|\.bloom|cursor-light|handoff-canvas" app components lib scripts e2e Dockerfile`
Expected: only the Dockerfile comment line (fixed next) and documentation comments mentioning history, if any; no code references.

- [ ] **Step 9: Fix the Dockerfile comment**

In `apps/web/Dockerfile`, change the comment lines

```
#   /seq /map /grain the landing page's hero sequence, poster, corridor map and
#                    grain tile. The hero would have rendered as an empty plate.
```
to
```
#   /seq /map /helix the landing page's consent thumbnails and viewer poster,
#                    corridor map, and helix posters. The hero would have
#                    rendered with no helix.
```

(`/helix` arrives in Plan 2; the comment describes the image that ships.)

- [ ] **Step 10: Update the status doc**

In `docs/landing-page-status.md`:
1. In the §2 tree, change the `motion/` line to `│   ├── motion/                   ScrubCanvas, FocalReveal, WindowingWipe,` / `│   │                             HeadlineReveal` (drop `CursorLight, WebGLHandoff`), and in the `scripts/` line drop `render-grain,`.
2. In the §2 deviations table, delete the `3.4 | Grain tile 128×128 …` row and the `6.1 | React Three Fiber + drei for the handoff …` row, and add this row at the end of the table:

```markdown
| 2–3 | Dark reading room: void ground, phosphor accents, grain, cursor light, WebGL caustic | Light clinical register (spec 2026-09-10) | The owner re-directed the page to a light mint/teal/lime register built around a particle helix. The grain tile, the cursor light and the phosphor handoff pass were dark-room effects — on white they read as dirt — and are removed with their assets. The palette's contrast is now asserted by `lib/site/tokens.test.ts`. |
```
3. In §6, delete the line `node apps/web/scripts/render-grain.mjs                  # §3.4 grain tile`, and change the `fetch-fonts.sh` comment to `# re-download the vendored landing faces + OFL`.

- [ ] **Step 11: Run everything that can see the change**

Run: `pnpm --filter @mir/web exec vitest run && pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build`
Expected: all PASS / exit 0.

Run: `pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts e2e/public-surface.spec.ts --project=chromium`
Expected: PASS (the page is recoloured; no scene structure changed).

- [ ] **Step 12: Commit**

```bash
git add -A apps/web/components/corridor apps/web/lib/site/tier.ts apps/web/lib/site/tier.test.ts apps/web/app/corridor.css apps/web/Dockerfile docs/landing-page-status.md
git commit -m "$(cat <<'EOF'
refactor(landing): retire grain, cursor light and the phosphor handoff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

## Done when

- `pnpm --filter @mir/web exec vitest run`, `typecheck`, `build` and the two landing e2e specs pass.
- The landing page renders on a white ground with mint-free scenes (panels arrive in Plan 3), black light-weight type in Google Sans Flex (fr/en) and Plex Sans Arabic Light (ar display), teal/lime pill buttons, and no grain, cursor glow or caustic.
- `grep -rnE "\-\-c-(void|bone|phosphor|sand|clay)" apps/web` finds nothing.
