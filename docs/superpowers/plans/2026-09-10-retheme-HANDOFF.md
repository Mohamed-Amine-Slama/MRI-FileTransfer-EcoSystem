# Landing Light Re-theme — Session Handoff

Entry point for the session that implements the re-theme. Read this first, then the files it names, in order.

## State at handoff (2026-09-10)

| Item | Status |
|---|---|
| Branch | `feat/frontend-uplift` (working tree clean) |
| Design spec | Approved — `docs/superpowers/specs/2026-09-10-landing-light-retheme-design.md` (commit `883d7cd`). §15 lists corrections found while planning; where §15 and an earlier section disagree, §15 wins. |
| Implementation plans | Written and committed (`3c5dc1e`). **No implementation has started.** |
| Execution mode | Not chosen yet — see "How to run" below. |

## Read in this order

1. `docs/superpowers/specs/2026-09-10-landing-light-retheme-design.md` — the what and why.
2. `docs/superpowers/plans/2026-09-10-retheme-1-foundations.md` — 4 tasks: palette tokens + contrast test, typefaces + pills/chips, motion helpers + curtain signal, retire dark-room effects.
3. `docs/superpowers/plans/2026-09-10-retheme-2-hero-helix.md` — 6 tasks: helix geometry, shaders + renderer, `HelixCanvas` + tier budget, reveal primitives + new hero, posters + helix e2e, retire the slice scrub.
4. `docs/superpowers/plans/2026-09-10-retheme-3-scenes-chrome.md` — 10 tasks: card + S02, scroll-lit S03, stacked panels S04–S07, S08 stats, pinned S09 track, S10 accordion, S11 close, header/footer, cleanup + docs + visual review.

Run the plans strictly in order; each later plan consumes names the earlier ones produce (every task lists its `Consumes` / `Produces`). Each task ends with its own commit.

## How to run

Pick one:

- **Subagent-driven (recommended):** invoke `superpowers:subagent-driven-development` — a fresh subagent per task, review between tasks.
- **Inline:** invoke `superpowers:executing-plans` — tasks run in the session with review checkpoints.

## Decisions already made (do not re-open)

- Whole landing page re-themed to the light mint/teal/lime register; signed-in app untouched.
- Scenes keep all content, demos and `data-testid`s; each gets the reference mechanic that fits it (spec §7.2).
- Typefaces: Google Sans Flex (Latin, vendored, SIL OFL 1.1 — confirmed) + IBM Plex Sans Arabic Light 300 for Arabic display.
- Helix renderer: raw WebGL2, one program, one draw call; no three.js.
- Provenance: the reference site gives direction only. All code is original; all copy comes from `apps/web/lib/site/copy.ts`; no reference marks, logos or photos.

## Environment notes

- **Network is needed** in Plan 1 Task 2 (`scripts/fetch-fonts.sh` pulls from Google Fonts and IBM's GitHub).
- **E2E needs a fresh build:** `pnpm --filter @mir/web build`, then `pnpm --filter @mir/web exec playwright test <spec>`; the config's webServer serves on `:3001` (or reuses a server already there).
- **Headless WebGL2:** Plan 2 Task 5 adds SwiftShader flags to `playwright.config.ts`; the helix tests depend on them.
- **Posters:** Plan 2 Task 5 Step 6 needs the app running on `:3001` while `scripts/render-helix-poster.mjs` runs.
- **Unit tests are safe:** `pnpm --filter @mir/web exec vitest run …` runs in Node with no database. Do **not** run the API suite (`pnpm --filter @mir/api test`) — it rewrites the `mir_app` role password and breaks the running local API.
- **OneDrive + git:** the repo lives under OneDrive, which can leave a stale `.git/index.lock`. Before removing one, confirm no git process is running (WSL `pgrep -a git`, Windows `tasklist.exe | grep -i git`).

## Kickoff prompt for the new session

```
Continue the landing light re-theme. Read
docs/superpowers/plans/2026-09-10-retheme-HANDOFF.md, then execute
docs/superpowers/plans/2026-09-10-retheme-1-foundations.md task by task
using superpowers:subagent-driven-development. When Plan 1 is done and
green, continue with plan 2, then plan 3.
```

Swap `subagent-driven-development` for `executing-plans` to run inline instead.
