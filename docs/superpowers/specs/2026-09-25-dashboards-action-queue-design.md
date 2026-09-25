# Dashboards — Action Queue and Shell Layout — Design

**Date:** 2026-09-25
**Status:** Approved in conversation; pending spec review
**Branch:** `feat/frontend-uplift`
**Scope:** `components/shell/AppChrome.tsx`, `components/shell/UserMenu.tsx`,
`components/ui/stat.tsx`, `components/case/labels.ts`, a new `components/dashboard/`,
`app/workspace`, `app/doctor`, a new `app/admin/page.tsx`, `app/cases`, `app/admin/cases`,
`components/shell/nav.ts`. Landing page and `PublicChrome` are **not** touched.
Dashboard performance budgets from `2026-09-21-platform-corrections-design.md` §8 still
apply and are not restated here.

---

## 1. Why

The owner does not like the signed-in dashboards. Named problems: **layout is
broken/awkward, looks flat/generic, hard to scan.** A signed-in screenshot sweep
(clinic, receiving doctor, admin; 1440 px and 390 px; Arabic) on 2026-09-25 found:

- **Unbounded lists.** `/workspace` renders every task and then every active case —
  a 6,400 px page for a clinic with ~44 cases. `/admin/cases` renders 45 rows with no
  count or paging.
- **A real bug behind the length.** `nextActionKey('paid'|'accepted', 'source')` is
  `awaitDoctor`, which is `!== 'none'`, so `isAwaitingSide` counts "waiting for the
  doctor" as the clinic's task. The "tasks required of you" list is mostly other
  people's work.
- **No summary.** No counts, no urgency; every row is a mono ref over grey text.
- **Wasted frame.** A side column holding one number and one button beside a
  6,400 px main column; a doctor inbox of one table row on an empty page; a header
  carrying locale + theme + user pill; a footer repeating the brand on every screen.

The palette, display type and density rules from the 2026-09-20 platform re-theme
(D1 "bridged") stay. The problem is composition, not colour.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Scope | Shell + every role's dashboard + the two full case lists. |
| D2 | Dashboard concept | **Action queue**: KPI tiles, then capped queues grouped by who owes the next move, each row with one inline action. Same frame for all roles. |
| D3 | "Overdue" with no due-date field | **Stale by age**: non-terminal and `updatedAt` older than 48 h. Frontend-only, one constant. No API change. |
| D4 | Visual boldness | **Composed, not louder**: mint greeting band, lime only on the "Needs you" tile, status rail per row, section headers with counts. No gradients, glass or motion. |
| D5 | Admin home | **New `/admin` page**; the admin nav section points to it first. |
| D6 | Full lists | Status first, short dates, count in header, 25 rows/page client-side. |

## 3. Shell (`AppChrome`)

- **Header** keeps: mobile menu trigger, wordmark (phone / no-nav only), `UserMenu`.
  `LocaleSelect` and `ThemeToggle` move **into `UserMenu`** as menu items.
  `PublicChrome` keeps its visible controls — a signed-out visitor has no menu.
- **Sidebar** gains an identity block pinned to its bottom: avatar, display name,
  organisation name (from `useCurrentProvider`; omitted when null), and the
  `footerDisclaimer` in `text-xs text-muted-foreground`. The same block renders at the
  bottom of the mobile `Sheet`.
- **App footer removed** from `AppChrome`. The disclaimer survives in the sidebar
  (desktop) and drawer (phone). For a role with no navigation (no sidebar), the
  disclaimer renders as a single muted line under `main-content` so it is never lost.
- Skip link, `SessionTimeoutNotice`, `AccountPreferencesSync`: unchanged.

## 4. Shared pieces

### 4.1 Logic — `components/case/labels.ts`

```ts
/** Keys that describe the OTHER side's move — shown, but not a task. */
const WAITING_KEYS: ReadonlySet<NextActionKey> = new Set(['awaitDoctor']);

isAwaitingSide(status, side)   // non-terminal && key !== 'none' && !WAITING_KEYS.has(key)
isWaitingOnOther(status, side) // non-terminal && WAITING_KEYS.has(key)
```

`isAwaitingSide` has one production caller (`app/workspace/page.tsx:76`), so the
semantic change reaches nothing else.

`labels.test.ts` "agrees with the rendered label" is rewritten to the new invariant:
for every locale × status × side, **exactly one** of `isAwaitingSide`,
`isWaitingOnOther`, or "label is `nextActionNone` or status is terminal" holds.
Existing assertions (`submitted/source` true, `paid/destination` true, terminal false)
stay. New: `paid/source` and `accepted/source` → `isAwaitingSide` false,
`isWaitingOnOther` true.

### 4.2 Staleness — `components/dashboard/stale.ts`

```ts
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
export function isStale(c: Pick<Case, 'status' | 'updatedAt'>, now: number): boolean
```

True when non-terminal and `now - Date.parse(updatedAt) > STALE_AFTER_MS`. One test
file: fresh, 49 h old, terminal-and-old, exactly-48 h boundary (not stale).

### 4.3 Components — `components/dashboard/`

- **`DashboardHeader`** `{ greeting, subtitle?, action?, children }` — a
  `bg-secondary` band (mint) spanning the `Main` width with rounded corners; `children`
  is the tile row (`grid grid-cols-2 gap-3 lg:grid-cols-4`).
- **`StatTile`** (existing, `components/ui/stat.tsx`) gains `emphasis?: boolean`, which
  applies `--highlight` / `--highlight-edge` to the tile surface. The numeral keeps text
  ink (existing rule). Used **only** on "Needs you" / "To triage" / "Verifications
  pending".
