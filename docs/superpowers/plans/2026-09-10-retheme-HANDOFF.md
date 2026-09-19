# Landing Light Re-theme — Session Handoff

The re-theme, the WebGL2 helix hero and the 2026-09-19 helix re-tune are implemented, reviewed and verified. What remains is a list of owner calls, none of which blocks anything. Read this first; trust `git log` over it.

Earlier versions: the implementation kickoff is `git show cb9c267:docs/superpowers/plans/2026-09-10-retheme-HANDOFF.md`; the "finish the branch" version is at `368df49`.

## State (2026-09-19, evening)

| Item | Status |
|---|---|
| Branch | `feat/frontend-uplift`. |
| `main` | Has the whole re-theme: the owner merged it through `8b510f3` as PR #98. Anything after that commit is not on `main` yet. |
| Re-theme | **Done at `d21cbf2`** — plans 1, 2 and 3, each task reviewed, each plan closed by a whole-branch review and one fix wave. |
| Helix re-tune | **Done.** `8b510f3` (owner) and `368df49` (owner) carry another session's (mir-32) rework: ribbon backbones, a groove offset, pitch toward the camera, depth of field, per-backbone lighting, a forest-to-lime palette, 140k/48k particles, and each particle's fuzz and entrance scatter hashed from `gl_VertexID` instead of uploaded. Recorded in spec §16. |
| Door-card fix | **Done** in `368df49`: `HorizontalTrack`'s `focusin` handler returns unless the target matches `:focus-visible`, with an e2e that presses a half-hidden door with the mouse. |
| Geometry tripwire | **Done** in `368df49`: the e2e always records `helix:geometry:hero` as an annotation and asserts 40 ms only under `MIR_PERF_TRIPWIRE=1`. |
| Uncommitted | mir-32's last helix commit (see "What is uncommitted"). |

## Verification (2026-09-19, on the tree described below)

- `pnpm --filter @mir/web lint`, `typecheck`: pass. `eslint e2e/corridor.spec.ts` (the lint script does not cover `e2e/`): pass.
- `test` (Vitest): **228 / 228**.
- E2E, both projects (chromium + mobile-chrome), one worker: **197 passed, 10 skipped, 1 failed**. The skips are by design (desktop-only or mobile-only cases).
- The failure is `focal reveals … every reveal on the page resolves to full opacity and zero blur` on mobile-chrome, at 34.6 s against Playwright's default 30 s per-test timeout, with a load average of ~10 from a second session. Rerun alone, 3× per project: all pass, 22.6–25.1 s. **It is the machine, not the page**: the same test with WebGL2 stubbed out (no helix at all) still takes 24.9 and 27.8 s, so the re-tuned helix is not the cost. The test sweeps ~80 reveals, scrolling to each; it needs most of its 30 s budget even idle. If it keeps flaking, give that one test an explicit longer timeout — it is a whole-page sweep, not a unit of work that should fit in 30 s.

## What is uncommitted

mir-32's final helix commit, in the working tree, reviewed here and verified by the run above:

