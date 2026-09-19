# Landing Light Re-theme — Session Handoff

Entry point for the session that finishes the re-theme. All three plans are implemented and reviewed; what remains is one test decision, a handful of owner calls, and integrating the branch. Read this first.

The previous version of this file (commit `cb9c267`) was the kickoff for the implementation; `git show cb9c267:docs/superpowers/plans/2026-09-10-retheme-HANDOFF.md` has it.

## State at handoff (2026-09-19)

| Item | Status |
|---|---|
| Branch | `feat/frontend-uplift`, HEAD `8b510f3`, pushed (nothing local-only). |
| Implementation | **Done at `d21cbf2`.** Plans 1, 2 and 3 executed task by task (69 commits from `cb9c267` to `d21cbf2`), each task reviewed, each plan closed by a whole-branch review and one fix wave. Plan 3's fix wave was re-reviewed: every finding addressed, no new Critical or Important issues. |
| After the re-theme | `8b510f3` (owner, 14:55, pushed) sits on top. It commits another session's (mir-32) helix rework — `helix-config.ts` (+72) and `helix-geometry.ts` (+34): more turns and base pairs, ribbon backbones, a 30° pitch, a new particle split — together with that session's temporary `distDir` in `next.config.mjs` (its own comment says "TEMP(mir-32) … Revert before commit"), `tsconfig.json`, `next-env.d.ts` and the lockfile. It was not reviewed by the re-theme process. See "Test status". |
| `main` | `origin/main` holds this branch minus its 10 newest commits (the owner merged mid-plan). Local `main` is stale. |
| Finishing | **Not done.** `superpowers:finishing-a-development-branch` stopped at its first step on a failing suite (below). |
| Working tree | Clean except this file. |
| Plan workspaces | Deleted (`.superpowers/sdd/2026-09-10-retheme-*`). Git history is the record. |

## Test status

**At `8b510f3` (HEAD):** lint and typecheck pass; Vitest **218 / 220** — two tests in `components/corridor/helix/helix-geometry.test.ts` fail ("gives Tier A 45% strand, 15% rung, 40% dust, and loses nobody"; "labels particles with their kind in the configured proportion") because the commit moved `HELIX.split` from spec §5.2's 45 / 15 / 40 to 52 / 18 / 30. E2E was not run on this commit. Its helix changes also leave both committed posters (`public/helix/poster-{ltr,rtl}.avif`) showing the old helix, and change what the geometry tripwire measures.

**At `d21cbf2` (the re-theme as reviewed):**

- `pnpm --filter @mir/web lint`: pass. `typecheck`: pass. `test` (Vitest): 220 / 220.
- E2E, both projects (chromium + mobile-chrome), one worker: **196 passed, 9 skipped, 1 failed.** The skips are by design (desktop-only or mobile-only cases).
- The failure is `e2e/corridor.spec.ts:748`, "does not regress past this environment's measured geometry range": 42 ms against a 40 ms limit. Rerun alone three times: pass, pass, fail at 55 ms, with a load average of 5–7 from another session working on the same machine. Rerun three more times later on a quiet machine (load average 1.7), against the same build: fail at 84 ms, fail at 76 ms, pass. The geometry code at `d21cbf2` has not changed since `31cd581` (Plan 2), when this environment measured 21–32 ms idle.
- So the check is noise here, not a signal: identical code ranges from under 40 ms to 84 ms in this WSL2 + SwiftShader setup, whatever the load. It is a regression tripwire for this environment, not the spec §10 budget (≤ 10 ms on a real device, still unmeasured). **It needs an owner decision before the suite can be called green:** gate it so it runs only where timings are stable (e.g. behind an opt-in environment variable or in CI), turn it into a recorded measurement instead of an assertion, or raise the limit with the measured range in its comment.

## Next steps, in order

1. **Check for concurrent work.** Another session (mir-32) was reworking the hero helix, scroll animations and responsive layout on this same branch: `components/corridor/helix/*`, `BlurIn` / `WordReveal` / `ScrollLitText`, `lib/site/use-gsap.ts`, `lib/site/scroll.ts`, `app/corridor.css`. Run `git log` and `git status` first. Build on its commits; never overwrite them.
2. **Settle `8b510f3`'s helix rework** (owner decision). If the new look stays: amend spec §5 (at least §5.2's split) to match, update the two failing geometry tests to the new split, re-render both posters (and confirm each stays under the 60 KiB budget), and review the diff the way the plans were reviewed. Either way, drop the temporary `distDir` from `next.config.mjs` or replace its "Revert before commit" comment with a real one.
3. **Settle the geometry tripwire** (owner decision, see "Test status"), then **rebuild and rerun the web suite** (commands under "Environment").
4. **Owner decision: the door-card focus fix** (first item under "Open items"). Recommended.
5. **Run `superpowers:finishing-a-development-branch`** with base branch `main`: merge locally, push and open a PR, or keep the branch.

## Open items for the owner

**Recommended fix, not applied**
- **A mouse press on a door card can jump the page.** `apps/web/components/corridor/motion/HorizontalTrack.tsx:77-98` — the `focusin` handler that brings a keyboard-focused door card into view also fires when a mouse press focuses the link (Chrome focuses links on mousedown). Measured: a 150 ms press moved the page ~830 px before release. The link still navigated in both runs; a lost click was not reproduced. The fix is one guard at the top of the handler, `if (!focused.matches(':focus-visible')) return;`, plus an e2e that clicks a partly visible card with the mouse and asserts no scroll. It was held back only because the review process allows one fix wave.

