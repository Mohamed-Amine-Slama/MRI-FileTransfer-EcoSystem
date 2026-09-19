# Landing page — gate status

**Landing-Page-Specs §12 (build plan L0–L9) and §14 (launch checklist).**
"Same gate discipline as the platform spec. Each gate is a hard stop."

---

## How to read this

Same legend as `pre-launch-checklist.md`, and for the same reason:

- ✅ **Verified** — a test or command was run and its output observed. The
  evidence column says which.
- 🏠 **Local** — executed and observed, but against a local stand-in rather
  than the real target. Real evidence, not a substitute. Never counts toward
  launch.
- ⬜ **Open** — not done. No partial credit.
- 🔒 **Blocked** — cannot be done from this repository; needs a person, a
  device, a legal answer, or a real connection.
- 🏛 **Retired** — the gate described code or a measurement the 2026-09-10
  light re-theme removed. Not a current pass/fail; kept for history, with a
  pointer to whatever replaced it.

**Nothing here is checked off on the basis of code review.**

> ### Current headline
> **The page is built and its automated gates pass. It is NOT launchable.**
> Three things block it, none of which is code: the Arabic has not been read
> by a native speaker, there is no registered legal entity in the footer, and
> nobody has opened it on a real phone in Libya. §12 L0 and L9 are the first
> and last gates in the specification and both are human.

---

## 1. Build plan (§12)

