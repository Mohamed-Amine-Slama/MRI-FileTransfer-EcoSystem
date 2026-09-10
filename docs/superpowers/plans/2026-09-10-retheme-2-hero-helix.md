# Landing Re-theme · Plan 2 of 3 — Hero and Particle Helix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CT slice-scrub hero with a full-height mint hero built around an interactive particle DNA helix (raw WebGL2), with word-by-word blur reveals, glass capability chips and teal/lime pill CTAs.

**Architecture:** A pure, seeded geometry module builds per-particle attributes; one GLSL ES 3.00 program computes the helix, its pointer repulsion, scroll coupling and entrance assembly on the GPU in a single `drawArrays(POINTS)`. `HelixCanvas` owns the lifecycle (lazy import after LCP, run only while visible, context loss, reduced motion) over a pre-rendered AVIF poster, which is also Tier C's whole helix. The hero composes it with two new reveal primitives, `WordReveal` and `BlurIn`, that wait on Plan 1's curtain signal.

**Tech Stack:** WebGL2 / GLSL ES 3.00, React 19 client components, GSAP + ScrollTrigger, Vitest (node), Playwright (Chromium with SwiftShader), sharp.

**Spec:** `docs/superpowers/specs/2026-09-10-landing-light-retheme-design.md` (§4 hero, §5 helix, §8 tiers, §9 tests, §10 budgets)

**Plan series:** plan 2 of 3. Requires Plan 1 (`2026-09-10-retheme-1-foundations.md`) — its tokens, `.eyebrow`, `.btn--secondary`, `.chip`, `lib/site/motion.ts` and `lib/site/curtain.ts`.

## Global Constraints

- Scope: landing page only — `apps/web/components/corridor/**`, `apps/web/app/corridor.css`, `apps/web/lib/site/**`, landing e2e, `apps/web/scripts/`, `apps/web/public/`, landing docs.
- Provenance: the renderer and shaders are written from scratch for this repo. No code, shader or bundle is taken from the reference site. All copy is MIR's own (`lib/site/copy.ts`).
- No three.js or any new runtime dependency. The renderer is raw WebGL2, one program, one draw call.
- Tiers (spec §5.5): A = 36,000 particles, DPR cap 2, pointer + scroll coupling; B = 14,000, DPR 1, pointer + scroll; C, reduced motion, no WebGL2 = poster only, renderer never imported.
- Layout (element boxes) identical across tiers A/B/C. Nothing a reader needs is hidden by CSS at rest; `opacity: 0` appears only on the decorative canvas, which always has its poster underneath.
- One pinned element on the page at a time (Landing-Page-Specs §6.4). This plan adds no pin.
- RTL: logical properties only; the helix leans the other way in RTL by negating its roll (never by mirroring X, which would make it left-handed).
- Copy: every locale (`ar`, `fr`, `en`) has the same keys; §1.4 banned-claims test stays green; no exclamation marks.
- Test ids that must survive: `landing-signup`, `landing-how`, `landing-close-signup`, `landing-pricing`, `upload-cut`, `consent-revoke`, `viewer-banner`, `footer-reduce-motion`, `footer-sound`, `theme-toggle`.
- Budgets (spec §10): helix renderer is lazy (dynamic import from an idle callback); geometry build ≤ 10 ms at Tier A (e2e tripwire at 25 ms under SwiftShader); each poster ≤ 60 KB; first-load JS must not grow.
- Web unit tests: `pnpm --filter @mir/web exec vitest run <path>`. E2E needs a fresh build: `pnpm --filter @mir/web build`, then `pnpm --filter @mir/web exec playwright test <spec> --project=chromium` (the config's webServer runs `pnpm start` on :3001, or reuses one already running).
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
  ```

---

## File map (this plan)

| File | Change | Responsibility |
|---|---|---|
| `components/corridor/helix/helix-config.ts` | create | every tunable number, poster paths |
| `components/corridor/helix/helix-geometry.ts` (+ test) | create | seeded PRNG, per-particle attribute buffers |
| `components/corridor/helix/helix-shaders.ts` | create | GLSL ES 3.00 vertex + fragment source |
| `components/corridor/helix/helix-renderer.ts` (+ test) | create | imperative GL: program, buffers, uniforms, draw, dispose |
| `components/corridor/helix/HelixCanvas.tsx` | create | poster + canvas, lifecycle, pointer, scroll, `data-helix-state` |
| `components/corridor/motion/WordReveal.tsx` | create | word-by-word blur reveal |
| `components/corridor/motion/BlurIn.tsx` | create | block blur-in, `data-reveal` |
| `components/corridor/scenes/S01Hero.tsx` | rewrite | hero composition |
| `lib/site/tier.ts` (+ test) | modify | `helix` budget; later drops `sequence` and first-frames demotion |
| `lib/site/site-provider.tsx` | modify | a forced `?tier=` is not demoted |
| `lib/site/copy.ts` (+ test) | modify | hero eyebrow + 4 chip keys; retired hero keys removed |
| `lib/site/sequence.ts`, `scripts/render-slices.mjs` | modify | only the Tier B set + poster remain |
| `lib/site/sound.ts` | modify | the `slice` cue goes with the slice counter |
| `scripts/render-helix-poster.mjs` | create | renders `public/helix/poster-{ltr,rtl}.avif` |
| `playwright.config.ts` | modify | SwiftShader flags so headless Chromium has WebGL2 |
| `e2e/corridor.spec.ts` | modify | hero/helix tests; retired slice tests removed |
| `app/corridor.css` | modify | helix + hero CSS; old hero CSS removed |
| deleted | — | `motion/HeadlineReveal.tsx`, `motion/ScrubCanvas.tsx`, `primitives/SliceCounter.tsx`, `public/seq/hero/a/` |

All paths below are relative to `apps/web/` unless they start with `docs/`.

---

### Task 1: Helix configuration and seeded geometry

**Files:**
- Create: `components/corridor/helix/helix-config.ts`, `components/corridor/helix/helix-geometry.ts`, `components/corridor/helix/helix-geometry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `HELIX` (readonly config object, fields exactly as in Step 3) and `HELIX_POSTER = { ltr: '/helix/poster-ltr.avif', rtl: '/helix/poster-rtl.avif', width: 1140, height: 900 }`.
  - `KIND = { strandA: 0, strandB: 1, rung: 2, dustA: 3, dustB: 4 }`.
  - `interface HelixBuffers { count: number; kind: Float32Array; t: Float32Array; seed: Float32Array; scatter: Float32Array }` — `seed` is 4 floats per particle `[radial jitter | rung chord 0..1, angular/axial jitter, size 0..1, tone 0..1]`; `scatter` is 3 floats per particle.
  - `mulberry32(seed: number): () => number`, `gaussian(rand: () => number): number`, `kindCounts(count: number): { strand: number; rung: number; dust: number }`, `buildHelix(options: { count: number; seed?: number }): HelixBuffers`.

- [ ] **Step 1: Write the failing test**

Create `components/corridor/helix/helix-geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HELIX } from './helix-config';
import { KIND, buildHelix, kindCounts, mulberry32 } from './helix-geometry';

describe('mulberry32', () => {
  it('stays in [0, 1) and repeats for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const value = a();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(b()).toBe(value);
    }
  });
});

describe('the particle split (spec §5.2)', () => {
  it('sums the configured shares to one', () => {
    expect(HELIX.split.strand + HELIX.split.rung + HELIX.split.dust).toBeCloseTo(1);
  });

  it('gives Tier A 45% strand, 15% rung, 40% dust, and loses nobody', () => {
    expect(kindCounts(36_000)).toEqual({ strand: 16_200, rung: 5_400, dust: 14_400 });
    const odd = kindCounts(14_001);
    expect(odd.strand + odd.rung + odd.dust).toBe(14_001);
  });
});

describe('buildHelix', () => {
  it('is deterministic for a seed, so posters, tests and the live page agree', () => {
    const a = buildHelix({ count: 2_000, seed: 7 });
    const b = buildHelix({ count: 2_000, seed: 7 });
    expect(a.kind).toEqual(b.kind);
    expect(a.t).toEqual(b.t);
    expect(a.seed).toEqual(b.seed);
    expect(a.scatter).toEqual(b.scatter);
  });

  it('changes with the seed', () => {
    expect(buildHelix({ count: 500, seed: 1 }).t).not.toEqual(buildHelix({ count: 500, seed: 2 }).t);
  });

  it('sizes every buffer to the particle count', () => {
    const h = buildHelix({ count: 1_234 });
    expect(h.count).toBe(1_234);
    expect(h.kind).toHaveLength(1_234);
    expect(h.t).toHaveLength(1_234);
    expect(h.seed).toHaveLength(1_234 * 4);
    expect(h.scatter).toHaveLength(1_234 * 3);
  });

  it('labels particles with their kind in the configured proportion', () => {
    const h = buildHelix({ count: 1_000 });
    const counts = [0, 0, 0, 0, 0];
    for (const kind of h.kind) counts[kind] = (counts[kind] ?? 0) + 1;
    expect((counts[KIND.strandA] ?? 0) + (counts[KIND.strandB] ?? 0)).toBe(450);
    expect(counts[KIND.rung]).toBe(150);
    expect((counts[KIND.dustA] ?? 0) + (counts[KIND.dustB] ?? 0)).toBe(400);
  });

  it('keeps every particle inside the helix length', () => {
    for (const t of buildHelix({ count: 5_000 }).t) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('puts every rung particle on a base pair, between the two strands', () => {
    const h = buildHelix({ count: 5_000 });
    h.kind.forEach((kind, i) => {
      if (kind !== KIND.rung) return;
      const pair = (h.t[i] ?? 0) * HELIX.rungs - 0.5;
      expect(Math.abs(pair - Math.round(pair))).toBeLessThan(1e-4);
      const chord = h.seed[i * 4] ?? -1;
      expect(chord).toBeGreaterThanOrEqual(0);
      expect(chord).toBeLessThan(1);
    });
  });

  it('scatters the entrance positions inside a ball three radii wide', () => {
    const h = buildHelix({ count: 3_000 });
    const reach = HELIX.radius * 3 + 1e-4;
    for (let i = 0; i < h.count; i++) {
      const d = Math.hypot(h.scatter[i * 3] ?? 0, h.scatter[i * 3 + 1] ?? 0, h.scatter[i * 3 + 2] ?? 0);
      expect(d).toBeLessThanOrEqual(reach);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mir/web exec vitest run components/corridor/helix/helix-geometry.test.ts`
Expected: FAIL — `Cannot find module './helix-config'`.

- [ ] **Step 3: Write the configuration**

Create `components/corridor/helix/helix-config.ts`:

```ts
/**
 * Every tunable number of the particle helix — spec 2026-09-10 §5.
 *
 * One place, so visual tuning never touches the renderer. World units are
 * arbitrary; the camera and field of view below frame a helix of `length`
 * so it overruns the top and bottom of its box slightly, which is the look.
 */
export const HELIX = {
  /** PRNG seed — the live render, the posters and the tests all agree. */
  seed: 20260910,
  /** Share of particles per kind. Must sum to 1. */
  split: { strand: 0.45, rung: 0.15, dust: 0.4 },
  /** Base pairs along the visible length. */
  rungs: 26,
  turns: 2.2,
  radius: 1.75,
  length: 10,
  /** Corner-to-corner lean. Negated in RTL — which keeps the helix right-handed. */
  rollDeg: -28,
  yawSwingDeg: 6,
  /** Spin at rest, radians per second. */
  spin: 0.12,
  /** Spin and dust-spread multipliers once the host has fully scrolled out. */
  scrollSpinBoost: 3,
  scrollDustBoost: 1.6,
  assembleSeconds: 1.6,
  pointer: {
    /** Repulsion radius, as a share of the canvas's shorter side. */
    radiusFrac: 0.16,
    /** Largest push, CSS px. */
    maxPx: 38,
    /** Time to relax fully once the pointer leaves or rests. */
    releaseMs: 600,
    /** A pointer that has not moved for this long counts as resting. */
    idleMs: 1200,
  },
  /** Point size ranges, CSS px, before perspective and depth. */
  size: { strand: [1.2, 3.2], rung: [0.8, 1.6], dust: [0.6, 1.8] },
  alpha: { strand: [0.55, 0.9], rung: [0.25, 0.5], dust: [0.08, 0.35] },
  /** Gaussian spread around the strand, world units. */
  jitter: { strand: 0.12, rung: 0.05, dust: 0.55 },
  /** Deep teal → teal → leaf → chartreuse → lime. Far particles sit toward the start. */
  palette: ['#054038', '#246f65', '#4f8a3c', '#9fbf4a', '#e5ed9b'],
  cameraZ: 12,
  fovDeg: 38,
} as const;

/**
 * The still frame Tier C shows, and every tier paints first. Two files rather
 * than one mirrored image: a helix flipped with `scaleX(-1)` turns left-handed.
 * Rendered by `scripts/render-helix-poster.mjs`.
 */
export const HELIX_POSTER = {
  ltr: '/helix/poster-ltr.avif',
  rtl: '/helix/poster-rtl.avif',
  width: 1140,
  height: 900,
} as const;
```

- [ ] **Step 4: Write the geometry**

Create `components/corridor/helix/helix-geometry.ts`:

```ts
import { HELIX } from './helix-config';

/**
 * Per-particle attributes for the helix — spec 2026-09-10 §5.2.
 *
 * Pure and seeded: no DOM, no GL, same output for the same seed. The shader
 * turns these into positions every frame, so nothing here is per-frame work.
 */

export const KIND = { strandA: 0, strandB: 1, rung: 2, dustA: 3, dustB: 4 } as const;

export interface HelixBuffers {
  count: number;
  kind: Float32Array;
  /** Position along the helix, 0..1. */
  t: Float32Array;
  /** 4 per particle: [radial jitter | rung chord 0..1, angular/axial jitter, size 0..1, tone 0..1]. */
  seed: Float32Array;
  /** 3 per particle: where the particle starts before the entrance assembles it. */
  scatter: Float32Array;
}

/** A small, fast, seedable PRNG. Not for anything but decoration. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal by Box–Muller. `1 - rand()` keeps the log's argument off zero. */
export function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

export function kindCounts(count: number): { strand: number; rung: number; dust: number } {
  const strand = Math.round(count * HELIX.split.strand);
  const rung = Math.round(count * HELIX.split.rung);
  return { strand, rung, dust: Math.max(0, count - strand - rung) };
}

export function buildHelix({ count, seed = HELIX.seed }: { count: number; seed?: number }): HelixBuffers {
  const rand = mulberry32(seed);
  const kind = new Float32Array(count);
  const t = new Float32Array(count);
  const seeds = new Float32Array(count * 4);
  const scatter = new Float32Array(count * 3);

  const { strand, rung } = kindCounts(count);
  const halfStrand = Math.floor(strand / 2);
  const dustStart = strand + rung;
  const halfDust = Math.floor((count - dustStart) / 2);
  const reach = HELIX.radius * 3;

  for (let i = 0; i < count; i++) {
    let k: number;
    if (i < strand) k = i < halfStrand ? KIND.strandA : KIND.strandB;
    else if (i < dustStart) k = KIND.rung;
    else k = i - dustStart < halfDust ? KIND.dustA : KIND.dustB;
    kind[i] = k;

    if (k === KIND.rung) {
      const pair = Math.floor(rand() * HELIX.rungs);
      t[i] = (pair + 0.5) / HELIX.rungs;
      // Where along the chord between the two strands this particle sits.
      seeds[i * 4] = rand();
    } else {
      t[i] = rand();
      seeds[i * 4] = gaussian(rand);
    }
    seeds[i * 4 + 1] = gaussian(rand);
    seeds[i * 4 + 2] = rand();
    seeds[i * 4 + 3] = rand();

    // A uniform point in a ball: gaussian direction, cube-root radius.
    const x = gaussian(rand);
    const y = gaussian(rand);
    const z = gaussian(rand);
    const length = Math.hypot(x, y, z) || 1;
    const r = reach * Math.cbrt(rand());
    scatter[i * 3] = (x / length) * r;
    scatter[i * 3 + 1] = (y / length) * r;
    scatter[i * 3 + 2] = (z / length) * r;
  }

  return { count, kind, t, seed: seeds, scatter };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @mir/web exec vitest run components/corridor/helix/helix-geometry.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/corridor/helix
git commit -m "$(cat <<'EOF'
feat(helix): seeded particle geometry and its tunables

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 2: Shaders and the WebGL2 renderer

**Files:**
- Create: `components/corridor/helix/helix-shaders.ts`, `components/corridor/helix/helix-renderer.ts`, `components/corridor/helix/helix-renderer.test.ts`

**Interfaces:**
- Consumes: `HELIX`, `buildHelix` (Task 1).
- Produces:
  - `VERTEX_SHADER: string`, `FRAGMENT_SHADER: string`.
  - `ATTRIBUTES` and `UNIFORMS` (readonly name tuples, exactly as in Step 4).
  - `interface HelixFrame { time: number; spinAngle: number; assemble: number; scroll: number; pointer: readonly [number, number]; pointerStrength: number }`.
  - `interface HelixRenderer { resize(cssWidth: number, cssHeight: number, dpr: number): void; render(frame: HelixFrame): void; dispose(): void }`.
  - `createHelixRenderer(canvas: HTMLCanvasElement, options: { count: number; mirror: boolean; preserveDrawingBuffer?: boolean }): HelixRenderer | null` — `null` on any failure (no context, compile or link error); never throws.
  - `hexToRgb01(hex: string): [number, number, number]`.
  - Records `performance.measure('helix:geometry')` around `buildHelix`.

- [ ] **Step 1: Write the failing test**

Create `components/corridor/helix/helix-renderer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ATTRIBUTES, UNIFORMS, hexToRgb01 } from './helix-renderer';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './helix-shaders';

