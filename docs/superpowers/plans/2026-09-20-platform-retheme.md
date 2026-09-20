# Platform Re-theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the signed-in MIR application and the public non-landing surface to the landing page's teal/mint/lime register, keeping clinical density and dark mode.

**Architecture:** The app's screens contain zero hard-coded colours — every one renders through semantic tokens in `app/globals.css`. So the palette is re-pointed **in place**: token names and the `@theme inline` mapping are unchanged, only values move. That carries all 15 route groups with no screen edits. Four further tasks cover what values cannot express: the display typeface, the lime CTA, the nav active state, and a per-route visual sweep.

**Tech Stack:** Next.js (App Router), Tailwind v4 (`@theme inline`), CSS custom properties, `next/font/local`, vitest (node environment, source-text assertions — there is no `@testing-library` here).

**Spec:** `docs/superpowers/specs/2026-09-20-platform-retheme-design.md`

## Global Constraints

- **Never use a physical-direction Tailwind utility.** Use `ps-*`/`pe-*`, `ms-*`/`me-*`, `start-*`/`end-*`, `text-start`, `border-s`, `rounded-s`. Enforced by `no-restricted-syntax` in `eslint.config.mjs`, not by discipline. Every class added by this plan must obey it.
- **`app/corridor.css` and everything under `components/corridor/` are OFF LIMITS** — except the one re-export in Task 2. The landing page is being edited concurrently; touching it causes conflicts.
- **Google Sans Flex is `weight: '300 500'`.** Any element carrying `font-display` must also carry an in-range weight. `font-semibold` (600) and `font-bold` (700) are outside it and the browser will synthesize a fake bold. This is the single most likely way to make this work look broken.
- **Density does not change.** No padding, font-size, or line-height increases on tables, forms, or list rows.
- **The dark palette is declared twice** — under `@media (prefers-color-scheme: dark)` on `:root:not([data-theme='light'])`, and on `:root[data-theme='dark']`. Both must receive identical declarations or `lib/theme/tokens.test.ts` fails.
- **Every new `:root` colour token needs a value in all three blocks** (light + both dark), or `tokens.test.ts` fails its "overrides every colour" assertion.
- Commands, all run from `apps/web/`: `pnpm test` (vitest), `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Corrections to the spec, applied by this plan

Reading the actual components turned up two errors in the design doc. This plan implements the corrected version; Task 6 updates the spec to match.

1. **`SectionHeading` does NOT get the display font.** The spec §5 lists it. It is `text-sm font-semibold uppercase tracking-wide text-muted-foreground` — a 14px uppercase micro-label. A 300-weight display face at that size is illegible and contradicts D1's "readable weights at small sizes".
2. **Every display target needs its weight repaired.** `PageHeader`'s h1 is `font-bold` (700), `CardTitle` is `font-semibold` (600), the `StatTile` numeral is `font-bold` (700) — all outside Sans Flex's 300–500 range. Each changes to an in-range weight as part of applying the font.

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/app/globals.css` | **Modify.** The three palette blocks, `--radius`, `@theme inline` additions for `--color-highlight*` and `--font-display`. |
| `apps/web/lib/theme/read-palette.ts` | **Create.** Brace-matched CSS block parser, exported so the contrast test needs no copy of its own. |
| `apps/web/lib/theme/contrast.test.ts` | **Create.** WCAG AA assertion over 22 pairs in both themes. |
| `apps/web/lib/fonts.ts` | **Create.** The `sansFlex` declaration, moved out of the corridor module so the app can load it. |
| `apps/web/lib/theme/display-font.test.ts` | **Create.** Guards the 300–500 weight rule against future edits. |
| `apps/web/components/corridor/fonts.ts` | **Modify.** Re-export `sansFlex`; `CORRIDOR_FONT_CLASS` unchanged. |
| `apps/web/app/layout.tsx` | **Modify.** Apply `sansFlex.variable` on the root element. |
| `apps/web/lib/site/fonts.test.ts` | **Modify.** One line: add `lib/fonts.ts` to the scan list. |
| `apps/web/components/ui/button.tsx` | **Modify.** `highlight` variant. |
| `apps/web/components/ui/index.tsx` | **Modify.** `cta` variant on the compat `Button`; display font on `PageHeader`. |
| `apps/web/components/ui/card.tsx` | **Modify.** Display font on `CardTitle`. |
| `apps/web/components/ui/stat.tsx` | **Modify.** Display font on the `StatTile` numeral. |
| `apps/web/components/shell/AppChrome.tsx`, `PublicChrome.tsx` | **Modify.** Nav active state. |
| `docs/decisions.md`, the spec | **Modify.** Record D1–D5; correct §5. |

