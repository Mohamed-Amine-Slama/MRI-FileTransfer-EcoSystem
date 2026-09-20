# Platform Re-theme — Application to the Corridor Register — Design

**Date:** 2026-09-20
**Status:** Approved in conversation; pending spec review
**Branch:** `feat/frontend-uplift`
**Scope of this spec:** the signed-in application and the public non-landing surface —
`app/globals.css`, `components/ui/**`, `components/shell/**`, and a sweep of all 15 route
groups under `app/`. The landing page (`app/corridor.css`, `components/corridor/**`) is
**not** touched.

---

## 1. Why

The landing page was re-themed to a light clinical register on 2026-09-10 (see
`2026-09-10-landing-light-retheme-design.md`): white ground, mint panels, one teal accent,
one lime highlight. The signed-in application still wears the original "modern
institutional" palette — blue `#1d5c9e` on blue-grey neutrals.

The result is one product with two identities. A user who signs up from the landing page
lands on a screen that looks like different software. The owner asked for the rest of the
platform — dashboards, login and sign-in screens, and everything else — to match.

### What this overturns

`app/globals.css` and `app/corridor.css` both carry comments arguing the split is
load-bearing, citing a "§4.1" that requires the signed-in product to read as *"calm,
professional, precise, not flashy"* while the landing page does the opposite.

**That section does not exist in any live spec file.** `BUILD_SPEC.md`,
`platform-requirements.md` and `Landing-Page-Specs.md` contain no such text. The
requirement survives only as code comments referencing a document that no longer says it.
Those comments are therefore treated as stale and are **rewritten** as part of this work
(§8) rather than left contradicting the code they sit above.

The underlying concern is still respected, and that is what the "bridged" decision in D1
is for: the register changes, the density does not.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | How literal is the match? | **Bridged.** Full corridor palette and a display typeface, but clinical density preserved: 14px radii rather than 24–48px, readable weights at small sizes, no added padding. |
| D2 | What happens to dark mode? | **Kept.** A dark counterpart is derived from the same teal/mint/lime family. The `mir.theme` toggle and all three states (light / dark / system) survive unchanged. |
| D3 | How far does typography reach? | **Headings only, Latin only.** Display headings use Google Sans Flex 300; Arabic headings stay on IBM Plex Medium, already loaded. Body, tables, labels and form text are unchanged. |
| D4 | How does the palette reach the token layer? | **Re-point in place.** Token names and the `@theme inline` mapping are unchanged; only values change. No screen edits are required for colour. |
| D5 | `--input` fails WCAG 1.4.11 today (1.56:1 against a 3:1 minimum). Fix or preserve? | **Fix.** New values clear 3:1 against both card and page in both themes. |

### Why D4 and not a shared palette module

Extracting a brand ramp that both `.corridor` and `:root` consume is the better end state —
it makes drift impossible. It is deferred, not rejected, because it edits `app/corridor.css`
and the test that parses it (`lib/site/tokens.test.ts`) while the helix work on `mir-32` is
still in flight. It can be layered on afterwards as a pure refactor with no visual change.

## 3. Palette

Every value below is verified against WCAG 2.2 AA by the test added in §7.1: 22 pairs,
both themes, zero failures. Text pairs clear 4.5:1; UI boundary pairs clear 3:1.

### 3.1 Light

| Token | Value | Derivation |
|---|---|---|
| `--background` | `#eff4f2` | corridor `--c-panel` |
| `--foreground` | `#0e1a17` | green-tinted ink |
| `--card` | `#ffffff` | corridor `--c-ground` |
| `--card-foreground` | `#0e1a17` | |
| `--muted` | `#e5edea` | |
| `--muted-foreground` | `#4a5f59` | 6.84:1 on card |
| `--border` | `#d5e0dc` | hairline |
| `--input` | `#828e8a` | 3.40:1 on card, 3.05:1 on page (D5) |
| `--primary` | `#246f65` | corridor `--c-accent` |
| `--primary-foreground` | `#ffffff` | |
| `--secondary` | `#e5f1ed` | corridor `--c-panel-deep` |
| `--secondary-foreground` | `#054038` | corridor `--c-accent-deep` |
| `--accent` | `#eaf3f0` | |
| `--accent-foreground` | `#1a5d54` | |
| `--ring` | `#246f65` | |
| `--destructive` | `#b3261e` | corridor `--c-alert` |
| `--destructive-foreground` | `#ffffff` | |
| `--success` / `--success-surface` | `#14663f` / `#e2f2e9` | |
| `--warning` / `--warning-surface` | `#7a4b00` / `#fbf0dc` | |
| `--danger` / `--danger-surface` | `#b3261e` / `#fbe9e7` | |
| `--info` / `--info-surface` | `#1a5d54` / `#e4f0ed` | |
| `--sidebar` | `#f8fbfa` | a step back from `--card` |
| `--sidebar-foreground` | `#0e1a17` | |
| `--highlight` | `#f8ffb4` | corridor `--c-lime` — **new** |
| `--highlight-edge` | `#e5ed9b` | corridor `--c-lime-edge` — **new** |
| `--highlight-foreground` | `#2a3d00` | 11.30:1 on lime — **new** |
| `--marketing-from` / `--marketing-to` | `#e5f1ed` / `#eff4f2` | |
| `--marketing-ink` | `#054038` | |