| Gate | Status | Evidence |
|---|---|---|
| **L0** Arabic copy written first, reviewed by a Libyan **and** a Tunisian native speaker | 🔒 | Written Arabic-first in `apps/web/lib/site/copy.ts` and marked `⚠ REVIEW GATE` in the file header. §5 is explicit that the register differs between the two countries and that medical vocabulary differs most. Not reviewable from here. |
| **L0** Claims list locked against the platform spec | ✅ | `lib/site/copy.test.ts` — 12 banned patterns across three languages, scanned over `lib/site` and `components/corridor`, plus an exclamation-mark ban (§5 tone rules). The armed-forces adjective trips it even in a comment; `S08Security.tsx` had to be reworded. |
| **L0** Registered legal entity with an address | 🔒 | `lib/site/entity.ts` reads it from the environment, defaults to unset, and `launchBlockers()` lists what is missing. The footer says so out loud rather than showing a plausible fake — §1.4 forbids inventing one, and a convincing fake is the version that ships because it looked finished. |
| **L0** Fonts chosen; licences bought if commercial | ✅ | IBM Plex Sans Arabic (incl. Light 300, complete files carrying both scripts) + IBM Plex Mono + Google Sans Flex (Latin subsets), all OFL, self-hosted. `app/fonts/README.md` records each file, its role and its bytes. No commercial licence needed; §3.2's optional 29LT upgrade was not taken. |
| **L1** Eleven scenes as static semantic HTML, real copy, correct RTL, **no animation** | ✅ | `e2e/corridor.spec.ts` — "with JavaScript disabled", all three locales, asserts all eleven scene ids, a non-empty `h1`, a visible CTA and eight non-empty FAQ answers with `javaScriptEnabled: false`. |
| **L1** Lighthouse mobile ≥98 / a11y 100 with zero JS — *"the most important gate in this document"* | ⬜ | Lighthouse was not run. The no-JS **correctness** half is verified above; the **score** half is not, and §12 is right that everything after it is additive. See §3 below for the measured budgets, which are the part that decides it. |
| **L2** Tokens, type scale, per-script scaling, focus states | ✅ | `app/corridor.css`. §3.1 palette, §3.2 scale with `--script-scale` 1.08 and `--leading-body` 1.5 / `--leading-display` 1.25 under RTL, §3.5 motion tokens. `Plate` (this row used to cite it, and "§3.3 plate") and the grain/scanline/bloom materials were retired by the 2026-09-10 re-theme, along with the rest of the dark room — see the §2 deviation row. `Plate` is replaced by `DemoCard` (`components/corridor/primitives/DemoCard.tsx`); the current §3.3 is "Motion primitives", not a plate. |
| **L2** RTL/LTR parity on all eleven scenes; no horizontal scrollbar | ✅ | `e2e/corridor.spec.ts` — `dir`/`lang` per locale route, and no horizontal overflow at 360 / 768 / 1440 / 2560 px in Arabic **and** English, scrolled to the bottom. §14's four breakpoints. |
| **L2** Stylelint rule banning physical properties | ⬜ | Stylelint is not installed in this repository. The equivalent rule **is** enforced for components: `eslint.config.mjs` fails the build on physical Tailwind utilities in `apps/web/**/*.tsx`, and `corridor.css` is written entirely in logical properties. The gap is that a future physical property in raw CSS would not be caught. |
| **L3** `detectTier()`, provider, runtime demotion, `?tier=` override | ✅ | `lib/site/tier.ts` + `lib/site/site-provider.tsx`; 20 unit tests in `lib/site/tier.test.ts` cover every Tier C exit, the Tier A clause, the override and one-way demotion. |
| **L3** All three tiers render complete layouts; demotion is visually silent | ✅ | `e2e/corridor.spec.ts` — each tier renders all eleven scenes; Tier C requests **zero** sequence frames; the `h1` box differs by <2 px between Tier A and Tier C, which is §6.3's actual requirement (a visible jump means the layout was tier-dependent). |
| **L4** Lenis, GSAP, the asset pipeline | ✅ | `lib/site/scroll.ts`, `lib/site/gsap.ts` (dynamic import after LCP), `scripts/render-slices.mjs`. `ScrubCanvas` and the slice counter (`SliceCounter`) this row used to cite were retired by the 2026-09-10 re-theme along with the CT slice-scrub hero they served (spec §3.4) — see the §2 deviation row. The hero now renders the particle helix (`components/corridor/helix/`); `scripts/render-slices.mjs` still runs, now for Scene 06's illustration and Scene 05's consent thumbnails. |
| **L4** Sequence within budget; degrades to poster silently | 🏛 *pre-re-theme figure* | `node scripts/render-slices.mjs` measured tier a 242.6 KB (budget 260), tier b 81.2 KB (budget 120) before the 2026-09-10 re-theme retired the hero's frame-scrub sequence (spec §3.4). The Tier A frame set (36 AVIFs) is deleted with `ScrubCanvas`; the Tier B set stays, but only for three of S05's consent-panel thumbnails, not a budgeted scrub sequence, so the 81.2 KB figure is no longer a live constraint to re-check. |
| **L4** Scrub at 6× on a throttled connection shows a stepping approximation, never a blank frame | 🏛 *retired gate* | This describes `ScrubCanvas`'s bisect-and-nearest-loaded-frame behaviour, retired with it by the 2026-09-10 re-theme (spec §3.4). The hero no longer scrubs frames by scroll position; nothing in the current build exercises this gate. |
| **L5** `FocalReveal`, depth planes, windowing wipe, horizontal problem-scroll, consent stamp, two-doors | ✅ (mechanics retired and replaced) | `components/corridor/motion/` and `scenes/`. `FocalReveal` and its windowing wipe were retired by the 2026-09-10 re-theme (spec §3.3, §3.4); one-shot reveals are now `BlurIn`/`WordReveal`, and scroll-lit text is `ScrollLitText`. The page's one pinned element (§6.4) moved from Scene 02 to Scene 09's door track (`HorizontalTrack`) — see the §2 deviation row ("Scene 02 | Three plates scrubbed sideways… | Three cards, static"). Horizontal problem-scroll, consent stamp and two-doors are current: `S02Problem.tsx`, `S05Consent.tsx`, `S09Doors.tsx`. |
| **L5** CLS ≤0.03 across a scripted scroll | ⬜ | Not measured, and there is a known shift to measure: the page's one pin (now Scene 09's door track, moved from Scene 02 by the 2026-09-10 re-theme — see the §2 deviation row) inserts a spacer when ScrollTrigger initialises, moving everything below it once. Every image carries explicit `width`/`height`, so images contribute nothing — but that is an argument, not a measurement. |
| **L6** Interactive simulation, local, keyboard operable, `aria-live` | ✅ | `e2e/corridor.spec.ts` — operated by `focus()` + `Enter` only, asserts the interruption and the resume are announced through `[role=status][aria-live=polite]`, and that no non-GET request is made while it runs. |
| **L5** §2.2 channel 1 — 5 parallax z-planes with continuous focal falloff | 🏛 *retired mechanism* | This described `FocalReveal`'s two-tween DOM parallax, retired by the 2026-09-10 re-theme along with the dark room it depended on (spec §3.3, §3.4). "Planes" now names the helix's particle depth layers instead (`lib/site/tier.ts`: Tier A five, Tier B two, Tier C none) — a WebGL rendering budget, not a continuous DOM focal-falloff channel. No current row claims the old channel's behaviour. |
| **L7** Sound, haptics | ✅ | `lib/site/sound.ts` (five synthesised cues, 0 KB of assets), `lib/site/haptics.ts` (two moments, and the type system limits it to two). The cursor light and WebGL handoff this row used to cover were retired by the 2026-09-10 re-theme — see the §2 deviation row. |
| **L7** Sound off by default; state persists; Tier B stands on its own | ✅ | `e2e/corridor.spec.ts` asserts sound is unchecked and unstored on load. Tier B completeness is asserted structurally (all eleven scenes, interactive demo retained); whether it *feels* complete is a judgement §12 asks a person to make. |
| **L8** Subset fonts, `content-visibility`, layer audit, CSP nonces, cache headers, OG per locale | ◐ | Fonts subset ✅ for two of the three added faces (Google Sans Flex, Plex Mono); Plex Arabic Light is a complete file carrying both scripts, not a subset (`app/fonts/README.md`). OG per locale ✅ (`scripts/render-og.mjs`). `content-visibility` ❌ **removed deliberately** — see the deviations table. Layer audit ⬜. CSP nonces ⬜ — `next.config.mjs` documents at length why a nonce cannot be adopted without forcing dynamic rendering app-wide; that predates this work and is unchanged. Cache headers ⬜ — owned by the edge, which is unconfigured. |
| **L8** All §8.1 budgets green in CI; axe zero violations | ⬜ | See §3. Two budgets fail and no Lighthouse CI job exists. Axe was not run. |
| **L9** Five real users — two Libyan doctors, two patients, one Tunisian specialist | 🔒 | Not possible from here. §12's gate is that 4 of 5 describe the product correctly and unprompted after 20 seconds. |

