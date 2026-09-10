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
| **L0** Fonts chosen; licences bought if commercial | ✅ | IBM Plex + Reem Kufi + Space Grotesk, all OFL, self-hosted and subset. `app/fonts/README.md` records each file, its role and its bytes. No commercial licence needed; §3.2's optional 29LT upgrade was not taken. |
| **L1** Eleven scenes as static semantic HTML, real copy, correct RTL, **no animation** | ✅ | `e2e/corridor.spec.ts` — "with JavaScript disabled", all three locales, asserts all eleven scene ids, a non-empty `h1`, a visible CTA and eight non-empty FAQ answers with `javaScriptEnabled: false`. |
| **L1** Lighthouse mobile ≥98 / a11y 100 with zero JS — *"the most important gate in this document"* | ⬜ | Lighthouse was not run. The no-JS **correctness** half is verified above; the **score** half is not, and §12 is right that everything after it is additive. See §3 below for the measured budgets, which are the part that decides it. |
| **L2** Tokens, `Plate`, type scale, per-script scaling, grain, focus states | ✅ | `app/corridor.css`. §3.1 palette, §3.2 scale with `--script-scale` 1.08 and `--leading-body` 1.85 under RTL, §3.3 plate with corner ticks, §3.4 grain/scanline/bloom, §3.5 motion tokens. |
| **L2** RTL/LTR parity on all eleven scenes; no horizontal scrollbar | ✅ | `e2e/corridor.spec.ts` — `dir`/`lang` per locale route, and no horizontal overflow at 360 / 768 / 1440 / 2560 px in Arabic **and** English, scrolled to the bottom. §14's four breakpoints. |
| **L2** Stylelint rule banning physical properties | ⬜ | Stylelint is not installed in this repository. The equivalent rule **is** enforced for components: `eslint.config.mjs` fails the build on physical Tailwind utilities in `apps/web/**/*.tsx`, and `corridor.css` is written entirely in logical properties. The gap is that a future physical property in raw CSS would not be caught. |
| **L3** `detectTier()`, provider, runtime demotion, `?tier=` override | ✅ | `lib/site/tier.ts` + `lib/site/site-provider.tsx`; 20 unit tests in `lib/site/tier.test.ts` cover every Tier C exit, the Tier A clause, the override and one-way demotion. |
| **L3** All three tiers render complete layouts; demotion is visually silent | ✅ | `e2e/corridor.spec.ts` — each tier renders all eleven scenes; Tier C requests **zero** sequence frames; the `h1` box differs by <2 px between Tier A and Tier C, which is §6.3's actual requirement (a visible jump means the layout was tier-dependent). |
| **L4** Lenis, GSAP, `ScrubCanvas`, the asset pipeline, the slice counter | ✅ | `lib/site/scroll.ts`, `lib/site/gsap.ts` (dynamic import after LCP), `components/corridor/motion/ScrubCanvas.tsx`, `scripts/render-slices.mjs`. |
| **L4** Sequence within budget; degrades to poster silently | ✅ | `node scripts/render-slices.mjs` — tier a 242.6 KB (budget 260), tier b 81.2 KB (budget 120). §7.1's instruction was followed on the overage: frame count came down 48 → 36, quality did not. |
| **L4** Scrub at 6× on a throttled connection shows a stepping approximation, never a blank frame | 🏠 | Bisect load order is unit-tested (`tier.test.ts`) and `ScrubCanvas` draws the nearest *loaded* frame rather than the requested one. The 6× throttled scrub itself was not performed. |
| **L5** `FocalReveal`, depth planes, windowing wipe, horizontal problem-scroll, consent stamp, two-doors | ✅ | `components/corridor/motion/` and `scenes/`. One pinned element on the page (§6.4), in Scene 02. |
| **L5** CLS ≤0.03 across a scripted scroll | ⬜ | Not measured, and there is a known shift to measure: Scene 02's pin inserts a spacer when ScrollTrigger initialises, moving everything below it once. Every image carries explicit `width`/`height`, so images contribute nothing — but that is an argument, not a measurement. |
| **L6** Interactive simulation, local, keyboard operable, `aria-live` | ✅ | `e2e/corridor.spec.ts` — operated by `focus()` + `Enter` only, asserts the interruption and the resume are announced through `[role=status][aria-live=polite]`, and that no non-GET request is made while it runs. |
| **L5** §2.2 channel 1 — 5 parallax z-planes with continuous focal falloff | ✅ | `FocalReveal` runs two tweens on two nested elements: a scrubbed `y` translation whose rate scales with the plane (the parallax), and a one-shot focus pull on arrival. It first shipped with only the second, so the page had depth for 620 ms and was flat afterwards — which is §3.5's "elements that fly in once and then sit there", the default the brief rules out. Measured in the container: one plane's translate runs +44 → −42.6 → −22 px across its passage. |
| **L7** Cursor light, WebGL handoff, sound, haptics | ✅ | `CursorLight.tsx`, `webgl-handoff.ts` (raw WebGL2, one fullscreen pass, lazily imported, Tier A only), `lib/site/sound.ts` (five synthesised cues, 0 KB of assets), `lib/site/haptics.ts` (two moments, and the type system limits it to two). |
| **L7** Sound off by default; state persists; Tier B stands on its own | ✅ | `e2e/corridor.spec.ts` asserts sound is unchecked and unstored on load. Tier B completeness is asserted structurally (all eleven scenes, interactive demo retained); whether it *feels* complete is a judgement §12 asks a person to make. |
| **L8** Subset fonts, `content-visibility`, layer audit, CSP nonces, cache headers, OG per locale | ◐ | Fonts subset ✅ (the three added faces). OG per locale ✅ (`scripts/render-og.mjs`). `content-visibility` ❌ **removed deliberately** — see the deviations table. Layer audit ⬜. CSP nonces ⬜ — `next.config.mjs` documents at length why a nonce cannot be adopted without forcing dynamic rendering app-wide; that predates this work and is unchanged. Cache headers ⬜ — owned by the edge, which is unconfigured. |
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
│   ├── motion/                   ScrubCanvas, FocalReveal, WindowingWipe,
│   │                             HeadlineReveal, CursorLight, WebGLHandoff
│   └── primitives/               Plate, SliceCounter, StatusPill
├── lib/site/                     tier, scroll, gsap, split, sound, haptics,
│                                 copy, entity, corridor-labels
└── scripts/                      render-slices, render-grain,
                                  render-corridor-map, render-og, fetch-fonts