- `helix-geometry.ts` / `.test.ts`, `helix-renderer.ts`, `helix-shaders.ts` — the entrance scatter moves to a GPU hash, so the `aScatter` attribute is gone.
- `public/helix/poster-{ltr,rtl}.avif` re-rendered for the new look; `scripts/render-helix-poster.mjs` now writes AVIF quality 22 at 4:2:0 (56.5 / 55.9 KB, against the script's 60 KiB budget).
- `next.config.mjs` — the TEMP `distDir` line is gone. `tsconfig.json` — restored to its `d21cbf2` form (staged).

Plus this session's docs: spec §16, and the status doc's geometry, poster and helix-colour entries.

**Next step: commit all of it and open a PR to `main`.** Nothing else is pending.

## Review findings (2026-09-19)

Reviewed: `8b510f3`, `368df49` and the uncommitted helix work.

- **A device below ~4 fps is never demoted** (Important, not fixed). `windowFps` in `lib/site/tier.ts` discards any 2 s window holding a frame longer than `DEMOTION.stallMs` (250 ms), and `site-provider.tsx` is the only caller. A device at 3 fps has every frame over 250 ms, so no window is ever scored and the one-way demotion never fires — for exactly the device that needs it. Before `368df49` a 3 fps device was demoted after one window. The median plus `DEMOTION.strikes` already absorbs a lone long frame (a debugger pause, a GC), which is what the stall rule was for, so the narrower rule is: discard a window only when it holds too few frames to judge.
- **`8b510f3` was half a change** (resolved by `368df49`). It committed helix *config* the committed renderer did not read, so the page drew neither the old helix nor the new one.
- **Its lockfile change is sound**: it re-synced a lockfile that had drifted from the manifests. `pnpm install --frozen-lockfile --lockfile-only` passes at HEAD.

## Open items for the owner

**Copy (needs the Arabic review)**
- `themeAppliesToApp` in `apps/web/lib/i18n/dictionary.ts` (ar :438, fr :1023, en :1627) still tells visitors "this page stays dark". The landing page is light now. Needs new copy in all three locales.
- The mobile menu's `nav` landmark reuses the "Questions" label (`t.navQuestions`); a dedicated label needs a new copy key.

**Design calls**
- Whether the re-tuned helix now reads as depth rather than a pale ghost, across the viewport matrix in the status doc's visual-review item.
- Wide-screen hero: the hero copy is anchored to the viewport edge (spec §4.1's "inline-start 40px"), so it drifts from every other scene's centred 1440 px shell — 32 px at 1440, 296 px at 1920, 640 px at 2560.
- No /signup link in the header below the 1100 px CTA breakpoint.
- The OG share cards (`apps/web/public/og/*.png`) are still the dark design. The template (`apps/web/scripts/render-og.mjs`) was updated to the new fonts and lost the retired slice counter, so template and committed PNGs differ until a light restyle and re-render.
- S04's readouts and S05's thumbnail tiles are not glass surfaces as spec §7.2 describes (they look fine as built).
- The door links' accessible names.
- S11 is a `StackPanel` outside `.stack-group` (documented, not changed).
- The helix stretches with the hero on viewports shorter than ~800 px (the hero grows past one viewport there so the copy never overlaps the bottom band).

**Needs a person**
- Moving the cursor over the helix by hand.
- The Tier B poster crossfade.
- LCP and CLS were not re-measured (no repeatable method is documented).
- A real-device `helix:geometry` measurement against spec §10's ≤ 10 ms. This environment now measures 42–85 ms at 140k particles.

**Git**
- Four already-pushed commits lack the session trailer (`c68a708`, `bc47ea3`, `fab7e61`, `d39986b`). Pushed history was never amended; rewriting it is the owner's call.

## Rulings that still bind future work

- **Posters.** Any helix tuning must re-render both posters (`scripts/render-helix-poster.mjs <baseUrl>`, against a fresh build on a free port — its default `:3001` is a stale Docker container here). They are 56.5 and 55.9 KB against the script's 60 KiB `BUDGET`, at AVIF quality 22, 4:2:0.
- **Geometry tripwire.** 40 ms is an environment regression guard, not the spec budget, and it is opt-in (`MIR_PERF_TRIPWIRE=1`). Chunking the geometry build across frames was deliberately not done.
- **Anchors.** `flowTop()` in `lib/site/scroll.ts` measures a sticky panel with `position: 'static'` (not `relative`, which keeps the panel's negative inset and lands anchors short on tall panels). An e2e covers it on mobile-chrome.
- **Reveals survive a drop to Tier C.** `ScrollLitText` and `WordReveal` un-split when animation turns off mid-visit (FPS demotion or the footer's reduce-motion switch). Keep that both-ways behaviour.
- **Hero layout.** The copy sits in the hero grid's first row; the section is `min-block-size: 100lvh`; the bottom band (divider, trust row, CTAs, chips) is a content-sized grid. The spec's 78.6 / 83.6 / 89.4 % positions are the reference's measurements at 1440×900, not invariants; the binding intent is order and alignment.
- **Header.** `.chrome-link` is `white-space: nowrap`; the CTA breakpoint stays at 1100 px (measured clean from 1080 to 1320 px, fr and ar).
- **Reveal guard.** The e2e reveal guard watches `[data-reveal], [data-unit]`, not `[data-reveal]` alone.
- **Arabic display face.** IBM Plex Sans Arabic Light 300 is declared in `components/corridor/fonts.ts` with `preload: false`; `app/layout.tsx` must not name it (next/font preloads every source of a preloaded declaration, which would ship it to the signed-in app). Google Sans Flex is preloaded because it is the Latin body face.
- **Pushed history is never amended** on this shared branch.

## Where things are

- **Current truth about the page:** `docs/landing-page-status.md`.
- **Design spec:** `docs/superpowers/specs/2026-09-10-landing-light-retheme-design.md` — **§16 wins, then §15, then the numbered sections.**
- **Plans (fully executed, historical):** `docs/superpowers/plans/2026-09-10-retheme-{1-foundations,2-hero-helix,3-scenes-chrome}.md`.
- **Code:** `apps/web/components/corridor/` (`helix/`, `motion/`, `primitives/`, `scenes/S01–S11`, `CorridorChrome.tsx`, `CorridorControls.tsx`), `apps/web/app/corridor.css`, `apps/web/lib/site/` (`scroll.ts`, `tier.ts`, `motion.ts`, `curtain.ts`), `apps/web/e2e/corridor.spec.ts` and `theme.spec.ts`, `apps/web/scripts/render-helix-poster.mjs` and `render-og.mjs`.

## Environment

- **Two sessions share this working tree.** Another session (mir-32) has been working on the same branch all day, and the owner commits the whole tree at once. Before touching anything: `git log`, `git status`, and check file mtimes. To commit only your own change to a file someone else is editing, build a patch against HEAD and `git apply --cached` it.
- **`:3001` is a Docker `mir-web` container on an old image.** The repo's Playwright config serves on `:3001` and reuses a server already there, so it silently tests the old page. Use a scratch config kept outside the repo:

  ```ts
  // playwright.local.config.ts (outside the repo)
  import { defineConfig, devices } from '@playwright/test';
  const PORT = 3201;
  const WEB_ROOT = '/mnt/c/Users/moham/OneDrive/Desktop/MIR/apps/web';
  export default defineConfig({
    testDir: `${WEB_ROOT}/e2e`,
    fullyParallel: true,
    retries: 0,
    reporter: 'list',
    use: {
      baseURL: `http://127.0.0.1:${PORT}`,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    ],
    webServer: {
      command: `pnpm exec next start -p ${PORT}`,
      cwd: WEB_ROOT,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  });
  ```

  Then, from `apps/web`: `pnpm build`, and `pnpm exec playwright test -c <path>/playwright.local.config.ts --workers=1`.
- **Always `--workers=1`,** and watch `uptime`: three corridor tests flake under parallel load, and the reveal sweep flakes above a load average of ~10 whatever the worker count.
- **Never run the root `pnpm test` or the API suite** (`pnpm --filter @mir/api test`). It rewrites the `mir_app` role password and breaks the running local API. The web package's own `lint`, `typecheck` and `test` are safe.
- **OneDrive + git:** a stale `.git/index.lock` can appear. Before removing one, confirm no git process is running (WSL `pgrep -a git`, Windows `tasklist.exe | grep -i git`).
- **On this machine `grep` is aliased to ugrep;** use `/usr/bin/grep` in scripts.