---

## 2. What was built

Eleven scenes, three locales, three tiers.

```
apps/web/
├── app/
│   ├── corridor.css              §3, scoped to .corridor
│   ├── [locale]/page.tsx         /ar /fr /en, SSG, dynamicParams: false
│   ├── sitemap.ts robots.ts      §10
│   └── page.tsx                  `/` renders the corridor for a visitor
├── components/corridor/
│   ├── Corridor.tsx              composition; lang/dir live here
│   ├── scenes/S00…S11            eleven scenes, one file each
│   ├── motion/                   WordReveal, BlurIn, ScrollLitText, StackPanel,
│   │                             HorizontalTrack
│   ├── helix/                    HelixCanvas, renderer, shaders, geometry, config
│   └── primitives/               Card, DemoCard, MirMark, StatusPill
├── lib/site/                     tier, scroll, gsap, split, sound, haptics,
│                                 copy, entity, corridor-labels
└── scripts/                      render-slices, render-helix-poster,
                                  render-corridor-map, render-og, fetch-fonts
```

### Deviations from the specification, and why

Each of these is argued in full at the head of the file that makes it.

| § | Spec says | Built as | Why |
|---|---|---|---|
| 7.1 | Render the hero sequence from de-identified TCIA/IDC DICOM | 3D Shepp-Logan phantom, computed | ADR-7 forbids downloaded clinical fixtures; this repository's own corpus is generated byte-by-byte and its pixel data is a gradient. A phantom defined by ten ellipsoids is the strongest available form of §7.3's "provably synthetic": there is no patient for it to have come from. `public/seq/hero/SOURCE.md`. |
| 3.2 r5 | Split Arabic by grapheme cluster | Split Arabic by **word** | Correct cluster boundaries do not fix the problem: each `<span>` starts a new text run, so a joining script renders in isolated forms whatever the boundaries are. Rule 5's own escape hatch ("animate Arabic by word or line instead") is the only correct reading. `lib/site/split.ts`. |
| Scene 02 | Photograph the CD, phone and calendar | Drawn as hairline SVG | §7.3 bans stock photography, and a photograph of a disc with a handwritten name has to be either staged or real. ~600 bytes each, no request, and in the same vocabulary as the plates holding them. |
| Scene 04 | 180 KB video fallback for Tier B | Interactive demo on Tier B too | The demo is ~2 KB of state machine, not cinema. Spending 180 KB to replace something cheaper that already works is backwards; Tier C still gets the three static states. |
| 3.1 | Palette hexes `#06080B` / `#0C1116` (blue-black) | Same ramp at hue ~30° | §3.1's prose and its hexes disagree: it asks for "warm-dark rather than blue-dark, so it does not read as generic tech" and then specifies blue-black. Built as written, the page was a near-black screen with one bright cyan accent — the most common dark-site treatment there is, and the thing the prose warned against. The accents (then phosphor, sand, clay, alert) were unchanged by this fix — only the room around them moved. Body copy also moved to `--c-bone-soft` (~11:1) because sustained reading at 14.6:1 on near-black is what makes a dark page tiring. The 2026-09-10 re-theme (the row below) has since replaced the whole dark room, accents included. |
| — | An eyebrow label above each of nine headings | One standfirst | Mine, not the brief's. A tracked mono label above every heading is the single most recognisable tell of a generated page, and eight of the nine were a noun repeating the heading beneath them. The one that was an actual sentence became a standfirst; the rest are gone, along with their copy in three languages. |
| — | `text-transform: uppercase` on every mono element | Removed | It made sentences shout and it falsified the records the page shows: log keys are `granted_to`, a digest is `9f2c…a41e`, a locale tag is `en`. A doctor who reads real logs sees the difference, and this page's argument is that its details are real. |
| 8.2 t3 | `content-visibility: auto` on every below-fold scene | Removed | It is incompatible with the scroll choreography, and the failure is silent. It collapses off-screen sections to a `contain-intrinsic-size` placeholder, so every ScrollTrigger below the fold is created against a page height that is never real — reveals fire at the wrong scroll position, or never. Scene 09 rendered as an empty black band on Tier A for exactly this reason, and Tier C was unaffected, so every automated test passed while two scenes were invisible. `e2e/corridor.spec.ts` now asserts that every reveal resolves. |
| Scene 06 | 90 KB AVIF screenshot of the viewer | Live markup in the app's light tokens | §9 forbids text baked into images, and the banner has to be readable in the reader's own language. ~1 KB instead of 90. **Still an illustration, not the real screen** — see the open items. |
| 6.2/10 | Whole app under `app/[locale]/` | Marketing routes only | ~40 signed-in screens already live at unprefixed paths, with an e2e suite and a §4.3 ratchet test referencing them. Moving them is a routing migration, not a landing page. |
| 2–3 | Dark reading room: void ground, phosphor accents, grain, cursor light, WebGL caustic | Light clinical register (spec 2026-09-10) | The owner re-directed the page to a light mint/teal/lime register built around a particle helix. The grain tile, the cursor light and the phosphor handoff pass were dark-room effects — on white they read as dirt — and are removed with their assets. The palette's contrast is now asserted by `lib/site/tokens.test.ts`. |
| Scene 01 | CT slice sequence scrubbed by scroll, DICOM HUD, 001/180 counter | Particle DNA helix, raw WebGL2 (spec 2026-09-10 §4–5) | The owner's re-direction. One program, one draw call, positions computed on the GPU from seeded attributes; A 140k / B 48k particles, C the poster. Re-tuned 2026-09-19 to the owner's reference: a side-on double helix tilted toward the camera, ribbon backbones with dense edges, base-pair rungs, a dust halo, depth of field, and a forest-to-lime palette; each particle's 3D fuzz is hashed from the vertex index on the GPU, which keeps Tier A's geometry build near the old 36k cost. No three.js: the same argument §6.1's handoff deviation made. The Tier A frame set (36 AVIFs) is deleted; the Tier B set stays because S05's consent thumbnails use three of its frames. |
| — | One helix poster, mirrored in RTL | Two posters, `poster-{ltr,rtl}.avif` | Mirroring with `scaleX(-1)` turns a right-handed helix left-handed. The live render leans the other way by negating its roll; the posters are rendered the same way, by the real renderer (`scripts/render-helix-poster.mjs`). |
| §12 L3 | `?tier=` forces a tier | …and holds it | A forced tier was still demoted by the frame-rate check, so under software WebGL a forced Tier A fell to C mid-test. Real visitors are still demoted; a forced tier is not. |
| Scene 02 | Three plates scrubbed sideways (the page's one pin) | Three cards, static | The light re-theme gives the one pin to Scene 09's door track instead, where the cards genuinely overflow the viewport; §6.4 still holds — one pin on the page. |
| Scene 09 | Doctors' card with a list of links | The whole card is one link | Links cannot nest; each door keeps its single `data-testid` and destination, and the doctors' topics are its body text. |
| 3.1 | `--c-ink-subtle` 50%, `--c-ink-muted` 40% | 62% and 45% | The spec's own rule (every text pair ≥ 4.5:1) cannot hold at 50%/40%. `--c-ink-muted` is for text ≥ 24px only; `lib/site/tokens.test.ts` asserts both thresholds. |

---

## 3. §8.1 budgets — measured

Measured over the wire (`encodedBodySize`) against `next start`, Arabic locale,
1440×900. **Not** on the Moto G Power / 2 Mbit / 200 ms profile §8.1 specifies —
that profile has not been used, so treat these as floor values.

**The four rows below are pre-re-theme figures**, captured against the dark-room
build and never re-measured against the 2026-09-10 light re-theme. Nothing
here says they got worse — CSS, fonts and the client JS tree they mostly
measure did not move with the palette — but they are an inherited number, not
a re-theme measurement, and are marked that way rather than implied current.

| Metric | Budget | Measured | |
|---|---|---|---|
| Critical CSS | ≤18 KB | **13.5 KB** *(pre-re-theme, not re-measured)* | ✅ |
| Tier A total page | ≤2.5 MB warn | **1.06 MB** *(pre-re-theme, not re-measured)* | ✅ |
| Tier C total page | ≤450 KB block | **699 KB** *(pre-re-theme, not re-measured; breakdown below)* | ❌ |
| First-load JS (gz) | ≤110 KB block | **~315 KB** *(pre-re-theme, not re-measured)* | ❌ |
| `/[locale]` First Load JS (`next build` output table) | spec §10: unchanged or lower | **255 kB** — unchanged from the pre-refactor build (Task 10a) and unchanged again after the 2026-09-15 dependency bumps (ESLint 10, `globals` 17, `lucide-react`, a dev-dependency batch; HEAD `5f751a3`) | ✅ |
| LCP / CLS / INP | 2.0 s / 0.03 / 200 ms | not measured | ⬜ |
| Lighthouse mobile / a11y | ≥92 / 100 | not measured | ⬜ |
| `helix:geometry` build (spec §10, per idle sample) | ≤10 ms on a real device | **21.1, 21.5, 29.4, 30.3, 32.3 ms** (min 21.1, median 29.4) — WSL2 + software WebGL2 (SwiftShader) + Docker, ~8 GB RAM; not a real device. Re-confirmed after the dark-era primitive removal, three quiet-machine runs (`uptime` load average 1.0–2.6): **27.8, 23.2, 21.5 ms**, all under the 40 ms environment tripwire and inside this same range. The spec §10 ≤10 ms real-device target is still unverified — see §4. | 🏠 |
| Helix posters (`poster-ltr.avif` / `poster-rtl.avif`) | — | **56.9 KB** / **57.6 KB**, both 1140×900, AVIF quality 30 — reconfirmed on disk 2026-09-15, unchanged | ✅ |

The `/[locale]` First Load JS row above is `next build`'s own build-table figure
(spec §10's "first-load JS unchanged or lower" clause) and is **not** the same
measurement as the "First-load JS (gz)" row above it, which is bytes actually
seen over the wire for Tier C, including code split into chunks that load
lazily after LCP (the helix renderer, GSAP, sound/haptics) and so never appear
in the build table's initial-bundle figure. The two are not directly
comparable; each is tracked against its own prior value.

**LCP and CLS were not re-measured in this task.** The spec's §10 target (LCP
< 2.0 s, CLS 0 on "the 3 Mbit profile") has never actually been backed by a
documented, repeatable procedure in this repository — no tool, throttling
preset, or trace method is written down anywhere to re-run "exactly", and this
row has read "not measured" since before the light re-theme. Software-rendered
WebGL2 under WSL2 (the only GPU path available here) would not produce a
timing number representative of a real device in any case. Recording an ad hoc
number under this row's name would misrepresent it as the documented
measurement it is not; the honest state is that §8.1's LCP/CLS/INP budgets
remain unmeasured; a real device and network are what §4 already asks for.

**Both failures are the application shell, not this page.** Of the 699 KB that
Tier C transfers *(pre-re-theme breakdown, not re-measured — see above; the
"grain 2.7" line names an asset the 2026-09-10 re-theme removed entirely, so
this list is kept for its still-true fonts/JS argument, not as a current
inventory)*:

- **314 KB is fonts** — the four IBM Plex Sans Arabic weights the whole product
  shares, one family carrying both scripts (D4).
- **315 KB is JavaScript**, of which the corridor's own share is **24 KB**. The
  rest is the root layout's client tree: `zod` reaches the browser through
  `@mir/contracts`, and `lib/api/mock/*` parses its fixtures with it at module
  load, so ~94 KB gzipped lands on every route including this one.
- **20 KB is this page's images** (poster 13.7, map 9.3, grain 2.7 — the grain
  tile is retired; map and poster are current).