`lib/theme/tokens.test.ts` appears nowhere above. It is the guard proving the two dark blocks agree, and this plan deliberately does not touch it.

---

### Task 1: Palette re-point, radius, and the contrast guard

The whole visible change lands here. Everything after this is refinement.

**Files:**
- Create: `apps/web/lib/theme/read-palette.ts`
- Create: `apps/web/lib/theme/contrast.test.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: `readPalette(selector: string): Map<string, string>` from `lib/theme/read-palette.ts`. Tokens `--highlight`, `--highlight-edge`, `--highlight-foreground` and the utilities `bg-highlight`, `border-highlight-edge`, `text-highlight-foreground` — Task 4 depends on these existing.

- [ ] **Step 1: Create the palette parser**

Create `apps/web/lib/theme/read-palette.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing contrast test**

Create `apps/web/lib/theme/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readPalette } from './read-palette';

/**
 * The palette as an accessibility assertion — WCAG 2.2 AA.
 *
 * `tokens.test.ts` proves the palette is STRUCTURALLY complete: every light
 * token has a dark answer, and the two dark blocks agree. It says nothing
 * about whether the colours can be read. This does.
 *
 * 4.5:1 is the floor for text (SC 1.4.3). 3:1 is the floor for the boundary
 * of a control and for focus indicators (SC 1.4.11) — the rule the palette
 * before 2026-09-20 broke, with `--input` at 1.56:1.
 */

const LIGHT = readPalette(':root {');
const DARK = readPalette(":root[data-theme='dark']");

function channels(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex?.[1] === undefined) throw new Error(`not a 6-digit hex colour: ${value}`);
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(value: string): number {
  const [r, g, b] = channels(value).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(palette: Map<string, string>, fg: string, bg: string): number {
  const a = palette.get(fg);
  const b = palette.get(bg);
  if (a === undefined) throw new Error(`missing token: ${fg}`);
  if (b === undefined) throw new Error(`missing token: ${bg}`);
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum, what a failure would look like on screen] */
const PAIRS: ReadonlyArray<readonly [string, string, number, string]> = [
  ['--foreground', '--background', 4.5, 'body text on the page'],
  ['--foreground', '--card', 4.5, 'body text on a card'],
  ['--foreground', '--sidebar', 4.5, 'nav text on the sidebar'],
  ['--card-foreground', '--card', 4.5, 'card body text'],
  ['--muted-foreground', '--card', 4.5, 'secondary text on a card'],
  ['--muted-foreground', '--background', 4.5, 'secondary text on the page'],
  ['--muted-foreground', '--muted', 4.5, 'secondary text on a muted surface'],
  ['--primary-foreground', '--primary', 4.5, 'a primary button label'],
  ['--primary', '--card', 4.5, 'a link on a card'],
  ['--primary', '--background', 4.5, 'a link on the page'],
  ['--secondary-foreground', '--secondary', 4.5, 'a secondary button label'],
  ['--accent-foreground', '--accent', 4.5, 'accent text'],
  ['--destructive-foreground', '--destructive', 4.5, 'a destructive button label'],
  ['--success', '--success-surface', 4.5, 'a success badge'],
  ['--warning', '--warning-surface', 4.5, 'a warning badge'],
  ['--danger', '--danger-surface', 4.5, 'a danger badge'],
  ['--info', '--info-surface', 4.5, 'an info badge'],
  ['--highlight-foreground', '--highlight', 4.5, 'the CTA label on lime'],
  ['--input', '--card', 3, 'the border of a text input on a card'],
  ['--input', '--background', 3, 'the border of a text input on the page'],
  ['--ring', '--card', 3, 'the focus ring on a card'],
  ['--ring', '--background', 3, 'the focus ring on the page'],
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('the %s palette meets WCAG 2.2 AA', (_name, palette) => {
  it.each(PAIRS)('%s on %s clears %s:1 — %s', (fg, bg, min, what) => {
    const actual = ratio(palette, fg, bg);
    expect(actual, `${what}: ${fg} on ${bg} is ${actual.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails for the right reason**

Run: `cd apps/web && pnpm test lib/theme/contrast.test.ts`

Expected: FAIL. The two `--input` cases report roughly `1.56:1` (light) and `1.74:1` (dark) against a minimum of 3, and the `--highlight*` case throws `missing token` because those tokens do not exist yet. **If the `--input` cases PASS, stop** — the file being parsed is not the one you think it is.

- [ ] **Step 4: Rewrite the light palette**

In `apps/web/app/globals.css`, replace the values in the `:root {` block as below, add the three `--highlight*` tokens, and change `--radius` to `0.875rem`. Leave the surrounding comments in place for now; Task 6 repairs their prose.

```css
:root {
  --background: #eff4f2;
  --foreground: #0e1a17;
  --card: #ffffff;
  --card-foreground: #0e1a17;
  --muted: #e5edea;
  --muted-foreground: #4a5f59;
  --border: #d5e0dc;
  --input: #828e8a;

  --primary: #246f65;
  --primary-foreground: #ffffff;
  --secondary: #e5f1ed;
  --secondary-foreground: #054038;
  --accent: #eaf3f0;
  --accent-foreground: #1a5d54;
  --ring: #246f65;

  --destructive: #b3261e;
  --destructive-foreground: #ffffff;

  --success: #14663f;
  --success-surface: #e2f2e9;
  --warning: #7a4b00;
  --warning-surface: #fbf0dc;
  --danger: #b3261e;
  --danger-surface: #fbe9e7;
  --info: #1a5d54;
  --info-surface: #e4f0ed;

  --sidebar: #f8fbfa;
  --sidebar-foreground: #0e1a17;

  /* The landing page's lime, as the single per-screen call to action. It is a
     BACKGROUND, so it carries its own dark foreground rather than borrowing
     --foreground. Never a status colour: status stays with success/warning/
     danger/info, which a colour-blind reader can still tell apart. */
  --highlight: #f8ffb4;
  --highlight-edge: #e5ed9b;
  --highlight-foreground: #2a3d00;

  --marketing-from: #e5f1ed;
  --marketing-to: #eff4f2;
  --marketing-ink: #054038;

  --radius: 0.875rem;
}
```

- [ ] **Step 5: Rewrite both dark blocks — identically**

Apply this same body inside BOTH `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { … } }` and `:root[data-theme='dark'] { … }`. They must match or `tokens.test.ts` fails.

```css
  --background: #0c1412;
  --foreground: #e9f1ee;
  --card: #14201d;
  --card-foreground: #e9f1ee;
  --muted: #1a2724;
  --muted-foreground: #9bb3ac;
  --border: #26332f;
  --input: #5f6b67;

  --primary: #5fb3a3;
  --primary-foreground: #04211c;
  --secondary: #1e2e2a;
  --secondary-foreground: #cfe6df;
  --accent: #182823;
  --accent-foreground: #8fd3c4;
  --ring: #5fb3a3;

  --destructive: #f4a49c;
  --destructive-foreground: #3d0f0b;

  --success: #8fd6aa;
  --success-surface: #0f2e1c;
  --warning: #f2cd93;
  --warning-surface: #362810;
  --danger: #f4a49c;
  --danger-surface: #3a1511;
  --info: #8fd3c4;
  --info-surface: #0f2b26;

  --sidebar: #101a17;
  --sidebar-foreground: #e9f1ee;

  --highlight: #e8f59b;
  --highlight-edge: #cbd97e;
  --highlight-foreground: #22300a;

  --marketing-from: #12241f;
  --marketing-to: #0c1412;
  --marketing-ink: #d9ece6;
```

`--radius` is NOT repeated in the dark blocks — it is not a colour, `tokens.test.ts` only requires colour parity, and this matches how the file already treats it.

- [ ] **Step 6: Map the three new tokens into `@theme inline`**

In the `@theme inline` block, after `--color-sidebar-foreground`:

```css
  --color-highlight: var(--highlight);
  --color-highlight-edge: var(--highlight-edge);
  --color-highlight-foreground: var(--highlight-foreground);
```

Without this, `bg-highlight` in Task 4 silently produces no CSS.

- [ ] **Step 7: Run the full suite**

Run: `cd apps/web && pnpm test`

Expected: PASS, including `lib/theme/tokens.test.ts` (unchanged) and all 44 contrast cases. If `tokens.test.ts` reports a drifted property, the two dark blocks are not identical — diff them.

- [ ] **Step 8: Typecheck, lint, build**

Run: `cd apps/web && pnpm typecheck && pnpm lint && pnpm build`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/globals.css apps/web/lib/theme/read-palette.ts apps/web/lib/theme/contrast.test.ts
git commit -m "feat(theme): re-point the application palette to the corridor register

Teal accent, mint surfaces and the landing page's lime, with a dark
counterpart derived from the same family. Token names and the @theme
mapping are unchanged, so every screen follows without an edit.

Adds a contrast test over 22 pairs in both themes. It fails on the old
--input, which was 1.56:1 against the 3:1 WCAG 2.2 SC 1.4.11 wants for
the boundary of a control; the new value clears it at 3.40:1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Load the display typeface app-wide

**Files:**
- Create: `apps/web/lib/fonts.ts`
- Create: `apps/web/lib/theme/display-font.test.ts`
- Modify: `apps/web/components/corridor/fonts.ts` (the `sansFlex` declaration, ~lines 28-37)
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/lib/site/fonts.test.ts` (the `referenced` array, ~lines 16-19)
- Modify: `apps/web/app/globals.css` (`@theme inline`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `sansFlex` (a `next/font/local` object exposing `.variable`) from `lib/fonts.ts`; the `--font-display` token and its `font-display` Tailwind utility. Task 3 depends on both.

- [ ] **Step 1: Move the `sansFlex` declaration to a neutral module**

Create `apps/web/lib/fonts.ts`:

```ts
import localFont from 'next/font/local';

/**
 * Faces the whole application loads.
 *
 * `sansFlex` lived in `components/corridor/fonts.ts` while it was the landing
 * page's face alone. The application now uses it for display headings, so it
 * moves here and the corridor module re-exports it — one declaration, one
 * network request, whichever surface asks first.
 *
 * Its siblings stay landing-only. `plexArabicLight` in particular is the
 * Arabic DISPLAY weight (300), and the application has no weight-300 Arabic:
 * Arabic headings fall through to `--font-plex` at their normal weights.
 * `lib/site/fonts.test.ts` asserts that, so this file must not import it.
 *
 * WEIGHT RANGE IS LOAD-BEARING: this face carries 300-500 only. An element
 * pairing `font-display` with `font-semibold` (600) or `font-bold` (700) gets
 * a SYNTHESIZED bold, which is why `lib/theme/display-font.test.ts` exists.
 */
export const sansFlex = localFont({
  src: '../app/fonts/GoogleSansFlex-latin.woff2',
  weight: '300 500',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  variable: '--font-sans-flex',
});
```

- [ ] **Step 2: Re-export from the corridor module**

In `apps/web/components/corridor/fonts.ts`, delete the local `export const sansFlex = localFont({…})` block and put this in its place. Leave `plexMono`, `plexArabicLight` and `CORRIDOR_FONT_CLASS` exactly as they are — the latter still references `sansFlex.variable` and keeps working.

```ts
// The Latin display and body face is now shared with the application; it lives
// in lib/fonts.ts so app/layout.tsx can load it too. Re-exported so this module
// stays the one place the landing page asks for its faces.
export { sansFlex } from '../../lib/fonts';
```

- [ ] **Step 3: Run the font test and watch it fail**

Run: `cd apps/web && pnpm test lib/site/fonts.test.ts`

Expected: FAIL on `ships no face that nothing loads`, naming `GoogleSansFlex-latin.woff2`. That test builds its list by scanning only `components/corridor/fonts.ts` and `app/layout.tsx`; the declaration now sits in a third file it does not read. The face IS loaded — the scan list is what is stale.

- [ ] **Step 4: Extend the scan list by one file**

In `apps/web/lib/site/fonts.test.ts`, change the `referenced` array. This preserves the assertion's intent exactly — it still catches a face shipped that nothing loads.

```ts
const referenced = [
  ...read('components/corridor/fonts.ts').matchAll(/app\/fonts\/([\w.-]+\.woff2)/g),
  ...read('lib/fonts.ts').matchAll(/app\/fonts\/([\w.-]+\.woff2)/g),
  ...read('app/layout.tsx').matchAll(/\.\/fonts\/([\w.-]+\.woff2)/g),
].map((match) => match[1] ?? '');
```

Do NOT touch the `declares Arabic display Light 300 on the landing page only` assertion. It is still true and still valuable.

- [ ] **Step 5: Run it and confirm green**

Run: `cd apps/web && pnpm test lib/site/fonts.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Apply the variable in the root layout**

In `apps/web/app/layout.tsx`, import `sansFlex` from `../lib/fonts` and add `sansFlex.variable` to the `className` of whichever element already carries the Plex variable. Add no `IBMPlexSansArabic-Light` reference — a test forbids it.

- [ ] **Step 7: Add the `--font-display` token**

In the `@theme inline` block of `apps/web/app/globals.css`, below `--font-sans`:

```css
  /*
   * Display headings — the landing page's face, at the landing page's weight.
   *
   * Latin only: Google Sans Flex carries no Arabic, so Arabic headings fall
   * through to --font-plex at their normal weights. That is the accepted limit
   * of D3, not a bug; the application loads no weight-300 Arabic.
   *
   * Anything wearing this must sit in the 300-500 range — see
   * lib/theme/display-font.test.ts.
   */
  --font-display:
    var(--font-sans-flex), var(--font-plex), system-ui, -apple-system, 'Segoe UI',
    'Noto Sans Arabic', sans-serif;
```

- [ ] **Step 8: Write the weight-range guard**

Create `apps/web/lib/theme/display-font.test.ts`:

```ts
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
```

- [ ] **Step 9: Run the full suite, typecheck, lint, build**

Run: `cd apps/web && pnpm test && pnpm typecheck && pnpm lint && pnpm build`

Expected: all PASS. `display-font.test.ts` passes trivially for now — nothing uses `font-display` yet. It lands *before* Task 3 so that Task 3's mistakes are caught the moment they are made.

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/fonts.ts apps/web/lib/theme/display-font.test.ts apps/web/components/corridor/fonts.ts apps/web/app/layout.tsx apps/web/lib/site/fonts.test.ts apps/web/app/globals.css
git commit -m "feat(theme): load the landing page's display face app-wide

sansFlex moves to lib/fonts.ts and the corridor module re-exports it, so
one declaration serves both surfaces. Adds --font-display.

The Arabic display weight stays landing-only: the application has no
weight-300 Arabic, and fonts.test.ts still asserts that. Its scan list
gains lib/fonts.ts so it keeps catching orphaned faces.

Adds a guard for the face's 300-500 range: font-display beside font-bold
would be a synthesized bold on the largest text on the page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Display headings on the three surfaces that earn them

**Files:**
- Modify: `apps/web/components/ui/index.tsx` (the `h1` in `PageHeader`, ~line 279)
- Modify: `apps/web/components/ui/card.tsx` (`CardTitle`, ~line 25)
- Modify: `apps/web/components/ui/stat.tsx` (the `StatTile` numeral, ~line 38)

**Interfaces:**
- Consumes: the `font-display` utility from Task 2.
- Produces: no new exports. Visual only.

`SectionHeading` is deliberately excluded — see "Corrections to the spec".

- [ ] **Step 1: `PageHeader` — the page title**

In `apps/web/components/ui/index.tsx`, the `h1` inside `PageHeader` becomes:

```tsx
        <h1 className="font-display text-2xl font-normal tracking-tight">{title}</h1>
```

Was `text-2xl font-bold tracking-tight`. `font-bold` becomes `font-normal` (400) because 700 is outside the face's range. The display face at 400 reads heavier than Plex at 400, so the title keeps its presence.

- [ ] **Step 2: `CardTitle`**

In `apps/web/components/ui/card.tsx`:

```tsx
    <h2 className={cn('font-display text-base font-medium leading-snug', className)} {...props} />
```

Was `text-base font-semibold leading-snug`. `font-medium` is 500 — the top of the face's range and the closest in-range weight to the 600 it replaces.

- [ ] **Step 3: `StatTile` — the numeral**

In `apps/web/components/ui/stat.tsx`:

```tsx
        <p className="font-display text-3xl font-medium leading-none tabular-nums">{value}</p>
```

Was `text-3xl font-bold leading-none tabular-nums`. **`tabular-nums` must stay** — dashboard counts change under the reader and must not reflow. The file's comment about the numeral wearing text ink and never a status colour still holds; do not touch it.

- [ ] **Step 4: Run the weight guard**

Run: `cd apps/web && pnpm test lib/theme/display-font.test.ts`

Expected: PASS. A failure names the file and prints the offending line — it means one of the three edits kept its old weight class.

- [ ] **Step 5: Run the full suite, typecheck, lint, build**

Run: `cd apps/web && pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ui/index.tsx apps/web/components/ui/card.tsx apps/web/components/ui/stat.tsx
git commit -m "feat(ui): display face on page titles, card titles and stat figures

Each one also drops to a weight the face actually carries: 700 and 600
would be synthesized from a 300-500 variable.

SectionHeading is left alone on purpose. It is a 14px uppercase label,
and the display face at that size is thinner than it is legible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The lime call to action

**Files:**
- Modify: `apps/web/components/ui/button.tsx` (the `variant` map in `buttonVariants`, ~lines 16-22)
- Modify: `apps/web/components/ui/index.tsx` (the compatibility `Button`, ~lines 52-79)

**Interfaces:**
- Consumes: `--color-highlight`, `--color-highlight-edge`, `--color-highlight-foreground` from Task 1.
- Produces: `<Button variant="cta">`, backed by `buttonVariants({ variant: 'highlight' })`.

There are two button layers — the `cva` in `button.tsx` and a compatibility wrapper in `index.tsx` with its own variant union. Both need the variant or pages cannot reach it.

- [ ] **Step 1: Add the base variant**

In `apps/web/components/ui/button.tsx`, inside `variants.variant`, after `default`:

```ts
        highlight:
          'border border-highlight-edge bg-highlight text-highlight-foreground shadow-sm hover:bg-highlight-edge',
```

The border keeps the lime from dissolving into a white card. Hover deepens to the edge tone rather than going translucent, because lime at reduced opacity over a mint surface turns muddy.

- [ ] **Step 2: Expose it through the compatibility wrapper**

In `apps/web/components/ui/index.tsx`, widen the union and add the mapping:

```tsx
export function Button({
  variant = 'default',
  size,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'cta';
  size?: 'sm';
}): React.JSX.Element {
  const mapped =
    variant === 'primary'
      ? 'default'
      : variant === 'cta'
        ? 'highlight'
        : variant === 'danger'
          ? 'destructive'
          : variant === 'ghost'
            ? 'ghost'
            : 'outline';
```

Leave the rest of the function — the `type="button"` default and its comment — untouched. Named `cta` at the call site so its rule is legible where it is used: **one per screen, the primary action.**

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS. A typo in the union surfaces here.

- [ ] **Step 4: Run the full suite, lint, build**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/button.tsx apps/web/components/ui/index.tsx
git commit -m "feat(ui): lime call-to-action button variant

The landing page's signature colour, reachable as variant=cta. One per
screen, the primary action only: it is not a status colour, and status
stays with success/warning/danger/info, which a colour-blind reader can
still tell apart.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Nav active state

**Files:**
- Modify: `apps/web/components/shell/AppChrome.tsx`
- Modify: `apps/web/components/shell/PublicChrome.tsx`

**Interfaces:**
- Consumes: the palette from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Locate the active-link branch in both files**

Run: `cd apps/web && grep -n "aria-current\|isActive\|active\|bg-muted\|bg-accent\|text-primary" components/shell/AppChrome.tsx components/shell/PublicChrome.tsx`

Note the exact classes on both the active and inactive branches before editing.

- [ ] **Step 2: Move the active state to teal-on-mint**

For the active nav item in both files, use:

```tsx
'bg-secondary text-secondary-foreground'
```

Leave the inactive branch as it is. `--secondary` is the deep mint (`#e5f1ed` light, `#1e2e2a` dark) and `--secondary-foreground` the deep teal (`#054038`, `#cfe6df`); Task 1's contrast test already proves that pair at 10.09:1 light and 10.84:1 dark.

**Use no physical-direction utility.** If the active item carries an indicator bar, it must be `border-s-*`, never `border-l-*` — eslint fails the build otherwise.

- [ ] **Step 3: Run the full suite, typecheck, lint, build**

Run: `cd apps/web && pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS. Lint is the one that catches a physical-direction slip.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/shell/AppChrome.tsx apps/web/components/shell/PublicChrome.tsx
git commit -m "feat(shell): teal-on-mint nav active state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Route sweep, comment repair, and decision record

**Files:**
- Modify: whichever screens the sweep turns up (expected: few to none)
- Modify: `apps/web/app/globals.css` (prose only)
- Modify: `docs/decisions.md`
- Modify: `docs/superpowers/specs/2026-09-20-platform-retheme-design.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the finished work.

- [ ] **Step 1: Start the dev server**

Run: `cd apps/web && pnpm dev`  (port 3001)

- [ ] **Step 2: Walk every route group in both themes**

Toggle light/dark on each. Look for: a hard-coded radius that did not follow `--radius`; text that lost contrast against mint; a focus ring invisible on a mint surface; a badge unreadable at 12px; lime anywhere that is not a single primary action.

- Auth: `/login`, `/signup`, `/signup/provider`, `/signup/verify`, `/reset-password`, `/invite/[token]`, `/verification`
- App: `/workspace`, `/cases`, `/cases/new`, `/cases/[ref]`, `/patients`, `/patients/new`, `/patients/[id]`, `/ledger`, `/notifications`, `/upload`, `/profile`, `/doctor`, `/doctor/availability`
- Settings: `/settings`, `/settings/billing`, `/settings/notifications`, `/settings/team`
- Admin: `/admin/audit`, `/admin/cases`, `/admin/ledger`, `/admin/providers`
- Public: `/pricing`

- [ ] **Step 3: Check the viewer specifically**

Open `/viewer/[studyUid]`. The image canvas at `app/viewer/[studyUid]/page.tsx:275` must still be `bg-black` — diagnostic images need a neutral surround in both themes. Confirm it does not now read as two blacks fighting against the dark chrome; if it does, add a `border` rather than lightening the canvas.

- [ ] **Step 4: Check RTL**

Switch the locale to Arabic on `/workspace` and `/cases`. Confirm headings fall back to Plex cleanly (no Latin face applied to Arabic glyphs) and that nothing has flipped incorrectly.

- [ ] **Step 5: Settle the two risks the spec flagged**

Both are recorded in the spec's §11 as "decide on the evidence", so decide here rather than leaving them open.

**a. Do `--info` and `--primary` read as two colours?** They are `#1a5d54` and `#246f65` — both teal, and deliberately close. Put an info badge and a primary button on one screen (`/cases` has both) and look at them together, in both themes. If they read as one colour, the meaning of "informational" is lost against "primary action": move `--info` to a distinct hue (a blue such as `#1a4f7a` light / `#8fc3f0` dark keeps the family without colliding), update both dark blocks, and re-run `pnpm test` — the contrast test will hold you to the 4.5:1 floor on `--info-surface`.

**b. What did the extra preloaded face cost the viewer?** `app/layout.tsx` says the viewer's P9.1 five-second budget is kept "out of the font's hands", and Task 2 added a preloaded face to every route. Load `/viewer/[studyUid]` with the network tab open and compare against `git stash`-ing the re-theme. If the budget regressed, drop `preload: true` to `false` in `lib/fonts.ts` — headings swap one line late instead of competing with the study in the first round trip.

Record whichever way each went in the Task 6 commit message.

- [ ] **Step 6: Repair the stale comments in `globals.css`**

The header comment still describes "modern institutional" and cites a "§4.1" that exists in no live spec. Rewrite that prose to describe what ships: the corridor register shared with the landing page, with density and motion — not palette — as the line between marketing and application.

**Keep every comment that explains a MECHANISM**: why the dark palette is written twice, why `color-scheme` is set, the three-step elevation rationale, the reduced-motion block, and the RTL logical-utilities header. All still true.

- [ ] **Step 7: Record the decisions**

Append to `docs/decisions.md` an entry dated 2026-09-20 recording D1–D5 from the spec, noting that the marketing/application palette split is retired and that the shared brand-ramp refactor is deferred until the helix work on `mir-32` lands.

- [ ] **Step 8: Correct the spec**

In the spec's §5, remove `SectionHeading` from the display-font list and add a line recording that each display target also drops to an in-range weight, with the reason. The spec should describe what shipped.

- [ ] **Step 9: Final verification**

Run: `cd apps/web && pnpm test && pnpm typecheck && pnpm lint && pnpm build`

Expected: all PASS. **Report the actual output.** Do not claim completion without it.

- [ ] **Step 10: Commit**

```bash
git add apps/web docs
git commit -m "feat(theme): finish the platform re-theme sweep

Walks all 15 route groups in both themes and in RTL, repairs the
globals.css comments that still argued for the split this work retires,
and records D1-D5 in docs/decisions.md.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