```

### Deviations from the specification, and why

Each of these is argued in full at the head of the file that makes it.

| § | Spec says | Built as | Why |
|---|---|---|---|
| 7.1 | Render the hero sequence from de-identified TCIA/IDC DICOM | 3D Shepp-Logan phantom, computed | ADR-7 forbids downloaded clinical fixtures; this repository's own corpus is generated byte-by-byte and its pixel data is a gradient. A phantom defined by ten ellipsoids is the strongest available form of §7.3's "provably synthetic": there is no patient for it to have come from. `public/seq/hero/SOURCE.md`. |
| 3.4 | Grain tile 128×128 at ≤3 KB | 64×64 at 32 levels, 2.7 KB | Those two numbers cannot both hold — noise is incompressible, and 128×128 is 3.4 KB even crushed to four grey levels, by which point it bands. The budget is the binding constraint, so the tile shrank instead of the palette. |
| 6.1 | React Three Fiber + drei for the handoff | Raw WebGL2, one fullscreen pass | §2.2 asks for "a single WebGL post-pass" — one program, one triangle, three uniforms. Through R3F that means three.js in the bundle for a scene graph containing one quad, which is §16's first anti-pattern. |
| 3.2 r5 | Split Arabic by grapheme cluster | Split Arabic by **word** | Correct cluster boundaries do not fix the problem: each `<span>` starts a new text run, so a joining script renders in isolated forms whatever the boundaries are. Rule 5's own escape hatch ("animate Arabic by word or line instead") is the only correct reading. `lib/site/split.ts`. |
| Scene 02 | Photograph the CD, phone and calendar | Drawn as hairline SVG | §7.3 bans stock photography, and a photograph of a disc with a handwritten name has to be either staged or real. ~600 bytes each, no request, and in the same vocabulary as the plates holding them. |
| Scene 04 | 180 KB video fallback for Tier B | Interactive demo on Tier B too | The demo is ~2 KB of state machine, not cinema. Spending 180 KB to replace something cheaper that already works is backwards; Tier C still gets the three static states. |
| 3.1 | Palette hexes `#06080B` / `#0C1116` (blue-black) | Same ramp at hue ~30° | §3.1's prose and its hexes disagree: it asks for "warm-dark rather than blue-dark, so it does not read as generic tech" and then specifies blue-black. Built as written, the page was a near-black screen with one bright cyan accent — the most common dark-site treatment there is, and the thing the prose warned against. The accents (phosphor, sand, clay, alert) are unchanged; only the room around them moved. Body copy also moved to `--c-bone-soft` (~11:1) because sustained reading at 14.6:1 on near-black is what makes a dark page tiring. |
| — | An eyebrow label above each of nine headings | One standfirst | Mine, not the brief's. A tracked mono label above every heading is the single most recognisable tell of a generated page, and eight of the nine were a noun repeating the heading beneath them. The one that was an actual sentence became a standfirst; the rest are gone, along with their copy in three languages. |
| — | `text-transform: uppercase` on every mono element | Removed | It made sentences shout and it falsified the records the page shows: log keys are `granted_to`, a digest is `9f2c…a41e`, a locale tag is `en`. A doctor who reads real logs sees the difference, and this page's argument is that its details are real. |
| 8.2 t3 | `content-visibility: auto` on every below-fold scene | Removed | It is incompatible with the scroll choreography, and the failure is silent. It collapses off-screen sections to a `contain-intrinsic-size` placeholder, so every ScrollTrigger below the fold is created against a page height that is never real — reveals fire at the wrong scroll position, or never. Scene 09 rendered as an empty black band on Tier A for exactly this reason, and Tier C was unaffected, so every automated test passed while two scenes were invisible. `e2e/corridor.spec.ts` now asserts that every reveal resolves. |
| Scene 06 | 90 KB AVIF screenshot of the viewer | Live markup in the app's light tokens | §9 forbids text baked into images, and the banner has to be readable in the reader's own language. ~1 KB instead of 90. **Still an illustration, not the real screen** — see the open items. |
| 6.2/10 | Whole app under `app/[locale]/` | Marketing routes only | ~40 signed-in screens already live at unprefixed paths, with an e2e suite and a §4.3 ratchet test referencing them. Moving them is a routing migration, not a landing page. |