Two levers, both outside a landing page's scope and both worth taking:

1. **Per-script font subsets with `unicode-range`** (§7.2). An Arabic reader
   would stop downloading the Latin glyphs and vice versa — roughly a third of
   314 KB, on every route. It needs hand-written `@font-face` rules rather than
   `next/font`. **Do not instead drop the preload:** that was tried, and it
   moved the viewer's time-to-first-image from 3.1 s to 7.1 s under the P9.1
   throttle, breaking a hard clinical gate. The measurement is recorded in
   `app/layout.tsx`.
2. **Keep zod out of the client bundle.** `lib/i18n/provider.tsx` uses it to
   validate a three-value enum, and the mock API layer parses fixtures with it
   eagerly. Neither needs to.

---

## 4. Open items before launch (§14)

Grouped by who can close them.

### Needs a person

- 🔒 **Arabic reviewed by a Libyan and by a Tunisian speaker.** §5, and the
  single highest-value item on this list. Machine-recognisable Arabic on a
  medical site is instantly disqualifying.
- 🔒 **Registered entity name, address and data-protection contact.** Set
  `NEXT_PUBLIC_SITE_ENTITY_*` (documented in `apps/web/env.d.ts`). Until then
  the footer says the details are pending, which is the honest state.
- 🔒 **Terms, privacy and consent policy pages**, and the URLs to link them.
  Not drafted here: every claim must map to a signed legal answer (§1.4).