### 3.2 Dark

| Token | Value |
|---|---|
| `--background` | `#0c1412` |
| `--foreground` | `#e9f1ee` |
| `--card` / `--card-foreground` | `#14201d` / `#e9f1ee` |
| `--muted` / `--muted-foreground` | `#1a2724` / `#9bb3ac` |
| `--border` / `--input` | `#26332f` / `#5f6b67` |
| `--primary` / `--primary-foreground` | `#5fb3a3` / `#04211c` |
| `--secondary` / `--secondary-foreground` | `#1e2e2a` / `#cfe6df` |
| `--accent` / `--accent-foreground` | `#182823` / `#8fd3c4` |
| `--ring` | `#5fb3a3` |
| `--destructive` / `--destructive-foreground` | `#f4a49c` / `#3d0f0b` |
| `--success` / `--success-surface` | `#8fd6aa` / `#0f2e1c` |
| `--warning` / `--warning-surface` | `#f2cd93` / `#362810` |
| `--danger` / `--danger-surface` | `#f4a49c` / `#3a1511` |
| `--info` / `--info-surface` | `#8fd3c4` / `#0f2b26` |
| `--sidebar` / `--sidebar-foreground` | `#101a17` / `#e9f1ee` |
| `--highlight` / `--highlight-edge` | `#e8f59b` / `#cbd97e` |
| `--highlight-foreground` | `#22300a` |
| `--marketing-from` / `--marketing-to` | `#12241f` / `#0c1412` |
| `--marketing-ink` | `#d9ece6` |

The dark palette is written **twice** — once under `@media (prefers-color-scheme: dark)`
with `:root:not([data-theme='light'])`, once under `:root[data-theme='dark']` — exactly as
today. The existing rationale comment stays; `lib/theme/tokens.test.ts` already asserts the
two blocks agree, and that assertion keeps its full force here.

### 3.3 The three new tokens

`--highlight*` are additions, so they need an `@theme inline` mapping
(`--color-highlight`, `--color-highlight-edge`, `--color-highlight-foreground`) and values
in **all three** blocks (light, and both dark blocks), or `lib/theme/tokens.test.ts` fails
on the "overrides every colour the light block declares" assertion. This is the one place
where the re-theme can break that test, and it is the reason the tokens are listed
explicitly here rather than left to implementation.

## 4. Shape and typography

### 4.1 Radius

`--radius`: `0.5rem` → `0.875rem` (14px). The derived scale in `@theme inline`
(`--radius-sm/md/lg/xl`) is unchanged in form and follows automatically.

### 4.2 Display typeface

`sansFlex` (Google Sans Flex, variable 300–500, already vendored at
`app/fonts/GoogleSansFlex-latin.woff2`) moves from `components/corridor/fonts.ts` to a new
neutral module **`lib/fonts.ts`**, and is re-exported from `components/corridor/fonts.ts`
so `CORRIDOR_FONT_CLASS` is unchanged. `app/layout.tsx` applies `sansFlex.variable` to the
root element alongside the existing Plex variable.

`plexMono` and `plexArabicLight` **stay landing-only**. The application does not gain a
weight-300 Arabic face, so the decision recorded at `lib/site/fonts.test.ts:42` —
`app/layout.tsx` must not reference `IBMPlexSansArabic-Light` — remains true and its
assertion is **not** edited.

A new `--font-display` token resolves to
`var(--font-sans-flex), var(--font-plex), system-ui, sans-serif`. Arabic has no 300 weight
available app-wide, so Arabic headings fall through to `--font-plex` at their current
weights. RTL therefore gets the palette and shape match but not the display typeface — an
accepted limit of D3, not an oversight.

**One test does need editing.** `lib/site/fonts.test.ts` builds its `referenced` list by
scanning exactly two files. Moving `sansFlex` to `lib/fonts.ts` would make
`GoogleSansFlex-latin.woff2` invisible to that scan, and the "ships no face that nothing
loads" assertion would fail on a face that is in fact loaded. The fix is to add
`lib/fonts.ts` to the scan list — one line, preserving the assertion's intent exactly.

## 5. Component changes

Colour needs no component edits (D4). These five files cover everything values cannot
express:

| File | Change |
|---|---|
| `components/ui/button.tsx` | New `highlight` variant: `bg-highlight text-highlight-foreground border-highlight-edge`, for the primary CTA. `rounded-md` follows the new scale. |
| `components/ui/card.tsx` | `CardTitle` gains `font-display`. |
| `components/ui/index.tsx` | `PageHeader` title and `SectionHeading` gain `font-display`. |
| `components/ui/stat.tsx` | `StatTile` figure gains `font-display`; **keeps `tabular-nums`** so counts do not jitter. |
| `components/shell/AppChrome.tsx`, `components/shell/PublicChrome.tsx` | Nav active state moves to the teal-on-mint treatment (`bg-secondary text-secondary-foreground`). |