---

## 3. §8.1 budgets — measured

Measured over the wire (`encodedBodySize`) against `next start`, Arabic locale,
1440×900. **Not** on the Moto G Power / 2 Mbit / 200 ms profile §8.1 specifies —
that profile has not been used, so treat these as floor values.

| Metric | Budget | Measured | |
|---|---|---|---|
| Critical CSS | ≤18 KB | **13.5 KB** | ✅ |
| Tier A total page | ≤2.5 MB warn | **1.06 MB** | ✅ |
| Tier C total page | ≤450 KB block | **699 KB** | ❌ |
| First-load JS (gz) | ≤110 KB block | **~315 KB** | ❌ |
| LCP / CLS / INP | 2.0 s / 0.03 / 200 ms | not measured | ⬜ |
| Lighthouse mobile / a11y | ≥92 / 100 | not measured | ⬜ |

**Both failures are the application shell, not this page.** Of the 699 KB that
Tier C transfers:

- **314 KB is fonts** — the four IBM Plex Sans Arabic weights the whole product
  shares, one family carrying both scripts (D4).
- **315 KB is JavaScript**, of which the corridor's own share is **24 KB**. The
  rest is the root layout's client tree: `zod` reaches the browser through
  `@mir/contracts`, and `lib/api/mock/*` parses its fixtures with it at module
  load, so ~94 KB gzipped lands on every route including this one.
- **20 KB is this page's images** (poster 13.7, map 9.3, grain 2.7).

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

### Needs a device or a network

- 🔒 **A real mid-range Android on a real slow connection** (§8.3): "every
  synthetic metric is a proxy for this."
- 🔒 **The WhatsApp and Facebook in-app browsers** (§13) — different WebViews,
  different autoplay and font-loading behaviour.
- 🔒 **VoiceOver and TalkBack, in Arabic** (§9). RTL screen-reader behaviour
  has failure modes no automated tool catches.
- 🔒 **Samsung Internet** (§13) — "not optional", substantial North African
  share, and regularly the browser that breaks.

### Needs a tool this repository does not have

- ⬜ **Lighthouse CI** with §8.1's assertions set to `error` (§8.1, §12 L8).
  This is what turns the two failing budgets above into a merge block.
- ⬜ **axe** for the zero-violations claim (§12 L8).
- ⬜ **Stylelint** for the physical-property ban in raw CSS (§12 L2).
- ⬜ **CLS measured across a scripted scroll** (§12 L5). Note that Scene 02's
  pin inserts a spacer when ScrollTrigger initialises, which moves everything
  below it once; `lib/site/scroll.ts` re-aims in-page anchors and deep links
  after each refresh so that shift cannot land someone on the wrong scene, but
  the shift itself is real and is what this measurement would quantify.

### Deliberately not done

- **Analytics** (§11). Plausible or self-hosted Umami is a deployment
  decision and a processor added to the compliance chain; §11's own metric —
  upload-demo interaction rate — cannot be instrumented before that choice is
  made. `data-testid="upload-cut"` is already the hook it will need.
- **`/doctors/tn`** (§1.1). The Tunisian specialist's dedicated route is
  §15's "if the budget were double" item. Scene 09's first door is the
  routing surface it would hang from.
- **A theme control on the landing page.** The page is a darkened reading room
  in both themes by design (§3.1) — a switch there would visibly do nothing.
  `e2e/theme.spec.ts` exercises the toggle on `/pricing` for that reason.

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
node apps/web/scripts/render-slices.mjs                 # hero sequence + poster + SOURCE.md
node apps/web/scripts/render-grain.mjs                  # §3.4 grain tile
node apps/web/scripts/render-corridor-map.mjs ly-tn LY TN   # §Scene 03 map + route module
node apps/web/scripts/render-og.mjs                     # §10 OG cards (needs Playwright)
bash apps/web/scripts/fetch-fonts.sh                    # re-download the three subset faces
```

Each is deterministic. `render-corridor-map.mjs` caches its Natural Earth
source under `apps/web/.map-cache/` (gitignored).

## 7. Reviewing it locally

```bash
pnpm --filter @mir/web build && pnpm --filter @mir/web start
```

Then `/ar`, `/fr`, `/en`. Append `?tier=A`, `?tier=B` or `?tier=C` to force a
tier — §12 L3 requires that override and the e2e suite uses it.