/**
 * The renderer and the shaders name the same things. GL does not fail when a
 * name drifts — `getUniformLocation` returns null and the uniform is silently
 * zero — so the agreement is checked here instead.
 */

function declared(source: string, qualifier: 'in' | 'uniform'): string[] {
  return [...source.matchAll(new RegExp(`^${qualifier}\\s+\\w+\\s+(\\w+)`, 'gm'))].map((m) => m[1] ?? '');
}

describe('shader / renderer agreement', () => {
  it('starts both shaders with the version directive, as GLSL ES 3.00 requires', () => {
    expect(VERTEX_SHADER.startsWith('#version 300 es\n')).toBe(true);
    expect(FRAGMENT_SHADER.startsWith('#version 300 es\n')).toBe(true);
  });

  it('binds exactly the attributes the vertex shader declares', () => {
    expect(declared(VERTEX_SHADER, 'in').sort()).toEqual([...ATTRIBUTES].sort());
  });

  it('sets every uniform either shader declares, and none that neither does', () => {
    const inShaders = new Set([...declared(VERTEX_SHADER, 'uniform'), ...declared(FRAGMENT_SHADER, 'uniform')]);
    expect(inShaders).toEqual(new Set(UNIFORMS));
  });
});

describe('hexToRgb01', () => {
  it('converts a 6-digit hex to unit floats', () => {
    const [r, g, b] = hexToRgb01('#246f65');
    expect(r).toBeCloseTo(36 / 255);
    expect(g).toBeCloseTo(111 / 255);
    expect(b).toBeCloseTo(101 / 255);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mir/web exec vitest run components/corridor/helix/helix-renderer.test.ts`
Expected: FAIL — `Cannot find module './helix-renderer'`.

- [ ] **Step 3: Write the shaders**

Create `components/corridor/helix/helix-shaders.ts`. The template literals must begin with `#version` on the very first character — a leading newline is a compile error.

```ts
/**
 * The helix, computed on the GPU — spec 2026-09-10 §5.3.
 *
 * Every particle's position is a function of its static attributes and a few
 * uniforms, so a frame costs one `drawArrays` and no CPU work per particle.
 * Order in the vertex shader: helix position → dust drift → entrance assembly
 * → yaw swing → roll → perspective → pointer repulsion in screen space.
 */

export const VERTEX_SHADER = `#version 300 es
precision highp float;

in float aKind;
in float aT;
in vec4 aSeed;
in vec3 aScatter;

uniform float uTime;
uniform float uSpinAngle;
uniform float uAssemble;
uniform float uScroll;
uniform float uRoll;
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uTurns;
uniform float uRadius;
uniform float uLength;
uniform float uYawSwing;
uniform float uCameraZ;
uniform float uFocal;
uniform float uAspect;
uniform float uPointerRadius;
uniform float uPointerMax;
uniform vec2 uSizeStrand;
uniform vec2 uSizeRung;
uniform vec2 uSizeDust;
uniform vec2 uAlphaStrand;
uniform vec2 uAlphaRung;
uniform vec2 uAlphaDust;
uniform vec3 uJitter;
uniform float uDustBoost;

out float vAlpha;
out float vTone;

const float TAU = 6.283185307;
const float PI = 3.141592654;

vec3 strandPoint(float t, float phase, float angleJitter, float radiusJitter) {
  float a = t * uTurns * TAU + uSpinAngle + phase + angleJitter;
  float r = uRadius + radiusJitter;
  return vec3(cos(a) * r, (t - 0.5) * uLength, sin(a) * r);
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

void main() {
  bool isRung = aKind > 1.5 && aKind < 2.5;
  bool isDust = aKind > 2.5;
  bool onB = (aKind > 0.5 && aKind < 1.5) || aKind > 3.5;
  float phase = onB ? PI : 0.0;

  vec3 p;
  vec2 sizeRange;
  vec2 alphaRange;
  if (isRung) {
    vec3 a = strandPoint(aT, 0.0, 0.0, 0.0);
    vec3 b = strandPoint(aT, PI, 0.0, 0.0);
    p = mix(a, b, aSeed.x);
    p.y += aSeed.y * uJitter.y;
    sizeRange = uSizeRung;
    alphaRange = uAlphaRung;
  } else if (isDust) {
    float sigma = uJitter.z * mix(1.0, uDustBoost, uScroll);
    p = strandPoint(aT, phase, aSeed.y * 0.35, aSeed.x * sigma);
    p.y += aSeed.y * 0.25;
    vec3 q = p * 0.6 + vec3(uTime * 0.07);
    p += (vec3(noise(q), noise(q + 17.3), noise(q + 41.1)) - 0.5) * sigma;
    sizeRange = uSizeDust;
    alphaRange = uAlphaDust;
  } else {
    p = strandPoint(aT, phase, aSeed.y * 0.08, aSeed.x * uJitter.x);
    sizeRange = uSizeStrand;
    alphaRange = uAlphaStrand;
  }

  // Entrance: each particle travels in from its scatter point, later along the strand.
  float k = clamp(uAssemble * 1.35 - aT * 0.35, 0.0, 1.0);
  float eased = k >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * k);
  p = mix(aScatter, p, eased);

  // A slow yaw swing about the axis, then the corner-to-corner roll.
  float yaw = sin(uTime * 0.25) * uYawSwing;
  p = vec3(cos(yaw) * p.x + sin(yaw) * p.z, p.y, -sin(yaw) * p.x + cos(yaw) * p.z);
  p = vec3(cos(uRoll) * p.x - sin(uRoll) * p.y, sin(uRoll) * p.x + cos(uRoll) * p.y, p.z);

  // Perspective: the camera sits uCameraZ in front of the origin, looking at it.
  float w = p.z + uCameraZ;
  vec2 ndc = vec2(p.x * uFocal / uAspect, p.y * uFocal) / w;

  // Pointer repulsion, in CSS pixels with a top-left origin, like the pointer.
  vec2 px = vec2((ndc.x * 0.5 + 0.5) * uViewport.x, (0.5 - ndc.y * 0.5) * uViewport.y);
  vec2 away = px - uPointer;
  float dist = length(away);
  if (uPointerStrength > 0.0 && dist < uPointerRadius && dist > 0.001) {
    float push = (1.0 - smoothstep(0.0, uPointerRadius, dist)) * uPointerMax * uPointerStrength;
    px += away / dist * push;
  }
  ndc = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);

  float near = clamp(0.5 - p.z / (uRadius * 2.4), 0.0, 1.0);
  float scale = uCameraZ / w;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = mix(sizeRange.x, sizeRange.y, aSeed.z) * scale * mix(0.7, 1.15, near) * uDpr;
  vAlpha = mix(alphaRange.x, alphaRange.y, fract(aSeed.w * 7.13)) * mix(0.35, 1.0, near) * mix(0.25, 1.0, eased);
  vTone = clamp(aSeed.w * 0.6 + near * 0.4 - (isDust ? 0.1 : 0.0), 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in float vAlpha;
in float vTone;

uniform vec3 uPalette[5];

out vec4 outColor;

vec3 ramp(float x) {
  float s = clamp(x, 0.0, 1.0) * 4.0;
  int i = int(min(floor(s), 3.0));
  return mix(uPalette[i], uPalette[i + 1], s - float(i));
}

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 12.0) * vAlpha;
  if (a < 0.004) discard;
  // Premultiplied, for ONE / ONE_MINUS_SRC_ALPHA blending on a light ground.
  outColor = vec4(ramp(vTone) * a, a);
}
`;
```

- [ ] **Step 4: Write the renderer**

Create `components/corridor/helix/helix-renderer.ts`:

```ts
import { HELIX } from './helix-config';
import { buildHelix } from './helix-geometry';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './helix-shaders';

/**
 * The helix's GL, and nothing else — spec 2026-09-10 §5.
 *
 * Imperative and React-free. `HelixCanvas` imports this lazily, after LCP, so
 * none of it is in the first-load bundle. Every failure returns `null` rather
 * than throwing: a page whose hero decoration failed must still be a page.
 */

export const ATTRIBUTES = ['aKind', 'aT', 'aSeed', 'aScatter'] as const;

export const UNIFORMS = [
  'uTime', 'uSpinAngle', 'uAssemble', 'uScroll', 'uRoll', 'uPointer', 'uPointerStrength',
  'uViewport', 'uDpr', 'uTurns', 'uRadius', 'uLength', 'uYawSwing', 'uCameraZ', 'uFocal',
  'uAspect', 'uPointerRadius', 'uPointerMax', 'uSizeStrand', 'uSizeRung', 'uSizeDust',
  'uAlphaStrand', 'uAlphaRung', 'uAlphaDust', 'uJitter', 'uDustBoost', 'uPalette',
] as const;

type UniformName = (typeof UNIFORMS)[number];

export interface HelixFrame {
  /** Seconds, for the dust drift and yaw swing. */
  time: number;
  /** Radians, integrated by the caller so a speed change never jumps. */
  spinAngle: number;
  /** 0 = scattered, 1 = assembled. */
  assemble: number;
  /** Host scroll-out progress, 0..1. */
  scroll: number;
  /** CSS px relative to the canvas's top-left. */
  pointer: readonly [number, number];
  /** 0..1, eased by the caller. */
  pointerStrength: number;
}

export interface HelixRenderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  render(frame: HelixFrame): void;
  dispose(): void;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function warn(message: string, detail: string | null): void {
  if (process.env.NODE_ENV !== 'production') console.warn(`[helix] ${message}`, detail ?? '');
}

function context(canvas: HTMLCanvasElement, preserve: boolean): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: preserve,
    });
  } catch {
    return null;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    warn('shader failed to compile', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createHelixRenderer(
  canvas: HTMLCanvasElement,
  options: { count: number; mirror: boolean; preserveDrawingBuffer?: boolean },
): HelixRenderer | null {
  const gl = context(canvas, options.preserveDrawingBuffer === true);
  if (gl === null) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (vertex === null || fragment === null) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    warn('program failed to link', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const started = performance.now();
  const data = buildHelix({ count: options.count });
  performance.measure('helix:geometry', { start: started, end: performance.now() });

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers: WebGLBuffer[] = [];
  const attribute = (name: (typeof ATTRIBUTES)[number], array: Float32Array, size: number): void => {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;
    const buffer = gl.createBuffer();
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };
  attribute('aKind', data.kind, 1);
  attribute('aT', data.t, 1);
  attribute('aSeed', data.seed, 4);
  attribute('aScatter', data.scatter, 3);
  gl.bindVertexArray(null);

  const u = {} as Record<UniformName, WebGLUniformLocation | null>;
  for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);

  const deg = Math.PI / 180;
  gl.useProgram(program);
  gl.uniform1f(u.uTurns, HELIX.turns);
  gl.uniform1f(u.uRadius, HELIX.radius);
  gl.uniform1f(u.uLength, HELIX.length);
  gl.uniform1f(u.uRoll, HELIX.rollDeg * deg * (options.mirror ? -1 : 1));
  gl.uniform1f(u.uYawSwing, HELIX.yawSwingDeg * deg);
  gl.uniform1f(u.uCameraZ, HELIX.cameraZ);
  gl.uniform1f(u.uFocal, 1 / Math.tan((HELIX.fovDeg * deg) / 2));
  gl.uniform1f(u.uPointerMax, HELIX.pointer.maxPx);
  gl.uniform2f(u.uSizeStrand, ...HELIX.size.strand);
  gl.uniform2f(u.uSizeRung, ...HELIX.size.rung);
  gl.uniform2f(u.uSizeDust, ...HELIX.size.dust);
  gl.uniform2f(u.uAlphaStrand, ...HELIX.alpha.strand);
  gl.uniform2f(u.uAlphaRung, ...HELIX.alpha.rung);
  gl.uniform2f(u.uAlphaDust, ...HELIX.alpha.dust);
  gl.uniform3f(u.uJitter, HELIX.jitter.strand, HELIX.jitter.rung, HELIX.jitter.dust);
  gl.uniform1f(u.uDustBoost, HELIX.scrollDustBoost);
  gl.uniform3fv(u.uPalette, new Float32Array(HELIX.palette.flatMap((hex) => hexToRgb01(hex))));

  // Premultiplied "over". Additive blending washes out to white on a light ground.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);

  return {
    resize(cssWidth, cssHeight, dpr) {
      const width = Math.max(1, cssWidth);
      const height = Math.max(1, cssHeight);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(u.uViewport, width, height);
      gl.uniform1f(u.uAspect, width / height);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform1f(u.uPointerRadius, Math.min(width, height) * HELIX.pointer.radiusFrac);
    },
    render(frame) {
      gl.useProgram(program);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uSpinAngle, frame.spinAngle);
      gl.uniform1f(u.uAssemble, frame.assemble);
      gl.uniform1f(u.uScroll, frame.scroll);
      gl.uniform2f(u.uPointer, frame.pointer[0], frame.pointer[1]);
      gl.uniform1f(u.uPointerStrength, frame.pointerStrength);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, data.count);
      gl.bindVertexArray(null);
    },
    dispose() {
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `pnpm --filter @mir/web exec vitest run components/corridor/helix`
Expected: PASS (geometry 9, renderer 4).

Run: `pnpm --filter @mir/web typecheck`
Expected: exit 0. If `createProgram`/`createBuffer`/`createVertexArray` are typed nullable in this TypeScript's `lib.dom`, add `if (program === null) return null;` (and the same for the other two) directly after each call — do not use non-null assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/corridor/helix
git commit -m "$(cat <<'EOF'
feat(helix): GLSL ES 3.00 shaders and a one-draw-call WebGL2 renderer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 3: Tier budget and `HelixCanvas`

**Files:**
- Create: `components/corridor/helix/HelixCanvas.tsx`
- Modify: `lib/site/tier.ts` (`TierBudget`, `TIER_BUDGET`), `lib/site/tier.test.ts` (`what each tier ships`), `app/corridor.css` (append)

**Interfaces:**
- Consumes: `HELIX`, `HELIX_POSTER` (Task 1); `createHelixRenderer`, `HelixFrame`, `HelixRenderer` (Task 2); `onCurtainLifted` (Plan 1); `whenIdle` from `lib/site/scroll.ts`; `useSite()` → `{ budget, dir }`.
- Produces:
  - `TierBudget.helix: { readonly particles: number; readonly dpr: number } | null` — A `{36_000, 2}`, B `{14_000, 1}`, C `null`.
  - `<HelixCanvas hostRef entrance posterLoading? className? />` with `hostRef: RefObject<HTMLElement | null>`, `entrance: 'curtain' | 'none'`, `posterLoading?: 'eager' | 'lazy'` (default `'eager'`).
  - DOM contract: `<div class="helix …" data-helix-state="poster|loading|running|paused|lost|still" aria-hidden="true"><img class="helix-poster"/><canvas class="helix-canvas"/></div>` (canvas only when `budget.helix !== null`).
  - URL hook: `?helix-still` renders one assembled frame at time 0 with `preserveDrawingBuffer`, sets state `still`, and never animates (used by the poster script).
  - `performance.measure('helix:build')` around renderer creation.

- [ ] **Step 1: Write the failing tier test**

In `lib/site/tier.test.ts`, inside `describe('what each tier ships', …)`: change the Tier C expectation object to

```ts
    expect(TIER_BUDGET.C).toEqual({
      sequence: null,
      planes: 0,
      expressive: false,
      interactiveDemo: false,
      helix: null,
    });
```

and add this test to the same `describe`:

```ts
  it('sizes the helix per tier and gives Tier C its poster alone (spec §5.5)', () => {
    expect(TIER_BUDGET.A.helix).toEqual({ particles: 36_000, dpr: 2 });
    expect(TIER_BUDGET.B.helix).toEqual({ particles: 14_000, dpr: 1 });
    expect(TIER_BUDGET.C.helix).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @mir/web exec vitest run lib/site/tier.test.ts`
Expected: FAIL — `helix` is undefined.

- [ ] **Step 3: Add the helix budget**

In `lib/site/tier.ts`, add to `interface TierBudget`:

```ts
  /** The particle helix (spec 2026-09-10 §5.5), or null for its poster alone. */
  helix: { readonly particles: number; readonly dpr: number } | null;
```

and replace `TIER_BUDGET` with:

```ts
export const TIER_BUDGET: Record<Tier, TierBudget> = {
  A: { sequence: 'a', planes: 5, expressive: true, interactiveDemo: true, helix: { particles: 36_000, dpr: 2 } },
  B: { sequence: 'b', planes: 2, expressive: true, interactiveDemo: true, helix: { particles: 14_000, dpr: 1 } },
  C: { sequence: null, planes: 0, expressive: false, interactiveDemo: false, helix: null },
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @mir/web exec vitest run lib/site/tier.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `HelixCanvas`**

Create `components/corridor/helix/HelixCanvas.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { onCurtainLifted } from '../../../lib/site/curtain';
import { whenIdle } from '../../../lib/site/scroll';
import { useSite } from '../../../lib/site/site-provider';
import { HELIX, HELIX_POSTER } from './helix-config';
import type { HelixFrame, HelixRenderer } from './helix-renderer';

/**
 * The particle helix, over its poster — spec 2026-09-10 §5.4.
 *
 * The server, Tier C and a reduced-motion reader get the poster and nothing
 * else: the renderer module is never even requested. On A and B the canvas
 * sits exactly over the poster (so demotion moves nothing), the renderer is
 * imported from an idle callback after LCP, and the frame loop runs only
 * while the host is on screen and the tab is visible — a permanent rAF for a
 * decoration is a permanent battery cost for someone who is reading.
 *
 * `data-helix-state` is the contract the e2e suite and the poster script read.
 */

export type HelixState = 'poster' | 'loading' | 'running' | 'paused' | 'lost' | 'still';

type Factory = (typeof import('./helix-renderer'))['createHelixRenderer'];

const OFFSCREEN: readonly [number, number] = [-1e4, -1e4];

export function HelixCanvas({
  hostRef,
  entrance,
  posterLoading = 'eager',
  className = '',
}: {
  /** The element whose pointer and scroll drive the helix — normally its section. */
  hostRef: RefObject<HTMLElement | null>;
  /** 'curtain': particles gather when the load curtain lifts. 'none': already assembled. */
  entrance: 'curtain' | 'none';
  posterLoading?: 'eager' | 'lazy';
  className?: string;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { budget, dir } = useSite();
  const [state, setState] = useState<HelixState>('poster');
  const helix = budget.helix;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (helix === null || canvas === null || host === null) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;

    const still = new URLSearchParams(window.location.search).has('helix-still');
    const mirror = dir === 'rtl';
    let disposed = false;
    let factory: Factory | null = null;
    let renderer: HelixRenderer | null = null;
    let raf = 0;
    let visible = false;
    let spin = 0;
    let last = 0;
    let assemble = entrance === 'none' || still ? 1 : 0;
    let assembling = false;
    let strength = 0;
    let inside = false;
    let lastMove = 0;
    let pointer: readonly [number, number] = OFFSCREEN;

    const scrollProgress = (): number => {
      const rect = host.getBoundingClientRect();
      return rect.height <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / rect.height));
    };

    const draw = (frame: HelixFrame): void => renderer?.render(frame);

    const tick = (now: number): void => {
      raf = 0;
      if (disposed || renderer === null || !visible || document.hidden) return;
      const dt = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const scroll = scrollProgress();
      spin += dt * HELIX.spin * (1 + scroll * (HELIX.scrollSpinBoost - 1));
      if (assembling && assemble < 1) assemble = Math.min(1, assemble + dt / HELIX.assembleSeconds);
      const engaged = inside && now - lastMove < HELIX.pointer.idleMs;
      strength = engaged
        ? strength + (1 - strength) * (1 - Math.exp(-dt * 8))
        : Math.max(0, strength - dt / (HELIX.pointer.releaseMs / 1000));
      draw({ time: now / 1000, spinAngle: spin, assemble, scroll, pointer, pointerStrength: strength });
      raf = requestAnimationFrame(tick);
    };

    const run = (): void => {
      if (still || raf !== 0 || renderer === null || !visible || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(tick);
      setState('running');
    };

    const halt = (next: HelixState): void => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      setState(next);
    };

    const paintStill = (): void => {
      draw({ time: 0, spinAngle: 0, assemble: 1, scroll: 0, pointer: OFFSCREEN, pointerStrength: 0 });
      setState('still');
    };

    const resize = (): void => {
      if (renderer === null) return;
      const rect = canvas.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, helix.dpr));
      if (still) paintStill();
    };

    const create = (): void => {
      if (factory === null) return;
      const started = performance.now();
      renderer = factory(canvas, { count: helix.particles, mirror, preserveDrawingBuffer: still });
      performance.measure('helix:build', { start: started, end: performance.now() });
      if (renderer === null) {
        setState('poster');
        return;
      }
      resize();
      run();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      if (visible) run();
      else if (renderer !== null && !still) halt('paused');
    });
    intersection.observe(host);

    const onVisibility = (): void => {
      if (!document.hidden) run();
      else if (renderer !== null && !still) halt('paused');
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMove = (event: PointerEvent): void => {
      // A finger is not a cursor: coarse pointers get no repulsion (spec §5.4).
      if (event.pointerType === 'touch') return;
      const rect = canvas.getBoundingClientRect();
      pointer = [event.clientX - rect.left, event.clientY - rect.top];
      inside = true;
      lastMove = performance.now();
    };
    const onLeave = (): void => {
      inside = false;
    };
    host.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('pointerleave', onLeave);

    const onLost = (event: Event): void => {
      event.preventDefault();
      halt('lost');
      renderer?.dispose();
      renderer = null;
    };
    const onRestored = (): void => create();
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    const onMotion = (event: MediaQueryListEvent): void => {
      if (!event.matches) return;
      halt('poster');
      renderer?.dispose();
      renderer = null;
    };
    motion.addEventListener('change', onMotion);

    const offCurtain =
      entrance === 'curtain' && !still
        ? onCurtainLifted(() => {
            assembling = true;
          })
        : () => {};

    setState('loading');
    const cancelIdle = whenIdle(() => {
      import('./helix-renderer')
        .then((module) => {
          if (disposed) return;
          factory = module.createHelixRenderer;
          create();
        })
        .catch(() => {
          if (!disposed) setState('poster');
        });
    });

    return () => {
      disposed = true;
      cancelIdle();
      offCurtain();
      if (raf !== 0) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      motion.removeEventListener('change', onMotion);
      renderer?.dispose();
      renderer = null;
      setState('poster');
    };
  }, [helix, dir, entrance, hostRef]);

  const poster = dir === 'rtl' ? HELIX_POSTER.rtl : HELIX_POSTER.ltr;

  return (
    <div className={`helix ${className}`.trim()} data-helix-state={state} aria-hidden="true">
      <img
        className="helix-poster"
        src={poster}
        alt=""
        width={HELIX_POSTER.width}
        height={HELIX_POSTER.height}
        loading={posterLoading}
        decoding="async"
      />
      {helix !== null && <canvas ref={canvasRef} className="helix-canvas" />}
    </div>
  );
}
```

- [ ] **Step 6: Add the helix CSS**

Append to `app/corridor.css`:

```css
/* ---------------------------------------------------------------------------
 * The particle helix — spec 2026-09-10 §5.
 *
 * The poster is the resting state on every tier; the canvas fades in over it
 * once the renderer has drawn, and the poster fades out underneath. On
 * `lost` or `poster` the canvas is transparent and the poster is back.
 * ------------------------------------------------------------------------- */
.corridor .helix {
  position: relative;
  pointer-events: none;
}

.corridor .helix-poster,
.corridor .helix-canvas {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  transition: opacity 400ms var(--ease-entrance);
}

.corridor .helix-poster {
  object-fit: cover;
}

.corridor .helix-canvas {
  opacity: 0;
}

.corridor .helix:is([data-helix-state='running'], [data-helix-state='paused'], [data-helix-state='still']) .helix-canvas {
  opacity: 1;
}

.corridor .helix:is([data-helix-state='running'], [data-helix-state='paused'], [data-helix-state='still']) .helix-poster {
  opacity: 0;
}
```

- [ ] **Step 7: Type check and run the unit tests**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web exec vitest run`
Expected: exit 0; all PASS. (`HelixCanvas` is mounted in Task 4; it is exercised end-to-end there and in Task 5.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/corridor/helix/HelixCanvas.tsx apps/web/lib/site/tier.ts apps/web/lib/site/tier.test.ts apps/web/app/corridor.css
git commit -m "$(cat <<'EOF'
feat(helix): HelixCanvas lifecycle over its poster, and per-tier budgets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 4: Reveal primitives and the new hero

**Files:**
- Create: `components/corridor/motion/WordReveal.tsx`, `components/corridor/motion/BlurIn.tsx`
- Rewrite: `components/corridor/scenes/S01Hero.tsx`
- Delete: `components/corridor/motion/HeadlineReveal.tsx`
- Modify: `lib/site/copy.ts` (ar, fr, en objects), `lib/site/copy.test.ts`, `app/corridor.css`, `e2e/corridor.spec.ts`

**Interfaces:**
- Consumes: `REVEAL`, `REVEAL_TIMING`, `wordStagger`, `RevealVariant` (Plan 1 `motion.ts`); `onCurtainLifted` (Plan 1); `splitWords` (Plan 1); `useGsapScope`, `promoting`; `HelixCanvas` (Task 3); `StatusPill`; copy keys.
- Produces:
  - `<WordReveal text as? variant? start? delay? id? className? />` — `as: 'h1' | 'h2' | 'h3' | 'p'` (default `'p'`), `variant: RevealVariant` (default `'body'`), `start: 'view' | 'curtain'` (default `'view'`). Units carry `data-unit` and class `reveal-word`.
  - `<BlurIn className? delay? start?>` — renders `<div data-reveal>`; `start: 'view' | 'curtain'`.
  - Copy keys `heroEyebrow`, `heroChipUpload`, `heroChipConsent`, `heroChipBytes`, `heroChipBooking` in `ar`/`fr`/`en`; `heroScrollHint` removed.
  - Hero DOM: `#hero.scene.scene--hero` containing `.hero-copy`, `.helix.hero-helix`, `.hero-rule-wrap`, `.hero-trust`, `.hero-chips-wrap`, `.hero-actions`.

- [ ] **Step 1: Write the failing copy test**

Append inside `describe('the landing copy deck', …)` in `lib/site/copy.test.ts`:

```ts
  it('names the hero eyebrow and its four capability chips in every locale (spec §4.3)', () => {
    const keys = ['heroEyebrow', 'heroChipUpload', 'heroChipConsent', 'heroChipBytes', 'heroChipBooking'];
    for (const locale of UI_LOCALES) {
      const copy = SITE_COPY[locale] as Record<string, string>;
      for (const key of keys) expect(copy[key], `${locale}.${key}`).toBeTruthy();
    }
  });

  it('drops the keys only the slice-scrub hero used', () => {
    expect(Object.keys(SITE_COPY.ar)).not.toContain('heroScrollHint');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @mir/web exec vitest run lib/site/copy.test.ts`
Expected: FAIL on both new tests.

- [ ] **Step 3: Add and retire hero copy**

In `lib/site/copy.ts`, in each of the three locale objects, delete the `heroScrollHint:` entry and add these entries directly after that locale's `heroHeadline:` entry:

`ar`:
```ts
  heroEyebrow: 'نقل التصوير الطبي عبر الحدود',
  heroChipUpload: 'رفع يُستأنف',
  heroChipConsent: 'موافقة لطبيب مسمّى',
  heroChipBytes: 'بايتات DICOM الأصلية',
  heroChipBooking: 'موعد بتوقيت البلدين',
```

`fr`:
```ts
  heroEyebrow: "Transfert d'imagerie transfrontalier",
  heroChipUpload: 'Téléversement qui reprend',
  heroChipConsent: 'Consentement nominatif',
  heroChipBytes: "Octets DICOM d'origine",
  heroChipBooking: 'Rendez-vous sur deux fuseaux',
```

`en`:
```ts
  heroEyebrow: 'Cross-border medical imaging transfer',
  heroChipUpload: 'Uploads that resume',
  heroChipConsent: 'Named-doctor consent',
  heroChipBytes: 'Original DICOM bytes',
  heroChipBooking: 'Two-timezone booking',
```

Each chip maps to a scene that proves it (S04, S05, S03/S08, S07) — the §1.4 rule that every claim maps to shipped behaviour.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @mir/web exec vitest run lib/site/copy.test.ts`
Expected: PASS (including the existing parity and §1.4 tests).

- [ ] **Step 5: Write `WordReveal`**

Create `components/corridor/motion/WordReveal.tsx`:

```tsx
'use client';

import { Fragment, createElement, useEffect, useRef, useState } from 'react';
import { onCurtainLifted } from '../../../lib/site/curtain';
import { REVEAL, REVEAL_TIMING, wordStagger, type RevealVariant } from '../../../lib/site/motion';
import { useSite } from '../../../lib/site/site-provider';
import { splitWords } from '../../../lib/site/split';
import { useGsapScope } from '../../../lib/site/use-gsap';

/**
 * Word-by-word blur reveal — spec 2026-09-10 §3.3. Replaces the hero-only
 * HeadlineReveal and generalises it to any heading or paragraph.
 *
 * THE RESTING STATE IS THE CORRECT STATE. The server and Tier C render one
 * text node; the split into word boxes happens after mount, and only on a
 * tier that animates. A word is always one text run, so Arabic keeps its
 * joined forms (lib/site/split.ts).
 *
 * Headings keep their accessible name through `aria-label`, as HeadlineReveal
 * did. `aria-label` is prohibited on a paragraph, so a split paragraph gets a
 * visually hidden copy of the sentence and hides the word boxes instead.
 */
export function WordReveal({
  text,
  as = 'p',
  variant = 'body',
  start = 'view',
  delay = 0,
  id,
  className = '',
}: {
  text: string;
  as?: 'h1' | 'h2' | 'h3' | 'p';
  variant?: RevealVariant;
  /** 'view': when scrolled into view. 'curtain': when the load curtain lifts (hero only). */
  start?: 'view' | 'curtain';
  /** Seconds after the start signal. */
  delay?: number;
  id?: string;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const { budget } = useSite();
  const [split, setSplit] = useState(false);
  const animates = budget.planes > 0;

  useEffect(() => {
    if (animates) setSplit(true);
  }, [animates]);

  useGsapScope(
    animates && split,
    ref,
    ({ gsap }, element) => {
      const units = element.querySelectorAll<HTMLElement>('[data-unit]');
      if (units.length === 0) return undefined;
      const { blur, y } = REVEAL[variant];
      const tween = gsap.fromTo(
        units,
        { opacity: 0, y, filter: `blur(${blur}px)` },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: REVEAL_TIMING.duration,
          ease: 'expo.out',
          stagger: wordStagger(units.length),
          delay,
          paused: start === 'curtain',
          ...(start === 'view'
            ? { scrollTrigger: { trigger: element, start: REVEAL_TIMING.start, once: true } }
            : {}),
          onStart: () => {
            for (const unit of units) unit.style.willChange = 'transform, filter, opacity';
          },
          onComplete: () => {
            // One pass, not per element: dozens of promoted layers left behind
            // is the GPU exhaustion §6.6 warns about.
            for (const unit of units) unit.style.willChange = 'auto';
          },
        },
      );
      return start === 'curtain' ? onCurtainLifted(() => tween.play()) : undefined;
    },
    [animates, split, variant, start, delay, text],
  );

  const heading = as !== 'p';
  const words = split ? splitWords(text) : null;

  const content =
    words === null ? (
      text
    ) : (
      <>
        {heading ? null : <span className="sr-only">{text}</span>}
        <span aria-hidden={heading ? undefined : true}>
          {words.map((word, index) => (
            <Fragment key={`${index}-${word}`}>
              <span data-unit className="reveal-word">
                {word}
              </span>
              {/* A real space between word boxes: it wraps, and it copies. */}
              {index < words.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </span>
      </>
    );

  return createElement(
    as,
    { ref, id, className: className === '' ? undefined : className, 'aria-label': heading ? text : undefined },
    content,
  );
}
```

- [ ] **Step 6: Write `BlurIn`**

Create `components/corridor/motion/BlurIn.tsx`:

```tsx
'use client';

import { useRef, type ReactNode } from 'react';
import { onCurtainLifted } from '../../../lib/site/curtain';
import { REVEAL_TIMING } from '../../../lib/site/motion';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';

/**
 * Block-level blur-in — spec 2026-09-10 §3.3.
 *
 * Opacity, not `autoAlpha`: `autoAlpha` sets `visibility: hidden`, and a
 * control inside a hidden subtree cannot take focus until its reveal has run
 * (the consent test in e2e/corridor.spec.ts learned that the hard way).
 * `data-reveal` is what the e2e reveal guard polls to prove every one of
 * these resolves.
 */
export function BlurIn({
  children,
  className = '',
  delay = 0,
  start = 'view',
}: {
  children: ReactNode;
  className?: string;
  /** Seconds after the start signal. */
  delay?: number;
  start?: 'view' | 'curtain';
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { budget } = useSite();

  useGsapScope(
    budget.planes > 0,
    ref,
    ({ gsap }, element) => {
      const tween = gsap.fromTo(
        element,
        { opacity: 0, y: REVEAL_TIMING.blockY, filter: `blur(${REVEAL_TIMING.blockBlur}px)` },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: REVEAL_TIMING.block,
          ease: 'expo.out',
          delay,
          paused: start === 'curtain',
          ...(start === 'view'
            ? { scrollTrigger: { trigger: element, start: REVEAL_TIMING.start, once: true } }
            : {}),
          ...promoting(element, 'transform, filter, opacity'),
        },
      );
      return start === 'curtain' ? onCurtainLifted(() => tween.play()) : undefined;
    },
    [budget.planes, delay, start],
  );

  return (
    <div ref={ref} className={className === '' ? undefined : className} data-reveal="">
      {children}
    </div>
  );
}
```

- [ ] **Step 7: Rewrite the hero**

Replace `components/corridor/scenes/S01Hero.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { corridorLabels } from '../../../lib/site/corridor-labels';
import { useSite } from '../../../lib/site/site-provider';
import { HelixCanvas } from '../helix/HelixCanvas';
import { BlurIn } from '../motion/BlurIn';
import { WordReveal } from '../motion/WordReveal';
import { StatusPill } from '../primitives/StatusPill';

/**
 * Scene 01 — Hero. Spec 2026-09-10 §4.
 *
 * A full-height mint panel: the sentence on the inline-start side, the
 * particle helix behind and beyond it, and a bottom band of trust line,
 * capability chips and the two routes out. Every horizontal position is a
 * logical property, so Arabic mirrors without a second layout.
 *
 * DOM order is the phone's reading order (copy → helix band → rule → trust →
 * chips → actions); from 1000px up the same elements are placed absolutely.
 * Everything waits for the load curtain, so the entrance is not spent under it.
 */
export function S01Hero(): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const { t, tpl, locale } = useSite();
  const corridor = corridorLabels(locale);
  const chips = [t.heroChipUpload, t.heroChipConsent, t.heroChipBytes, t.heroChipBooking];

  return (
    <section ref={sectionRef} id="hero" className="scene scene--hero" aria-labelledby="hero-headline">
      <div className="hero-copy">
        <WordReveal as="p" variant="eyebrow" start="curtain" text={t.heroEyebrow} className="eyebrow" />
        <WordReveal
          as="h1"
          id="hero-headline"
          variant="display"
          start="curtain"
          delay={0.15}
          text={t.heroHeadline}
          className="display t-hero hero-headline"
        />
        <WordReveal
          as="p"
          variant="body"
          start="curtain"
          delay={0.4}
          text={tpl.heroSubhead(corridor.source, corridor.destination)}
          className="t-body-l subtle hero-subhead"
        />
      </div>

      <HelixCanvas hostRef={sectionRef} entrance="curtain" className="hero-helix" />

      <BlurIn start="curtain" delay={0.7} className="hero-rule-wrap">
        <hr className="hero-rule" />
      </BlurIn>

      <BlurIn start="curtain" delay={0.78} className="hero-trust">
        <p className="hero-trust-line">
          {t.heroTrustLine}
          <span className="hero-trust-rule" aria-hidden="true" />
        </p>
        <StatusPill operationalLabel={t.heroStatusOperational} unknownLabel={t.heroStatusUnknown} />
      </BlurIn>

      <BlurIn start="curtain" delay={0.86} className="hero-chips-wrap">
        <ul className="hero-chips">
          {chips.map((chip) => (
            <li key={chip} className="chip">
              {chip}
            </li>
          ))}
        </ul>
      </BlurIn>

      <BlurIn start="curtain" delay={0.94} className="hero-actions">
        {/*
          `data-testid` values are the ones e2e/public-surface.spec.ts and
          e2e/corridor.spec.ts already know. The scene changed; the contract
          that a visitor lands on a page with these two routes out did not.
        */}
        <Link href="/signup" className="btn btn--primary" data-testid="landing-signup">
          {t.heroCtaPrimary}
        </Link>
        <a href="#problem" className="btn btn--secondary" data-testid="landing-how">
          {t.heroCtaSecondary}
        </a>
      </BlurIn>
    </section>
  );
}
```

- [ ] **Step 8: Delete `HeadlineReveal`**

```bash
git rm apps/web/components/corridor/motion/HeadlineReveal.tsx
```

Run: `grep -rn "HeadlineReveal" apps/web/components apps/web/lib` — expected: no output except comments; update any comment that names it to say `WordReveal`.

- [ ] **Step 9: Replace the hero CSS**

In `app/corridor.css`, delete every rule (and its leading comment block) whose selector begins with `.corridor .scene--hero`, `.corridor .hero-`, `.corridor .slice-poster`, `.corridor .slice-canvas` or `.corridor .headline-word`, plus the `@media (min-width: 700px)` and `@media (min-width: 900px)` blocks that contain only `.hero-trust` / `.hero-hint` rules. Keep `.corridor .slice-counter, .corridor .close-counter { unicode-bidi: plaintext; }` for now (Task 6 removes it).

Then append:

```css
/* ---------------------------------------------------------------------------
 * Scene 01 · hero — spec 2026-09-10 §4.
 * Phones: one column in DOM order. From 1000px: the reference proportions,
 * placed absolutely on a 100lvh panel whose overflow clips the helix.
 * ------------------------------------------------------------------------- */
.corridor .scene--hero {
  --hero-gutter: 1.25rem;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  min-block-size: 100lvh;
  padding: 7rem var(--hero-gutter) 3rem;
  overflow: hidden;
  background-color: var(--c-panel);
  border-end-start-radius: var(--r-section);
  border-end-end-radius: var(--r-section);
}

.corridor .hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.corridor .hero-headline {
  max-inline-size: 13em;
}

.corridor .hero-subhead {
  max-inline-size: 31rem;
  margin: 0;
}

.corridor .hero-helix {
  block-size: 40lvh;
  margin-inline: calc(var(--hero-gutter) * -1);
}

.corridor .hero-rule {
  margin: 0;
  border: 0;
  border-block-start: 1px solid var(--c-line);
}

.corridor .hero-trust {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
}

.corridor .hero-trust-line {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
  color: var(--c-accent);
}

.corridor .hero-trust-rule {
  inline-size: 3.125rem;
  block-size: 1px;
  background-color: currentColor;
}

.corridor .hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.corridor .hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.corridor .reveal-word {
  display: inline-block;
  white-space: nowrap;
}

@media (min-width: 700px) {
  .corridor .scene--hero {
    --hero-gutter: 2.5rem;
  }
}

@media (min-width: 1000px) {
  .corridor .scene--hero {
    display: block;
    block-size: 100lvh;
    min-block-size: 40rem;
    padding: 0;
  }

  .corridor .hero-copy {
    position: absolute;
    inset-block-start: 28.5%;
    inset-inline-start: 2.5rem;
    inline-size: min(44.75rem, 55vw);
    gap: 2rem;
  }

  .corridor .hero-helix {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 22.5rem;
    inline-size: 71.25rem;
    block-size: auto;
    margin: 0;
  }

  .corridor .hero-rule-wrap {
    position: absolute;
    inset-block-start: 78.6%;
    inset-inline: 2.5rem;
  }

  .corridor .hero-trust {
    position: absolute;
    inset-block-start: 83.6%;
    inset-inline-start: 2.5rem;
  }

  .corridor .hero-chips-wrap {
    position: absolute;
    inset-block-start: 83.6%;
    inset-inline-end: 2.5rem;
    max-inline-size: 32rem;
  }

  .corridor .hero-chips {
    justify-content: flex-end;
  }

  .corridor .hero-actions {
    position: absolute;
    inset-block-start: 89.4%;
    inset-inline-start: 2.5rem;
  }
}
```

- [ ] **Step 10: Update the hero e2e tests**

In `e2e/corridor.spec.ts`:

1. In the reveal guard (`'every reveal on the page resolves to full opacity and zero blur'`), change `const planes = page.locator('[data-plane]');` to `const planes = page.locator('[data-plane], [data-reveal]');`.
2. Replace the test `'keeps the hero identical across tiers, so demotion is invisible'` with:

```ts
  test('keeps the hero identical across tiers, so demotion is invisible', async ({ page }) => {
    // §6.3: "If a demotion causes a visible jump, the layout was
    // tier-dependent, which is a bug." The headline and the helix box are the
    // hero's two anchors; neither may move between the best tier and the worst.
    const boxes = async (tier: string) => {
      await page.goto(`/ar?tier=${tier}`);
      await page.waitForTimeout(400);
      return {
        h1: await page.locator('h1').boundingBox(),
        helix: await page.locator('#hero .helix').boundingBox(),
      };
    };

    const a = await boxes('A');
    const c = await boxes('C');
    for (const key of ['h1', 'helix'] as const) {
      expect(a[key], key).not.toBeNull();
      expect(c[key], key).not.toBeNull();
      expect(Math.abs((a[key]?.y ?? 0) - (c[key]?.y ?? 0)), key).toBeLessThan(2);
      expect(Math.abs((a[key]?.height ?? 0) - (c[key]?.height ?? 0)), key).toBeLessThan(2);
    }
  });

  test('puts the helix on the side away from the copy, in both directions (§3.6)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the side-by-side layout starts at 1000px');
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [locale, helixToTheRight] of [
      ['fr', true],
      ['ar', false],
    ] as const) {
      await page.goto(`/${locale}?tier=C`);
      const h1 = await page.locator('h1').boundingBox();
      const helix = await page.locator('#hero .helix').boundingBox();
      const h1Centre = (h1?.x ?? 0) + (h1?.width ?? 0) / 2;
      const helixCentre = (helix?.x ?? 0) + (helix?.width ?? 0) / 2;
      expect(helixCentre > h1Centre, locale).toBe(helixToTheRight);
    }
  });
```

- [ ] **Step 11: Build and run the landing e2e specs**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web exec vitest run && pnpm --filter @mir/web build`
Expected: all exit 0.

Run: `pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts e2e/public-surface.spec.ts --project=chromium`
Expected: PASS, except that the two slice tests (`does not reverse the slice counter under RTL`, `Tier C loads no slice sequence at all`) may fail because the hero no longer renders a slice counter — they are removed in Task 6. Record their failure output; every other test must pass. (The helix posters do not exist until Task 5; the `<img>` has `alt=""`, so a missing file renders nothing.)

- [ ] **Step 12: Commit**

```bash
git add -A apps/web/components/corridor apps/web/lib/site/copy.ts apps/web/lib/site/copy.test.ts apps/web/app/corridor.css apps/web/e2e/corridor.spec.ts
git commit -m "$(cat <<'EOF'
feat(landing): mint hero with the particle helix, word reveals and glass chips

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 5: Posters, WebGL in the test browser, helix e2e

**Files:**
- Create: `scripts/render-helix-poster.mjs`, `public/helix/poster-ltr.avif`, `public/helix/poster-rtl.avif`
- Modify: `playwright.config.ts` (`use`), `lib/site/site-provider.tsx` (forced tier is pinned), `e2e/corridor.spec.ts` (new `describe`)

**Interfaces:**
- Consumes: `HelixCanvas`'s `?helix-still` hook and `data-helix-state` (Task 3); `tierOverride` from `lib/site/tier.ts`.
- Produces: two posters at 1140×900; a forced `?tier=` is never demoted at runtime.

- [ ] **Step 1: Write the failing helix e2e tests**

Append to `e2e/corridor.spec.ts`:

```ts
// ---------------------------------------------------------------------------
// The particle helix — spec 2026-09-10 §5
// ---------------------------------------------------------------------------

test.describe('the helix (spec §5)', () => {
  test('runs on Tier A and keeps drawing', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Tier A is a desktop tier');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');

    const helix = page.locator('#hero .helix');
    await expect(helix).toHaveAttribute('data-helix-state', 'running', { timeout: 20_000 });

    // Two frames apart must differ: a stalled loop or a blank canvas would not.
    const first = await helix.screenshot();
    await page.waitForTimeout(600);
    const second = await helix.screenshot();
    expect(first.equals(second), 'the helix did not move in 600 ms').toBe(false);
  });

  test('builds its particle buffers inside the frame budget (spec §10)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Tier A is a desktop tier');
    await page.goto('/fr?tier=A');
    await expect(page.locator('#hero .helix')).toHaveAttribute('data-helix-state', 'running', {
      timeout: 20_000,
    });
    const ms = await page.evaluate(
      () => performance.getEntriesByName('helix:geometry')[0]?.duration ?? Number.POSITIVE_INFINITY,
    );
    // The spec's budget is 10 ms on a real device; 25 ms is the tripwire on a
    // shared CI machine, and the measured figure goes in the status doc.
    expect(ms).toBeLessThan(25);
  });

  test('is only its poster on Tier C — no canvas at all', async ({ page }) => {
    await page.goto('/fr?tier=C');
    const helix = page.locator('#hero .helix');
    await expect(helix).toHaveAttribute('data-helix-state', 'poster');
    await expect(helix.locator('canvas')).toHaveCount(0);
    await expect(helix.locator('.helix-poster')).toBeVisible();
  });

  test('is only its poster for a reader who asked for reduced motion (§6.8)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/fr');
    const helix = page.locator('#hero .helix');
    await page.waitForTimeout(2500);
    await expect(helix).toHaveAttribute('data-helix-state', 'poster');
    await expect(helix.locator('canvas')).toHaveCount(0);
  });

  test('falls back to its poster when the browser has no WebGL2', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2') return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await page.goto('/fr?tier=A');

    // Wait until the renderer was actually attempted, or this proves nothing.
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName('helix:build').length), {
        timeout: 15_000,
      })
      .toBe(1);
    const helix = page.locator('#hero .helix');
    await expect(helix).toHaveAttribute('data-helix-state', 'poster');
    await expect(helix.locator('.helix-poster')).toHaveCSS('opacity', '1');
  });

  test('ships a poster per direction', async ({ request }) => {
    for (const dir of ['ltr', 'rtl']) {
      const response = await request.get(`/helix/poster-${dir}.avif`);
      expect(response.status(), dir).toBe(200);
      expect(response.headers()['content-type'], dir).toContain('image/avif');
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts --project=chromium -g "the helix"`
Expected: FAIL — at least `ships a poster per direction` (404), and `runs on Tier A` if headless Chromium has no WebGL2 (state stays `poster`).

- [ ] **Step 3: Give headless Chromium WebGL2**

In `playwright.config.ts`, add to the top-level `use` object:

```ts
    // Headless Chromium has no GPU. SwiftShader gives it a software WebGL2 so
    // the helix actually renders in CI; recent Chrome requires the explicit
    // "unsafe" opt-in for it.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
```

- [ ] **Step 4: Pin a forced tier**

A forced tier (`?tier=`) exists so review and the e2e suite can hold one (Landing-Page-Specs §12 L3). The runtime frame-rate demotion ignored it, and under software WebGL it would demote a forced Tier A to C mid-test. In `lib/site/site-provider.tsx`:

1. Change the tier import to `import { DEMOTION, TIER_BUDGET, demoted, detectTier, tierOverride, type Tier, type TierBudget } from './tier';`.
2. Under `const tierRef = useRef<Tier>('C');` add:

```ts
  // A tier forced with `?tier=` is held: that is what forcing it is for
  // (§12 L3). Runtime demotion still protects every real visitor.
  const pinnedRef = useRef(false);
```
3. In `demote`, make the first line `if (pinnedRef.current) return;`.
4. In the detection effect, directly before `const detected = stored ? 'C' : detectTier();`, add `pinnedRef.current = tierOverride(window.location.search) !== null;`.

- [ ] **Step 5: Write the poster script**

Create `scripts/render-helix-poster.mjs`:

```js
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
  const avif = await sharp(png).avif({ quality: 50, effort: 6 }).toBuffer();
  writeFileSync(join(OUT, `poster-${dir}.avif`), avif);

  const ok = avif.length <= BUDGET;
  console.log(`poster-${dir}.avif  ${width}×${height}  ${(avif.length / 1024).toFixed(1)} KB ${ok ? 'OK' : 'OVER 60 KB'}`);
  if (!ok) process.exitCode = 1;
}

await browser.close();
```

- [ ] **Step 6: Render the posters**

Run, in two terminals from the repo root:

```bash
pnpm --filter @mir/web build && pnpm --filter @mir/web start
```
```bash
node apps/web/scripts/render-helix-poster.mjs
```
Expected: `poster-ltr.avif  1140×900  <n> KB OK` and the same for `rtl`. If either is `OVER`, lower `quality` to 42 in the script and re-run. Open both files and check: a teal→lime particle helix leaning top-right→bottom-left (ltr) and top-left→bottom-right (rtl), transparent background.

- [ ] **Step 7: Run the helix tests**

Run: `pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts --project=chromium -g "the helix"`
Expected: PASS (6 tests). Then run the full file on both projects: `pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts` — everything passes except the two slice tests noted in Task 4.

- [ ] **Step 8: Commit**

```bash
git add apps/web/scripts/render-helix-poster.mjs apps/web/public/helix apps/web/playwright.config.ts apps/web/lib/site/site-provider.tsx apps/web/e2e/corridor.spec.ts
git commit -m "$(cat <<'EOF'
feat(helix): rendered posters per direction, WebGL2 in CI, helix e2e

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 6: Retire the slice scrub

**Files:**
- Delete: `components/corridor/motion/ScrubCanvas.tsx`, `components/corridor/primitives/SliceCounter.tsx`, `public/seq/hero/a/`
- Modify: `lib/site/sequence.ts`, `lib/site/tier.ts`, `lib/site/tier.test.ts`, `lib/site/copy.ts`, `lib/site/copy.test.ts`, `lib/site/sound.ts`, `scripts/render-slices.mjs:59,265`, `components/corridor/scenes/S11Close.tsx`, `app/corridor.css`, `e2e/corridor.spec.ts`, `docs/landing-page-status.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TierBudget` = `{ planes, expressive, interactiveDemo, helix }`; `SEQUENCE = { basePath, poster, frames: { b: 24 }, width: 1280, height: 720 }`; `framePath(dir: 'b', index: number): string`; `DEMOTION = { minFps, fpsWindowMs }`; `Cue = 'scene' | 'stamp' | 'complete' | 'press'`.

- [ ] **Step 1: Update the unit tests first**

In `lib/site/tier.test.ts`:
1. Change the import to `import { SEQUENCE, framePath } from './sequence';`.
2. Change the Tier C expectation to `{ planes: 0, expressive: false, interactiveDemo: false, helix: null }` and rename that test to `'gives Tier C no planes, nothing expressive, and no helix'`.
3. Replace the whole `describe('the slice sequence on disk (§6.5)', …)` block with:

```ts
describe('the phantom imagery on disk (§6.5)', () => {
  it('has exactly the Tier B frames the consent thumbnails ask for', () => {
    const files = readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero', 'b'));
    expect(files.filter((f) => f.endsWith('.avif'))).toHaveLength(SEQUENCE.frames.b);
  });

  it('names every frame the way the thumbnails ask for it', () => {
    const files = new Set(readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero', 'b')));
    for (let i = 0; i < SEQUENCE.frames.b; i++) {
      expect(files.has(framePath('b', i).split('/').pop() ?? ''), `frame ${i}`).toBe(true);
    }
  });

  it('no longer ships the Tier A scrub sequence', () => {
    expect(readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero'))).not.toContain('a');
  });

  it('ships the poster the viewer scene shows', () => {
    expect(readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero'))).toContain('poster.avif');
  });

  it('records where the imagery came from (§7.1, §14)', () => {
    expect(readdirSync(join(WEB_ROOT, 'public', 'seq', 'hero'))).toContain('SOURCE.md');
  });
});
```
4. Delete the whole `describe('bisect load order (§6.5)', …)` block.

In `lib/site/copy.test.ts`, change the `'drops the keys only the slice-scrub hero used'` body to:

```ts
    expect(Object.keys(SITE_COPY.ar)).not.toContain('heroScrollHint');
    expect(Object.keys(SITE_COPY.ar)).not.toContain('heroSliceCounterLabel');
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @mir/web exec vitest run lib/site/tier.test.ts lib/site/copy.test.ts`
Expected: FAIL — Tier C still has `sequence`, the `a` directory still exists, `heroSliceCounterLabel` still exists.

- [ ] **Step 3: Delete the scrub and its frames**

```bash
git rm apps/web/components/corridor/motion/ScrubCanvas.tsx apps/web/components/corridor/primitives/SliceCounter.tsx
git rm -r apps/web/public/seq/hero/a
```

- [ ] **Step 4: Shrink `sequence.ts`**

Replace `lib/site/sequence.ts` with:

```ts
/**
 * The phantom CT imagery the landing page still shows — S05's consent
 * thumbnails (three frames of the Tier B set) and S06's viewer poster.
 *
 * `scripts/render-slices.mjs` writes the files and `tier.test.ts` counts them
 * against this table, so a disagreement fails the build rather than leaving a
 * blank thumbnail on a real connection.
 */

export const SEQUENCE = {
  basePath: '/seq/hero',
  poster: '/seq/hero/poster.avif',
  frames: { b: 24 },
  /** Intrinsic size of the poster. */
  width: 1280,
  height: 720,
} as const;

/** Zero-padded frame filename, matching what the render script writes. */
export function framePath(dir: 'b', index: number): string {
  return `${SEQUENCE.basePath}/${dir}/${String(index + 1).padStart(4, '0')}.avif`;
}
```

- [ ] **Step 5: Simplify the tier budget and demotion**

In `lib/site/tier.ts`:
1. Delete from `interface TierBudget` the member `sequence: 'a' | 'b' | null;` and its doc comment.
2. Replace `TIER_BUDGET` with:

```ts
export const TIER_BUDGET: Record<Tier, TierBudget> = {
  A: { planes: 5, expressive: true, interactiveDemo: true, helix: { particles: 36_000, dpr: 2 } },
  B: { planes: 2, expressive: true, interactiveDemo: true, helix: { particles: 14_000, dpr: 1 } },
  C: { planes: 0, expressive: false, interactiveDemo: false, helix: null },
};
```
3. In `DEMOTION`, delete `firstFramesMs` and `sampleFrames` with their comments, leaving `minFps` and `fpsWindowMs`.
4. In the file's header comment, change "Tier B adds the slice sequence at half resolution and two depth planes." to "Tier B adds the helix at 14k particles and two depth planes." and change the `downlink` bullet's "below the point where the sequence helps" to "below the point where the experience helps".

- [ ] **Step 6: Retire the slice copy key and cue**

1. In `lib/site/copy.ts`, delete the `heroSliceCounterLabel:` entry from `ar`, `fr` and `en`.
2. In `lib/site/sound.ts`, change the union to `export type Cue = 'scene' | 'stamp' | 'complete' | 'press';`, delete the `slice: { partials: [2400], … },` entry, delete the comment paragraph that begins "`slice` is the only one that can repeat", and in the header comment change "exactly five sounds: slice tick, scene arrival, consent stamp," to "four sounds: scene arrival, consent stamp,".

- [ ] **Step 7: Stop rendering the Tier A set**

In `scripts/render-slices.mjs`: delete the `a: { width: 1280, height: 720, frames: 36, quality: 44, budget: 260_000 },` line from `TIERS`, and change `const poster = await encode(0, TIERS.a, 58);` to `const poster = await encode(0, { width: 1280, height: 720 }, 58);`.

- [ ] **Step 8: Drop the counter from the close scene**

In `components/corridor/scenes/S11Close.tsx`, delete `import { SLICE_TOTAL } from '../primitives/SliceCounter';` and the element

```tsx
            <span className="mono close-counter" aria-hidden="true">
              {SLICE_TOTAL} / {SLICE_TOTAL}
            </span>
```
(Plan 3 Task 8 redesigns the rest of this scene.)

In `app/corridor.css`, delete the rule `.corridor .slice-counter, .corridor .close-counter { unicode-bidi: plaintext; }` and the rule `.corridor .close-counter { … }`.

- [ ] **Step 9: Remove the retired e2e tests**

In `e2e/corridor.spec.ts`, delete the tests `'does not reverse the slice counter under RTL (§3.6)'` and `'Tier C loads no slice sequence at all'` (the helix `describe` from Task 5 now carries Tier C's "poster only" guarantee).

- [ ] **Step 10: Verify nothing still names the scrub**

Run from `apps/web`: `grep -rnE "ScrubCanvas|SliceCounter|SLICE_TOTAL|bisectOrder|firstFramesMs|sampleFrames|budget\.sequence|heroSliceCounterLabel|cue\('slice'\)|seq/hero/a" app components lib scripts e2e`
Expected: no output.

- [ ] **Step 11: Run everything**

Run: `pnpm --filter @mir/web exec vitest run && pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build`
Expected: all PASS / exit 0.

Run: `pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts e2e/public-surface.spec.ts`
Expected: PASS on both projects.

- [ ] **Step 12: Update the status doc**

In `docs/landing-page-status.md`:
1. §2 tree: the `motion/` entry becomes `FocalReveal, WindowingWipe, WordReveal, BlurIn`; add a line `│   ├── helix/                    HelixCanvas, renderer, shaders, geometry, config`; the `primitives/` entry becomes `Plate, StatusPill`; the `scripts/` entry becomes `render-slices, render-helix-poster, render-corridor-map, render-og, fetch-fonts`.
2. Add these rows to the deviations table:

```markdown
| Scene 01 | CT slice sequence scrubbed by scroll, DICOM HUD, 001/180 counter | Particle DNA helix, raw WebGL2 (spec 2026-09-10 §4–5) | The owner's re-direction. One program, one draw call, positions computed on the GPU from seeded attributes; A 36k / B 14k particles, C the poster. No three.js: the same argument §6.1's handoff deviation made. The Tier A frame set (36 AVIFs) is deleted; the Tier B set stays because S05's consent thumbnails use three of its frames. |
| — | One helix poster, mirrored in RTL | Two posters, `poster-{ltr,rtl}.avif` | Mirroring with `scaleX(-1)` turns a right-handed helix left-handed. The live render leans the other way by negating its roll; the posters are rendered the same way, by the real renderer (`scripts/render-helix-poster.mjs`). |
| §12 L3 | `?tier=` forces a tier | …and holds it | A forced tier was still demoted by the frame-rate check, so under software WebGL a forced Tier A fell to C mid-test. Real visitors are still demoted; a forced tier is not. |
```
3. §6: change the `render-slices.mjs` line comment to `# Tier B frames + viewer poster + SOURCE.md`, and add after it:

```
node apps/web/scripts/render-helix-poster.mjs           # helix posters (needs the app running on :3001)
```
4. §3 budgets: add a line recording the measured `helix:geometry` duration from Task 5's e2e run and the two poster sizes from Task 5 Step 6.

- [ ] **Step 13: Commit**

```bash
git add -A apps/web docs/landing-page-status.md
git commit -m "$(cat <<'EOF'
refactor(landing): retire the slice scrub, counter, Tier A frames and slice cue

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

## Done when

- Unit tests, type check, build, and `e2e/corridor.spec.ts` + `e2e/public-surface.spec.ts` pass on `chromium` and `mobile-chrome`.
- `/fr?tier=A` at 1440×900 shows the mint hero with a teal-to-lime particle helix leaning away from the copy, particles gathering after the curtain, pushing away from the cursor and relaxing back, spinning faster as the hero scrolls out; `/ar` mirrors it; `?tier=C` shows the same layout with the poster.
- No file in `apps/web` references the slice scrub.
