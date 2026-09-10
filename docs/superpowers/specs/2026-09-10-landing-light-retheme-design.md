# Landing Light Re-theme & Particle Helix Hero — Design

**Date:** 2026-09-10
**Status:** Approved in conversation; pending spec review
**Branch:** `feat/frontend-uplift`
**Scope of this spec:** the public landing page (`components/corridor/**`, `app/corridor.css`,
`lib/site/**`) only. The signed-in application's theme is untouched.

---

## 1. Why

The corridor landing page is built as a dark reading room: near-black ground, ivory type,
phosphor accents, a CT slice-scrub hero. The owner wants a different register — a light,
clinical, calm look built around an interactive particle DNA helix — taking its visual
direction from a reference site the owner supplied (a light mint/teal/lime medical
landing page).

That is a whole-page change, not a hero swap: a light hero on top of a dark page would
read as two sites stitched together.

### Provenance rule

The reference supplies **direction only**: palette values, layout proportions, and a
motion vocabulary (word blur-reveal, blur-in blocks, pinned card track, stacked panels,
scroll-lit text, a pointer-reactive particle helix). Everything shipped is original:

- The helix renderer and shaders are written from scratch for this repo (raw WebGL2).
  No code, shader, or bundle is taken from the reference.
- All copy is MIR's own, from `lib/site/copy.ts`. New keys are written for MIR.
- No marks, logos, photographs, or other assets from the reference. Image cards use
  MIR's own synthetic phantom CT renders.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | How far does the new look reach? | Whole landing page re-themed to the light palette. |