### 5.1 Where the lime goes

The lime highlight is the landing page's signature and the easiest thing to overuse. It is
allowed on **one element per screen**: the primary call to action. It is not a status
colour, not a hover state, and not a background. Status stays with
`--success/--warning/--danger/--info`.

## 6. Surface sweep

Token changes carry the screens, but each route group is opened in both themes to catch
what tokens cannot fix — a bespoke radius, a one-off spacing value, a contrast pair only
visible in context:

- **Auth:** `login`, `signup`, `signup/provider`, `signup/verify`, `reset-password`,
  `invite/[token]`, `verification`
- **App:** `workspace`, `cases`, `cases/[ref]`, `cases/new`, `patients`, `patients/[id]`,
  `patients/new`, `ledger`, `notifications`, `upload`, `profile`, `doctor`,
  `doctor/availability`
- **Settings:** `settings`, `settings/billing`, `settings/notifications`, `settings/team`
- **Admin:** `admin/audit`, `admin/cases`, `admin/ledger`, `admin/providers`
- **Public:** `pricing` — the `--marketing-*` gradient tokens retune to mint/teal so it
  sits with the landing page rather than against it

## 7. Testing

### 7.1 Unit (vitest)

- `lib/theme/tokens.test.ts` — **passes unchanged.** It asserts light/dark structural
  parity and that every `@theme` utility resolves to a real token. Both hold by
  construction, including for the three new `--highlight*` tokens.
- **New** `lib/theme/contrast.test.ts` — parses the three palette blocks out of
  `app/globals.css` and asserts all 22 pairs from §3 meet their minimum (4.5:1 text,
  3:1 UI) in both themes. This is what stops a future value edit from silently
  reintroducing the `--input` defect D5 fixes.
- `lib/site/fonts.test.ts` — scan list extended by one line (§4.2); all assertions keep
  their current meaning.
- `lib/site/tokens.test.ts` — untouched; it parses `.corridor`, which this work does not
  modify.

### 7.2 Full suite and build

`pnpm lint` (the no-physical-direction rule in `eslint.config.mjs` still applies to every
class added), `pnpm test`, and a production build.

### 7.3 Visual review

Each route group in §6, in light and dark, LTR and RTL. Specific checks: table rows at
density, badge legibility at 12px, the viewer's black canvas against the new chrome, and
focus rings on mint surfaces.

## 8. Documentation

- The stale "§4.1 / not flashy" comments in `app/globals.css` are rewritten to describe
  the register that actually ships and to record that the marketing/application split is
  now about density and motion, not palette.
- The `.corridor` header comment in `app/corridor.css` is **not** edited (file untouched);
  its claim that the app uses a different palette becomes outdated and is corrected when
  the shared-ramp refactor lands.
- `docs/decisions.md` gains an entry recording D1–D5 and the retirement of the split.

## 9. Build order

1. Palette: rewrite the three blocks + `@theme inline` additions in `app/globals.css`;
   set `--radius`. Add `lib/theme/contrast.test.ts`. **Gate:** `pnpm test` green.
2. Fonts: add `lib/fonts.ts`, re-export from corridor, apply in `app/layout.tsx`, add
   `--font-display`, extend the `fonts.test.ts` scan list. **Gate:** `pnpm test` green.
3. Components: the five files in §5.
4. Sweep: §6, route group by route group, both themes.
5. Docs: §8.

Each step is independently revertable; step 1 alone delivers most of the visible change.

## 10. Out of scope

- `app/corridor.css` and `components/corridor/**` — the landing page keeps its own file
- The shared brand-ramp refactor (deferred; see §2)
- The DICOM viewer canvas at `app/viewer/[studyUid]/page.tsx:275` keeps `bg-black` —
  diagnostic images need a neutral surround regardless of theme
- Any density, spacing, layout or copy change
- Arabic display weight 300 app-wide (D3)

## 11. Risks

| Risk | Mitigation |
|---|---|
| The three new `--highlight*` tokens break `tokens.test.ts` if added to only one block | §3.3 lists all three blocks explicitly; step 1's gate catches it immediately |
| Teal `--primary` and teal `--info` are close enough to blur status meaning | `--info` is `#1a5d54` against `--primary` `#246f65`; if they read as one colour in review, `--info` moves to a distinct hue |
| A preloaded face on every route costs the viewer's P9.1 budget | Only `sansFlex` is promoted, not all three; measured in step 2 and reverted to Plex-only headings if the budget regresses |
| The owner commits WIP mid-session, so the tree can land on `main` at any time | No temporary hacks in tracked files at any step; every step ends green |