- 🔒 **Someone from Sfax or Tripoli looks at the map** before launch (§Scene 03).
- 🔒 **§12 L9 user testing** — five people, screen-recorded, no prompting.
- ⬜ **A real screenshot of the viewer** to replace Scene 06's illustration
  (§14). Needs a running API and seeded data.
- ⬜ **The OG card checked in an actual WhatsApp thread** (§10) — that is how
  this product spreads. The Arabic card renders with correct shaping and was
  inspected; WhatsApp's own rendering was not.
- 🔒 **Owner's visual sign-off of the light re-theme against the reference.**
  The per-scene screenshot set from the Task 10b review lived under
  `retheme-look/` in `/tmp`, which is ephemeral — it is already gone, and
  screenshots are never committed to the repository. To regenerate the
  evidence: follow Plan 3's Task 10 Step 5 capture procedure
  (`docs/superpowers/plans/2026-09-10-retheme-3-scenes-chrome.md`) — save its
  script outside the repo, run it against `pnpm --filter @mir/web start`, and
  look at every screenshot against that step's checklist. Capture the
  viewport matrix at **1440×900, 390×844, 1920×1080, 1024×660, ~1180×800 and
  1280×720**, `ar` and `fr` (the last three added by this fix wave, to cover
  the short/laptop-width range its hero-copy overlap and header-wrap fixes
  target), plus the Tier C hero poster and a 1024×768 header check. The four
  items below are what the Task 10b review could not close by itself.