- **`QueueSection`** `{ title, count, seeAllHref, empty, testId, children }` — heading
  with the count in a muted pill, "see all →" link (hidden when `count <= QUEUE_CAP`),
  `EmptyState` when empty. `QUEUE_CAP = 5`; callers slice.
- **`QueueRow`** `{ ref, href, label, secondary?, status, updatedAt, stale, action? }` —
  a single line at ≥ `sm` (wraps below): a 3 px leading rail coloured by status tone
  (same tone map `CaseStatusBadge` uses), `<bdi>` mono ref, next-action label, optional
  secondary line, relative age via `Intl.RelativeTimeFormat(locale, { numeric: 'auto' })`,
  an amber dot + `sr-only` "stale" text when `stale`, and `action` (a small
  `buttonVariants({ size: 'sm' })` link or button) at the end. The whole row is not a
  link when it has an action (no nested interactives); the ref is the link instead.

All pieces use logical properties (`ps-`, `border-s-`, `ms-auto`) so RTL needs no
per-locale code; `ChevronRight` keeps `rtl:rotate-180`.

## 5. Role homes

### 5.1 Clinic — `/workspace`

Data: unchanged (`casesApi.listCases({ providerId })`).

- Header: greeting with the provider's name; action **New case** (`/cases/new`).
- Tiles: **Needs you** (emphasis, → `/cases`), **Waiting on doctor**, **Stale**,
  **Answered · 7 days** (status `answered`/`closed`, `updatedAt` within 7 days).
- Main (lg: 2 cols): `QueueSection` Needs you — rows sorted oldest `updatedAt` first
  (the longest-waiting task is on top), inline action by key: `pickDoctor` →
  "Pick" `/cases/{ref}/pick-doctor`; `pay` → "Pay" `/cases/{ref}`; `readAnswer` →
  "Open" `/cases/{ref}`. Then `QueueSection` Waiting on doctor — no action.
- Side (lg: 1 col): **Your clinic** card (seat count — existing — and team link
  `/settings/team`), **Quick links** (New case, Upload, Patients).
- The old "active cases" full list is removed; "see all" goes to `/cases`.

### 5.2 Receiving doctor — `/doctor`

Data: unchanged (`api.cases.list()`); existing accept/decline handlers reused.

- Tiles: **To triage** (`paid`, emphasis), **To answer** (`accepted`),
  **Answered · 7 days**.
- Queues: To triage (inline Accept / Decline — existing `act()`, `busyId` disables),
  then To answer (inline "Write report" → the route the current table's button uses).
- Side: **Availability** card linking to `/doctor/availability`.
- The current table's columns (specialty, reason, patient) move into the row's
  `secondary` line so nothing shown today is lost.

### 5.3 Admin — new `/admin`

Data: `casesApi.listVerificationQueue()` and the admin case list call already used by
`/admin/cases` (reuse, no new endpoint).

- Tiles: **Verifications pending** (emphasis, → `/admin/providers`), **Stale cases**,
  **Opened today** (`createdAt` today, local), **Active**.
- Queues: Verification queue (first 5, row action "Review" → `/admin/providers`),
  Stale cases (first 5, → `/admin/cases`).
- Side: links to Ledger oversight and Audit log (audit only for `admin`, matching
  `nav.ts`).
- `nav.ts`: new first item in the admin section, `href: '/admin'`, `roles: OPS_ROLES`,
  a dashboard icon and new dictionary keys. `isCurrent` already treats a destination
  that is a prefix of another (`/admin` vs `/admin/cases`) by exact match.
- Guarded by `RoleGate allow={OPS_ROLES}` like the other admin pages.

## 6. Full lists — `/cases`, `/admin/cases`

- Column order: **status**, ref, (existing others), updated.
- Dates via the existing `useDateFormat` with a short style (day, month, time — no
  year when current year, no zone name).
- `PageHeader` title gets the count: "Cases · 45".
- Client paging: `PAGE_SIZE = 25`, Previous / Next with "1–25 of 45". Filters and search
  reset to page 1. `ponytail:` comment — client paging over a fully loaded list; move to
  server paging when a provider's list exceeds a few hundred rows.

## 7. i18n

New keys in every dictionary in `DICTIONARIES`: greeting, tile labels, queue titles,
"see all", "stale", "Answered · 7 days", pagination strings, admin dashboard
title/description, nav label, locale/theme menu-item labels. The existing
"every locale has every key" test covers completeness.

## 8. Testing

- Unit: `labels.test.ts` (new invariant, §4.1), `stale.test.ts` (§4.2).
- e2e: update selectors in specs touching `/workspace` and `/doctor`
  (`task-list`, `tasks-empty`, `active-list`, `inbox-list`, `inbox-empty`); testIds keep
  their names where the meaning is unchanged (`task-list` = Needs you queue,
  `inbox-list` = To triage queue); `active-list` is removed with its section.
  `onboarding.spec.ts` route list gains `/admin`.
- Visual: repeat the 2026-09-25 sweep (3 roles × desktop/phone × ar/fr), checking no
  horizontal scroll at 390 px in RTL and that no dashboard exceeds ~2 viewports tall.
  Sign in through the form and navigate in-app — bearer injection alone renders pages
  signed-out on this build.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/web` green.

## 9. Out of scope

- A real SLA / `responseDueAt` on the case contract (D3 rejected it for now).
- Nav count badges (need a shell-level fetch; revisit after this ships).
- Server-side pagination.
- Any change to the landing page, `PublicChrome`, or tokens in `globals.css`.