**Copy (needs the Arabic review)**
- `themeAppliesToApp` in `apps/web/lib/i18n/dictionary.ts` (ar :438, fr :1023, en :1627) still tells visitors "this page stays dark". The landing page is light now. Needs new copy in all three locales.
- The mobile menu's `nav` landmark reuses the "Questions" label (`t.navQuestions`); a dedicated label needs a new copy key.

**Design calls**
- Helix colour and opacity. If tuned, the tone, depth and sprite constants live in `helix-shaders.ts` as well as `helix-config.ts`, and both posters must be re-rendered (see "Environment").
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

**Git**
- Four already-pushed commits lack the session trailer (`c68a708`, `bc47ea3`, `fab7e61`, `d39986b`). Pushed history was never amended; rewriting it is the owner's call.

## Rulings that still bind future work

The implementing session made 55 rulings; the full list, each with its cost if wrong, was delivered in that session's final message. These are the ones a later change can trip over:

- **Posters.** Any helix tuning must re-render both posters. They are 58,237 and 59,000 bytes against the script's 60 KiB `BUDGET`, at AVIF quality 30 (42 was over budget).
- **Geometry tripwire.** 40 ms is an environment regression guard, not the spec budget. Chunking the geometry build across frames was deliberately not done.
- **Anchors.** `flowTop()` in `lib/site/scroll.ts` measures a sticky panel with `position: 'static'` (not `relative`, which keeps the panel's negative inset and lands anchors short on tall panels). An e2e covers it on mobile-chrome.
- **Reveals survive a drop to Tier C.** `ScrollLitText` and `WordReveal` un-split when animation turns off mid-visit (FPS demotion or the footer's reduce-motion switch). Keep that both-ways behaviour.
- **Hero layout.** The copy sits in the hero grid's first row; the section is `min-block-size: 100lvh`; the bottom band (divider, trust row, CTAs, chips) is a content-sized grid. The spec's 78.6 / 83.6 / 89.4 % positions are the reference's measurements at 1440×900, not invariants; the binding intent is order and alignment.
- **Header.** `.chrome-link` is `white-space: nowrap`; the CTA breakpoint stays at 1100 px (measured clean from 1080 to 1320 px, fr and ar).
- **Reveal guard.** The e2e reveal guard watches `[data-reveal], [data-unit]`, not `[data-reveal]` alone.
- **Arabic display face.** IBM Plex Sans Arabic Light 300 is declared in `components/corridor/fonts.ts` with `preload: false`; `app/layout.tsx` must not name it (next/font preloads every source of a preloaded declaration, which would ship it to the signed-in app). Google Sans Flex is preloaded because it is the Latin body face.
- **Pushed history is never amended** on this shared branch.

## Where things are

- **Current truth about the page:** `docs/landing-page-status.md` (truth pass in `076b221`).
- **Design spec:** `docs/superpowers/specs/2026-09-10-landing-light-retheme-design.md` (§15 overrides earlier sections).
- **Plans (fully executed, historical):** `docs/superpowers/plans/2026-09-10-retheme-{1-foundations,2-hero-helix,3-scenes-chrome}.md`.
- **Code:** `apps/web/components/corridor/` (`helix/`, `motion/`, `primitives/`, `scenes/S01–S11`, `CorridorChrome.tsx`, `CorridorControls.tsx`), `apps/web/app/corridor.css`, `apps/web/lib/site/` (`scroll.ts`, `tier.ts`, `motion.ts`, `curtain.ts`), `apps/web/e2e/corridor.spec.ts` and `theme.spec.ts`, `apps/web/scripts/render-helix-poster.mjs` and `render-og.mjs`.

## Environment

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
- **Always `--workers=1`.** Three corridor tests flake under parallel load.
- **Posters:** `pnpm --filter @mir/web exec next start -p 3202` in the background, then `node apps/web/scripts/render-helix-poster.mjs http://127.0.0.1:3202` (its default base URL is `:3001`, the old container). Stop the server afterwards.
- **Never run the root `pnpm test` or the API suite** (`pnpm --filter @mir/api test`). It rewrites the `mir_app` role password and breaks the running local API. The web package's own `lint`, `typecheck` and `test` are safe.
- **OneDrive + git:** a stale `.git/index.lock` can appear. Before removing one, confirm no git process is running (WSL `pgrep -a git`, Windows `tasklist.exe | grep -i git`).
- **On this machine `grep` is aliased to ugrep;** use `/usr/bin/grep` in scripts.

## Kickoff prompt for the next session

```
Finish the landing light re-theme. Read
docs/superpowers/plans/2026-09-10-retheme-HANDOFF.md first. Check git log
and git status before touching anything: another session may have changed
the helix, the motion primitives or corridor.css since 8b510f3 — build on
its work, never overwrite it. Apply the owner's decisions on 8b510f3's
helix rework and on the geometry tripwire (see Next steps), rebuild and
rerun the web suite as the handoff describes, then run
superpowers:finishing-a-development-branch against main.
```

If the owner has approved the door-card focus fix, add: "First apply the `:focus-visible` guard in HorizontalTrack.tsx described under Open items, with its mouse-path e2e, and commit it."