- 🔒 **Hero helix colour reads pale yellow-green, not "dusty… deep teal far,
  lime near".** Consistent across every viewport captured (1440/390/1920,
  `ar`/`fr`) — it reads as a pale mint-green ghost on the mint panel rather
  than showing depth-based colour separation. Not changed here per the
  controller's ruling (an open design decision, not a bug). If the owner asks
  for a change, it is a `helix-config.ts` / shader tuning pass, and **any
  change requires re-rendering both posters** with
  `scripts/render-helix-poster.mjs` against a fresh build on a free port,
  watching the 60 KB poster budget (currently 56.9/57.6 KB, little headroom).
- 🔒 **Wide-screen hero containment.** At 1920×1080 the hero's copy sits 40px
  from the viewport edge (full-bleed, per spec §4.1) while every other scene
  sits inside a centred ~1440px column — measured (`fr`, tier A): hero H1 left
  edge 40px, Scene 02's `<h2>` left edge 336px. Deliberate per the spec text,
  but visually inconsistent at very wide viewports; not changed here per the
  controller's ruling.
- 🔒 **No `/signup` path from the header below 1100px.** `.chrome-cta` (the
  teal "register" pill, sharing `heroCtaPrimary`'s copy) only turns on at
  `min-width: 1100px` (`app/corridor.css`); confirmed absent at 1024×768
  (`fr`) while the nav, controls and sign-in link all still fit without
  overflow at that width. The hero's own two CTAs remain reachable by
  scrolling, so this is a header-only gap, not a missing page path; needs an
  owner decision on whether the header should carry a signup affordance
  between 900px and 1099px.
- ⬜ **The OG card (`public/og/*.png`) is still the dark-room design** — void
  ground, phosphor-style accents, and even the retired "001 / 180" slice
  counter (removed from the *template* by Task 10a but never re-rendered into
  the PNGs; files dated 2026-09-09, before the re-theme spec). This is **not**
  an owner decision — the light register was already decided (spec
  2026-09-10) — it needs a light restyle plus a re-render via
  `scripts/render-og.mjs` to catch up to it. Not attempted here: it is a
  design pass on its own, not a bug fix.

### Needs a device or a network

- 🔒 **A real mid-range Android on a real slow connection** (§8.3): "every
  synthetic metric is a proxy for this."
- 🔒 **The WhatsApp and Facebook in-app browsers** (§13) — different WebViews,
  different autoplay and font-loading behaviour.
- 🔒 **VoiceOver and TalkBack, in Arabic** (§9). RTL screen-reader behaviour
  has failure modes no automated tool catches.
- 🔒 **Samsung Internet** (§13) — "not optional", substantial North African
  share, and regularly the browser that breaks.
- 🔒 **A real-device `helix:geometry` measurement** (spec §10). The only
  measurement so far is 21.1–32.3 ms (median 29.4) on WSL2 + software WebGL2
  (SwiftShader) + Docker — a proxy for a real GPU, not evidence about one. If
  a real device exceeds the spec's 10 ms budget, the remedy is to chunk the
  particle-buffer build across frames (spec §10) rather than build it in one.
- 🔒 **Helix GPU frame time at Tier A on integrated graphics** (spec §10
  target ≤ 2 ms). SwiftShader in CI proves correctness, not speed.

### Needs a tool this repository does not have

- ⬜ **Lighthouse CI** with §8.1's assertions set to `error` (§8.1, §12 L8).
  This is what turns the two failing budgets above into a merge block.
- ⬜ **axe** for the zero-violations claim (§12 L8).
- ⬜ **Stylelint** for the physical-property ban in raw CSS (§12 L2).
- ⬜ **CLS measured across a scripted scroll** (§12 L5). Note that the page's
  one pin (Scene 09's door track, moved from Scene 02 by the 2026-09-10
  re-theme — see the §2 deviation row) inserts a spacer when ScrollTrigger
  initialises, which moves everything below it once; `lib/site/scroll.ts`
  re-aims in-page anchors and deep links after each refresh so that shift
  cannot land someone on the wrong scene, but the shift itself is real and is
  what this measurement would quantify.

### Deliberately not done

- **Analytics** (§11). Plausible or self-hosted Umami is a deployment
  decision and a processor added to the compliance chain; §11's own metric —
  upload-demo interaction rate — cannot be instrumented before that choice is
  made. `data-testid="upload-cut"` is already the hook it will need.
- **`/doctors/tn`** (§1.1). The Tunisian specialist's dedicated route is
  §15's "if the budget were double" item. Scene 09's first door is the
  routing surface it would hang from.
- ~~A theme control on the landing page~~ **Built, not skipped.** This row
  was wrong: `CorridorChrome.tsx` ships `ThemeControl`
  (`components/corridor/CorridorControls.tsx`) in the header, next to the
  language control, per §7.3. The page itself still stays in its own light
  palette in both themes — that is what the 2026-09-10 re-theme made true of
  the *whole* page, not only the parts drawn before it — so the control
  reaches the platform's other pages, not this one, and someone who flips it
  here and sees nothing change deserves to know why rather than to wonder
  (the control's own note says so). `e2e/theme.spec.ts` still drives the
  toggle from `/pricing`, because asserting `data-theme` from the landing
  page would prove nothing about whether the toggle works.

---

## 5. The container

`apps/web/Dockerfile` had no `COPY` for `public/`. `output: 'standalone'` does
not include it, so nothing under it existed in the image — invisible in
development, because `next dev` serves `public/` from the source tree.

Two things were 404ing in the container and nowhere else:

- `/theme-init.js`, the pre-paint theme script. Without it `data-theme` is only
  applied after hydration, so every container-served page load flashed white at
  a user who had chosen dark — the one failure that script exists to prevent.
  This predates the landing page.
- `/seq`, `/map`, `/grain`, `/og` — the hero sequence, poster, corridor map,
  grain tile and share cards. The hero would have rendered as an empty plate.

One `COPY` line fixes both. Rebuild and recreate with:

```bash
docker compose --profile apps build web
docker compose --profile apps up -d --force-recreate web
```

The full e2e suite passes against the container, not only against
`next start` — which is where the tier-promotion race in the upload demo
surfaced.

## 6. Running the asset pipeline

All output is committed; a deploy needs none of this.

```bash
node apps/web/scripts/render-slices.mjs                 # Tier B frames + viewer poster + SOURCE.md
node apps/web/scripts/render-helix-poster.mjs [baseUrl] # helix posters — a fresh build served on a free port, passed as the script's first argument (the default, :3001, is a stale Docker container in this environment; see the script's own header)
node apps/web/scripts/render-corridor-map.mjs ly-tn LY TN   # §Scene 03 map + route module
node apps/web/scripts/render-og.mjs                     # §10 OG cards (needs Playwright)
bash apps/web/scripts/fetch-fonts.sh                    # re-download the vendored landing faces + OFL
```

Each is deterministic. `render-corridor-map.mjs` caches its Natural Earth
source under `apps/web/.map-cache/` (gitignored).

## 7. Reviewing it locally

```bash
pnpm --filter @mir/web build && pnpm --filter @mir/web start
```

Then `/ar`, `/fr`, `/en`. Append `?tier=A`, `?tier=B` or `?tier=C` to force a
tier — §12 L3 requires that override and the e2e suite uses it.