| D2 | What happens to scenes 02–11? | Keep all content and interactive demos; re-skin, and give each scene the reference mechanic that fits it (§7.2). |
| D3 | Typefaces | Google Sans Flex (Latin, vendored) + IBM Plex Sans Arabic, adding a Light 300 file for Arabic display. Reem Kufi and Space Grotesk leave the landing page. |
| D4 | Helix renderer | Raw WebGL2 point sprites, one program, one draw call. No three.js (consistent with `webgl-handoff.ts`'s rationale and the §8.1 budget). |

## 3. Foundations

### 3.1 Palette tokens

The dark-room token names (`--c-void`, `--c-bone`, `--c-phosphor`, `--c-sand`, …) are
**removed**, not repointed — a token named "void" holding white would mislead every future
reader. Every usage in `corridor.css` and the corridor components migrates to:

| Token | Value | Role |
|---|---|---|
| `--c-ground` | `#ffffff` | page background |
| `--c-panel` | `#eff4f2` | mint section surface (hero, stacked panels) |
| `--c-panel-deep` | `#e5f1ed` | deeper mint alternate |
| `--c-ink` | `#000000` | headlines, body |
| `--c-ink-muted` | `rgb(0 0 0 / 0.4)` | secondary text, unlit scroll text |
| `--c-ink-subtle` | `rgb(0 0 0 / 0.5)` | metadata |
| `--c-line` | `rgb(0 0 0 / 0.1)` | hairlines, chip and card borders |
| `--c-accent` | `#246f65` | eyebrows, primary pills, teal cards, rules |
| `--c-accent-deep` | `#054038` | primary pill border / hover |
| `--c-on-accent` | `#ffffff` | text on teal |
| `--c-lime` | `#f8ffb4` | secondary pills, lime cards |
| `--c-lime-edge` | `#e5ed9b` | lime border / hover |
| `--c-glass` | `rgb(255 255 255 / 0.8)` | header, menu sheet |
| `--c-glass-soft` | `rgb(255 255 255 / 0.5)` | chips, FAQ items, glass cards |
| `--c-glass-strong` | `rgb(255 255 255 / 0.9)` | CTA card in S11 |
| `--glass-blur` | `10px` | backdrop blur for all glass |
| `--c-alert` | `#b3261e` | errors (darkened from `#ff6b6b` to hold contrast on white) |
| `--r-section` | `48px` | section corners |
| `--r-card` | `24px` | cards, panels, FAQ items |
| `--r-chip` | `37px` | chips |
| `--r-pill` | `46px` | pills / buttons |
| `--r-tile` | `8px` | logo tile, small squares |
| `--ease-entrance` | `cubic-bezier(.2, 0, 0, 1)` | every reveal |
| `--dur-fast` / `--dur-normal` | `150ms` / `250ms` | hover / state transitions |

Contrast (computed, WCAG 2.x): teal on white 5.9:1, teal on mint 5.4:1, white on teal
5.9:1, ink on lime > 15:1. All pairs used for text must be ≥ 4.5:1 — enforced by test (§9.1).

### 3.2 Typography

- **Latin (fr, and any Latin-script locale):** Google Sans Flex, variable 300–500, Latin +
  Latin-ext subset, vendored as woff2 under `app/fonts/` via `next/font/local`. Verify the
  licence file when vendoring (Google Fonts hosts only openly licensed faces); if it turns
  out not to permit self-hosting, fall back to Figtree (OFL) with the same scale.
- **Arabic:** IBM Plex Sans Arabic (already the app's face). Add
  `IBMPlexSansArabic-Light.woff2` (300) for display sizes. Body stays on the existing 400.
- **Scale:**
  - Display (h1, section titles): weight 300, 60px / 1.1 at desktop, 48px tablet, 40px phone.
  - Card titles: 300, 32px / 1.1.
  - Body: 300 (Latin) / 400 (Arabic), 16px.
  - Eyebrows: 500, 14px, `--c-accent`, uppercase for Latin only.
  - Pills: 300, 20px.
- **Arabic line-height override** under `:lang(ar)`: display 1.25, body 1.5. The Latin 1.1 /
  1.2 values clip Arabic ascenders and descenders.
- Font loading keeps the current `preload: false` policy for display faces unless the §10
  LCP measurement shows the headline swap costing LCP.

### 3.3 Motion primitives (`components/corridor/motion/`)

All built on the existing single Lenis + GSAP/ScrollTrigger system (`lib/site/scroll.ts`,
`lib/site/gsap.ts`) and the existing script-aware split (`lib/site/split.ts` — Arabic splits
by word, never by letter).

| Primitive | Behaviour | Tier C / reduced motion |
|---|---|---|
| `WordReveal` (generalises `HeadlineReveal`) | Per word: opacity 0→1, blur→0, y→0. Variants: `display` (blur 20px, y 60px), `body` (12px, 16px), `eyebrow` (12px, 12px). 0.9s, `--ease-entrance`, 40ms stagger, once. Hero plays after the load curtain; elsewhere at ScrollTrigger `top 85%`. | Final state, no split. |
| `BlurIn` | Block-level opacity 0→1, blur 12px→0, y 1.25rem→0, 0.8s, once, optional stagger across children. | Final state. |
| `ScrollLitText` | Words go `--c-ink-muted` → `--c-ink`, scrubbed from paragraph `top 75%` to `bottom 45%`. | Fully lit. |
| `StackPanel` | Section with 48px top corners that slides over the previous one. Sticky with `top: min(0px, 100lvh − panel height)` (height measured by ResizeObserver into `--panel-h`) so a panel taller than the viewport scrolls fully before it sticks. Stacking turns on only after measurement (`.is-stacking`). | Normal flow; panels still overlap by −48px with rounded tops, so the layout is the same without the slide. |
| `HorizontalTrack` | Pinned section; the card row translates on the inline axis over `+=overflow` of scroll (negated in RTL). | Native `overflow-x: auto` row with `scroll-snap-type: x mandatory`. Also used for coarse pointers. |

### 3.4 Retired

Removed from the landing page with their CSS: the grain overlay, `CursorLight`,
`WebGLHandoff` + `webgl-handoff.ts` (phosphor caustic), plate scanlines, the hero DICOM HUD
and reticle, `ScrubCanvas` and the `/seq/hero/{a,b}/` frame sequences (used only by the
hero), and `SliceCounter` (S11's `SLICE_TOTAL` import goes with it — S11 is redesigned in
§7.2). `SEQUENCE.poster` (`/seq/hero/poster.avif`) **stays**: S06 renders it, and the
`image` card variant uses it. `lib/site/sequence.ts` shrinks to the poster's metadata.
`S00Load` stays and is restyled to a mint curtain.

## 4. Hero (S01)

Breakpoints are the corridor's existing ones: tablet type scale from `700px`, header nav
from `900px`, and the absolute hero layout below from `1000px`.

### 4.1 Layout — desktop (`min-width: 1000px`)

A full-height (`100lvh`) `--c-panel` section with `--r-section` bottom corners,
`overflow: hidden`. Every horizontal position is a logical property, so Arabic mirrors.

| Element | Position | Content |
|---|---|---|
| Copy block | top 28.5%, inline-start 40px, width ≈ 44.75rem | `heroEyebrow` (new) → `heroHeadline` (h1, `WordReveal display`) → `heroSubhead` (existing template, `WordReveal body`, max ≈ 31rem) |
| Helix | full height, inline-start ≈ 22.5rem, width ≈ 71rem (clipped by the section) | `HelixCanvas` over the poster, `pointer-events: none` |
| Divider | top 78.6%, inline 40px → 40px | 1px `--c-line` |
| Trust row | top 83.6%, inline-start 40px | `heroTrustLine` in `--c-accent` + 50px accent rule + existing `StatusPill` |
| CTAs | top 89.4%, inline-start 40px | Primary teal pill `heroCtaPrimary` → `/signup` (`data-testid="landing-signup"`); secondary lime pill `heroCtaSecondary` → `#problem` (`data-testid="landing-how"`). Height 48px, `min-width: 11.25rem` (not fixed — Arabic labels are longer). |
| Chips | top 83.6%, inline-end 40px, max-width ≈ 32rem, wrap, end-aligned, 4px gap | `heroChips` (new): glass chips, `--r-chip`, 1px `--c-line`, 16px/300, padding 16px 32px |

### 4.2 Layout — below `1000px`

Normal flow, `min-height: 100lvh`, padding 112px top / 48px bottom, 20px (phone) / 40px
(tablet) inline: copy block → full-bleed helix band (`40lvh`, negative inline margins) →
divider → trust row → chips (wrap, start-aligned) → CTAs.

### 4.3 New copy keys (all three locales in `SITE_COPY`: `ar`, `fr`, `en`)

| Key | ar | fr | en |
|---|---|---|---|
| `heroEyebrow` | نقل التصوير الطبي عبر الحدود | Transfert d'imagerie transfrontalier | Cross-border medical imaging transfer |
| `heroChips` | رفع يُستأنف · موافقة لطبيب مسمّى · بايتات DICOM الأصلية · موعد بتوقيت البلدين | Téléversement qui reprend · Consentement nominatif · Octets DICOM d'origine · Rendez-vous sur deux fuseaux | Uploads that resume · Named-doctor consent · Original DICOM bytes · Two-timezone booking |

(Owner may reword; the chips must stay true to shipped behaviour — each maps to a scene.)
Keys that only served the retired hero (`heroScrollHint`, `heroSliceCounterLabel`) are
deleted with their usages.

### 4.4 Entrance choreography

After the `S00Load` curtain lifts: eyebrow words → headline words → subhead words
(`WordReveal`, overlapping by ~40%); the helix assembles (particles travel from a seeded
scatter to their helix positions over 1.6s, delayed along the strand); divider, trust row,
CTAs, chips `BlurIn` with 80ms stagger. Whole sequence ≤ 1.8s. Tier C / reduced motion:
everything present at first paint, no sequence.

## 5. Helix renderer (`components/corridor/helix/`)

### 5.1 Files

| File | Responsibility |
|---|---|
| `helix-geometry.ts` | Pure. `buildHelix({ count, seed })` → typed arrays of per-particle attributes. No DOM, no GL. Unit-tested. |
| `helix-shaders.ts` | GLSL ES 3.00 vertex + fragment source strings. |
| `helix-renderer.ts` | Imperative GL: context, program, buffers, uniforms, draw, resize, dispose, context loss/restore. No React. |
| `HelixCanvas.tsx` | React client component: poster `<img>`, lazily imported renderer, loop control, pointer and scroll inputs, `data-helix-state`. |
| `helix-config.ts` | Every tunable constant (counts per tier, radius, turns, tilt, spin, colours, sizes, pointer radius/strength) in one place. |

### 5.2 Geometry

Seeded PRNG (mulberry32) so the poster, tests, and live render agree.

Per particle attributes: `kind` (0 strand A, 1 strand B, 2 rung, 3 dust), `t` ∈ [0,1]
along the helix, `seed` (vec4: radial jitter, angular jitter, size, colour/brightness),
`scatter` (vec3 start position for the assembly).

Distribution: strands 45% (split evenly), rungs 15% (on ~26 evenly spaced base pairs,
points along the chord between the strands), dust 40% (wide gaussian jitter around the
strands — this is the "halo" that gives the helix depth).

### 5.3 Shaders

**Vertex**
1. Helix position: angle = `t · turns · 2π + uTime · spin + strandPhase` (strand B offset
   by π); radius `R` plus per-kind gaussian jitter; y = `(t − 0.5) · length`. Rungs lerp
   between the two strands' points at their base-pair `t`.
2. Dust drift: low-frequency 3D value-noise displacement scaled by `seed` and
   `uScroll`.
3. Assembly: `mix(scatter, helixPos, easeOutExpo(clamp(uAssemble · 1.35 − t · 0.35)))`.
4. Global transform: roll ≈ −28° so the helix runs corner to corner (sign flipped when
   `uMirror = 1` for RTL); gentle yaw oscillation ±6°.
5. Perspective projection; point size and alpha fall off with depth (far = smaller,
   fainter, deeper teal).
6. Pointer repulsion in screen space: particles within `pointerRadius` (≈ 16% of the
   canvas's shorter side) of `uPointer` are pushed radially outward by up to ~38px ×
   `uPointerStrength` with a smooth falloff. `uPointerStrength` eases toward 1 while the
   pointer moves over the section and springs back to 0 (~600ms) on leave / idle.

**Fragment:** soft round sprite (gaussian falloff from `gl_PointCoord`); colour chosen
along a ramp `#054038 → #246f65 → #4f8a3c → #9fbf4a → #e5ed9b` by `seed`, position along
the strand, and depth (near → lighter/lime, far → deep teal). Output premultiplied.

**Blending:** premultiplied "over" (`ONE, ONE_MINUS_SRC_ALPHA`), no depth test. Additive
blending is not used — it washes out to white on a light ground.

### 5.4 Runtime (`HelixCanvas`)

- Server and first client render: the poster `<img>` only (explicit width/height,
  `aria-hidden`, `decoding="async"`). The canvas mounts on top of it, absolutely
  positioned, so CLS stays 0.
- The renderer module is dynamically imported from an idle callback after LCP, like GSAP.
- WebGL2 context with `alpha: true, premultipliedAlpha: true, antialias: false`. DPR
  capped per tier. `ResizeObserver` drives resize.
- The rAF loop runs only while the section intersects the viewport and the tab is visible
  (IntersectionObserver + `visibilitychange`). No permanent rAF.
- Inputs: `pointermove` / `pointerleave` on the host section, mapped to canvas-relative
  coordinates (direction-agnostic). Coarse pointers get no repulsion. `uScroll` = the host
  section's ScrollTrigger progress (hero leaving the viewport speeds the spin ×3 and loosens
  the dust ×1.6).
- `data-helix-state`: `poster` → `loading` → `running` ⇄ `paused`; `lost` on context loss.
- A `matchMedia('(prefers-reduced-motion: reduce)')` change at runtime stops the loop and
  returns to `poster`.

### 5.5 Tiers

| Tier | Particles | DPR cap | Pointer | Scroll coupling |
|---|---|---|---|---|
| A | 36,000 | 2 | yes | yes |
| B | 14,000 | 1 | yes | yes |
| C / reduced motion / no WebGL2 | — (poster only, renderer never imported) | — | — | — |

Particle count and DPR cap are added to the existing tier budget in `lib/site/tier.ts`.

### 5.6 Poster

`public/helix/poster.avif`, rendered from the real renderer at `uTime = 0`,
`uAssemble = 1`, by `scripts/render-helix-poster.mjs` (Playwright screenshot → `sharp` →
AVIF; both are existing dev dependencies). One file; RTL mirrors it with
`transform: scaleX(-1)`, matching `uMirror`. Target ≤ 60 KB.

### 5.7 Failure handling

| Failure | Behaviour |
|---|---|
| No WebGL2, context creation fails, shader compile/link fails | Stay on `poster`; `console.warn` once in development only. Never throws into React. |
| `webglcontextlost` | `preventDefault()`, stop the loop, state `lost` (poster visible). |
| `webglcontextrestored` | Rebuild program and buffers, resume if visible. |
| Renderer chunk fails to load | Stay on `poster`. |

### 5.8 Reuse in S11

`S11Close` renders a second `HelixCanvas` (inline-start half of its panel). Each instance
runs only while intersecting, so at most one animates at a time.

## 6. Card primitive

`components/corridor/primitives/Card.tsx` replaces `Plate` for all scene cards.

- `--r-card`, tall ratio (≈ 0.88 width:height on desktop), 32px padding.
- Top: optional index (`02`) and a 32px/300 title. Bottom: a label at inline-start and a
  72px outlined circular arrow button at inline-end (arrow mirrored in RTL). Hover/focus:
  circle fills `--c-lime`, arrow nudges 2px along its direction, `--dur-normal`.
- Variants: `lime` (ink text; optional link list with `--c-line` dividers and arrows),
  `teal` (`--c-on-accent` text), `glass` (`--c-glass-soft` + blur + `--c-line` border),
  `image` (`SEQUENCE.poster` — MIR's synthetic phantom CT frame — under a dark gradient
  overlay, white text).
- Pills (`.btn--primary`, `.btn--secondary`) and chips get the same token treatment.

## 7. Scenes, chrome, footer

### 7.1 Surfaces

Page ground is `--c-ground`. Mint surfaces are the hero, the stacked demo panels, and S11.

### 7.2 Scene mapping

Content, copy keys, interactive behaviour, and `data-testid`s are preserved in every scene.

| Scene | Treatment |
|---|---|
| S02 Problem | Section title (`WordReveal`) + three tall `Card`s, `BlurIn` staggered: CD (`glass`), film photos (`teal`), waiting (`lime`). Existing artefact SVGs recoloured to the palette. |
| S03 Corridor | Centred eyebrow; title + body as a `ScrollLitText` paragraph; source and destination as two chips joined by a teal rule. |
| S04 Upload demo | `StackPanel` (mint). Demo in a white card: teal progress, lime "interrupt" control, glass readouts. |
| S05 Consent | `StackPanel` (deep mint). Document as a white paper card; thumbnails as glass tiles. |
| S06 Viewer | `StackPanel` (white). Re-skinned; copy unchanged. |
| S07 Appointment | `StackPanel` (mint). The two time zones as chips; slot in a white card. |
| S08 Security | Title + 4×2 grid over the existing `SECURITY_ROWS`: each `term` (untranslated, as today) in 48px/300 in the "stat" slot, its translated `descKey` beneath, 1px `--c-accent` rule at inline-start. `securityStatusNote` in a glass callout. |
| S09 Doors | `HorizontalTrack`: teal lead card (`doorsEyebrow`), doctors `lime` card (link list), patients `image` card. Desktop cards ≈ 44vw wide so the row overflows and the pin travels ~1 viewport. |
| S10 FAQ | Glass accordion on native `<details>`: `--r-card`, `--c-glass-soft` + blur, rotating plus icon. |
| S11 Close | `StackPanel` (mint): helix at inline-start; white `--c-glass-strong` card at inline-end with logo tile, `closeLine` (display), teal `closeCta` + lime `closeSecondary` pills. |

### 7.3 Header (`CorridorChrome`)

Floating, 16px from the top: a white tile holding a teal logo square with the MIR mark;
a `--c-glass` nav pill with the four anchor links; at inline-end, sign-in link, locale
chip, and a teal "register" pill with a lime circular arrow. Below the desktop breakpoint:
tile + a glass menu square; the menu opens as a glass sheet. Existing `data-detached`
behaviour and anchor targets are kept.

### 7.4 Footer (`CorridorFooter`)

`--c-ground`, 1px `--c-line` top edge; existing links, legal text, and status re-set in
the new type and tokens. No new content.

## 8. Tier and preference matrix

| Feature | A | B | C | Reduced motion |
|---|---|---|---|---|
| Helix | 36k, DPR ≤ 2 | 14k, DPR 1 | poster | poster |
| Word/block reveals | yes | yes | final state | final state |
| Scroll-lit text | scrubbed | scrubbed | lit | lit |
| Stack panels | sliding | sliding | static overlap | static overlap |
| Doors track | pinned | pinned | swipe row | swipe row |
| Lenis | yes | yes | native | native |

Layout (element boxes) is identical across A/B/C — the existing §6.3 rule.

## 9. Testing

### 9.1 Unit (vitest)

- `helix-geometry.test.ts`: same seed → identical buffers; per-kind counts sum to N and
  match the configured split; all `t` in [0,1]; tier budgets map to the configured counts.
- `tokens.test.ts`: parses `corridor.css` custom properties and asserts every text pair in
  §3.1 is ≥ 4.5:1.
- `copy.test.ts`: `heroEyebrow`, `heroChips`, and any new keys exist and are non-empty in
  every locale; retired keys are gone.
- `tier.test.ts`: new budget fields per tier.

### 9.2 E2E (Playwright — existing specs are edited, not bypassed)

Kept: hero CTAs visible (`landing-signup`, `landing-how`), exactly one `.marketing`, anchor
navigation, locale/RTL checks.

Retired with the CT hero: slice-counter RTL test; "Tier C loads no slice sequence".

New / replaced:
- Tier C, reduced motion, and a forced no-WebGL2 context each: no WebGL context created,
  `data-helix-state="poster"`, poster visible.
- Tier A: reaches `data-helix-state="running"`; canvas pixels are not blank.
- Hero element boxes match across `?tier=A|B|C`.
- `ar`: helix region is on the opposite side from the copy block.
- S09 track pins and releases on desktop Tier A; is a swipe row under reduced motion.
- S04 upload demo still completes and still resumes after an interrupt (existing test,
  retargeted selectors if needed).

### 9.3 Visual review

Screenshots at 1440×900 and 390×844, `ar` and `fr`, hero plus each scene, reviewed next to
the reference captures before any "done" claim.

## 10. Budgets (§8.1)

- First-load JS unchanged or lower: the helix renderer (~8 KB gz target) is lazy, after LCP.
- Particle buffers are generated on the client (nothing downloaded). Generation ≤ 10ms at
  Tier A; otherwise chunk across frames.
- Helix GPU ≤ 2ms/frame at Tier A on integrated graphics.
- Bytes: remove the hero `/seq/hero` AVIF sequence from the hero path and Reem Kufi / Space
  Grotesk from the page; add Google Sans Flex (Latin) and Plex Arabic Light.
- LCP < 2.0s on the 3 Mbit profile; CLS 0.
- `docs/landing-page-status.md` §3 is re-measured, not estimated.

## 11. Documentation

- This spec.
- `docs/landing-page-status.md`: a §2 "Deviations from the specification" entry (light
  re-theme, retired effects, scene mapping, raw WebGL2 helix); §3 re-measured budgets; §6
  asset-pipeline notes updated (helix poster script; retired CT sequence if deleted).
- Code comments citing retired sections (§2.1 concept C, scrub, HUD, phosphor caustic) are
  rewritten or deleted with their code.

## 12. Build order

Three sub-projects, each landing as its own commits on the branch:

1. **Foundations** — tokens, fonts, motion primitives, `Card`, pills/chips, retire
   dark-room effects.
2. **Hero + helix** — S01 layout, `helix/` module, poster script, tier budgets, hero tests.
3. **Scenes + chrome** — S02–S11 mapping, header, footer, remaining tests, status doc.

The page is visibly half-themed between 1 and 3; acceptable on the branch, not shippable
to `main` until 3 is complete.

## 13. Out of scope

- The signed-in application's theme and components.
- New claims, statistics, or content beyond the new hero eyebrow/chips keys.
- Stock photography.
- Sound and haptics behaviour (kept as-is unless tied to a retired element, in which case
  that binding is removed).

## 14. Risks

| Risk | Mitigation |
|---|---|
| Premultiplied blending of dense particles looks muddy rather than dusty on white. | All knobs in `helix-config.ts`; tune against the reference captures during visual review. |
| Sticky stacking, Lenis, and a pinned track fight over ScrollTrigger measurement. | One `ScrollTrigger.refresh()` after fonts and after panel measurement; e2e covers pin/release. |
| Google Sans Flex licence doesn't permit self-hosting. | Checked at vendoring time; fallback Figtree (OFL). |
| Arabic word reveals at 60px lift feel heavy on long lines. | `display` variant lift is a token; reduce for `:lang(ar)` if review says so. |
| Uncommitted work already on this branch touches the same files. | Owner commits or stashes it before implementation starts, so the re-theme diff is reviewable on its own. |
