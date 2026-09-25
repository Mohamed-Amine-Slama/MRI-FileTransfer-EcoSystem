# Dashboards — Action Queue and Shell Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the signed-in dashboards' stacked-card lists with an action-queue layout (tiles + capped, prioritised queues with inline actions), slim the shell, add an admin home, and page the full case lists.

**Architecture:** Pure logic (task/waiting split, staleness, relative age, paging, per-role buckets) lives in small tested functions in `components/case/labels.ts` and `lib/dashboard/`. Presentation is three components in `components/dashboard/queue.tsx` plus a `Pager` in `components/ui/`. Each role's page composes those pieces over the data it already loads — no new endpoints.

**Tech Stack:** Next.js (app router, client components), React, Tailwind v4 (tokens in `app/globals.css`), lucide-react, Vitest (node env), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-dashboards-action-queue-design.md`

All paths below are relative to `apps/web/` unless they start with `docs/` or `packages/`.
Run every command from `apps/web/`.

## Global Constraints

- Palette, display font and density from the 2026-09-20 platform re-theme stay; **no new colour tokens, no gradients, no glass, no motion** (spec D4).
- Lime (`bg-highlight`) appears **only** on the one emphasised tile per dashboard.
- Logical properties only (`ms-`, `me-`, `ps-`, `border-s-`, `start-`); directional icons get `rtl:rotate-180`. No per-locale layout code.
- Latin references inside possibly-RTL text are wrapped in `<bdi>`.
- Dates shown with `useDateFormat` keep the time-zone name (requirement P10.1, documented in `lib/i18n/provider.tsx`).
- Every new dictionary key is added to **all three** dictionaries (`ar`, `fr`, `en`) in `lib/i18n/dictionary.ts`; `fr`/`en` are typed `Dictionary`, so a missing key fails `pnpm typecheck`, and `lib/i18n/dictionary.test.ts` fails on empty values.
- New files under `app/` or `components/` must not contain `libya_doctor`, `tunisia_doctor`, `Libya`, `Tunisia`, `Libye`, `Tunisie` (`lib/corridor/no-hardcoded-corridor.test.ts`). Gate by side with `rolesForSides([...])`.
- `QUEUE_CAP = 5` (dashboard queues that have a "see all" list). `STALE_AFTER_MS = 48 h`. `PAGE_SIZE = 25`.
- Never add a dependency.
- The owner commits the working tree at any time: never leave a temporary hack in a tracked file. Stage only the files each task names (the tree has an unrelated modified `README.md` — never stage it).
- Do **not** run `pnpm build` in `apps/web` while another server serves from it (check `pgrep -af "next build|next start"`). The visual sweep in Task 9 builds in a git worktree.

## Review Focus

1. **A clinic with zero cases / a brand-new provider (`providerId === null`)** — every tile must show `0` and every queue its empty state; no crash, no spinner forever. → Task 5 Step 1 (`workspace-model.test.ts` "empty").
2. **More than `QUEUE_CAP` items** — the queue shows exactly 5 and a "see all" link; with ≤ 5 there is no link. → Task 3 Step 1 (`queue-cap.test.ts`).
3. **Paging edge cases** — a filter narrows 45 rows to 3 while on page 2 → the page clamps to 1, never an empty table reading "26–25 / 3". → Task 8 Step 1 (`pagination.test.ts` "clamps").
4. **Unparseable or missing timestamps** (`updatedAt: ''`, `answeredAt: null`) — never stale, never "answered this week", age renders `—`. → Task 2 Step 1 (`time.test.ts`) and Task 6 Step 1.
5. **A receiving doctor with more than 5 cases to triage** — the doctor has no other list, so their queues are **not** capped; nothing becomes unreachable. → Task 6 Step 1 (`doctor-model.test.ts` "uncapped").

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `components/case/labels.ts` | modify | `isAwaitingSide` excludes waiting keys; new `isWaitingOnOther` |
| `components/case/labels.test.ts` | modify | new invariant |
| `lib/dashboard/time.ts` (+ `.test.ts`) | create | `STALE_AFTER_MS`, `isStale`, `isWithinDays`, `isSameLocalDay`, `relativeAge` |
| `lib/dashboard/queue.ts` (+ `queue-cap.test.ts`) | create | `QUEUE_CAP`, `capQueue` |
| `lib/dashboard/workspace-model.ts` (+ `.test.ts`) | create | clinic dashboard buckets from `Case[]` |
| `lib/dashboard/doctor-model.ts` (+ `.test.ts`) | create | doctor dashboard buckets from `CaseRecord[]` |
| `lib/dashboard/pagination.ts` (+ `.test.ts`) | create | `PAGE_SIZE`, `pageOf` |
| `lib/i18n/provider.tsx` | modify | `useDateFormat({ short })`, `useRelativeAge()` |
| `lib/i18n/dictionary.ts` | modify | new keys (per task) |
| `components/ui/index.tsx` | modify | export `Tone` (`Pager` is imported from `ui/pager` directly — no re-export, it would cycle) |
| `components/ui/stat.tsx` | modify | `StatTile` `emphasis` prop |
| `components/ui/pager.tsx` | create | Previous / Next + range |
| `components/dashboard/queue.tsx` | create | `DashboardHeader`, `QueueSection`, `QueueRow` |
| `components/shell/LocaleSelect.tsx` | modify | optional `id` prop |
| `components/shell/AppChrome.tsx` | modify | header slimmed, sidebar identity block, footer removed |
| `app/workspace/page.tsx` | modify | clinic dashboard |
| `app/doctor/page.tsx` | modify | doctor dashboard |
| `app/admin/page.tsx` | create | admin home |
| `components/shell/nav.ts` | modify | `/admin` item |
| `app/page.tsx` | modify | ops destination `/admin` |
| `app/cases/page.tsx` | modify | wide, status first, count, paging |
| `app/admin/cases/page.tsx` | modify | status first, count, paging |
| `e2e/onboarding.spec.ts` | modify | gate list gains `/admin` |

---

### Task 1: Split "needs you" from "waiting on the other side"

**Files:**
- Modify: `components/case/labels.ts:228-238` (the `isAwaitingSide` doc comment and function) and the comment at ~line 166
- Test: `components/case/labels.test.ts` (imports at top; the `'agrees with the rendered label in every locale'` test near line 127)

**Interfaces:**
- Produces: `isAwaitingSide(status: CaseStatus, side: CaseSide): boolean` (narrowed semantics) and `isWaitingOnOther(status: CaseStatus, side: CaseSide): boolean`, both exported from `components/case/labels.ts`.

- [ ] **Step 1: Write the failing tests**

In `components/case/labels.test.ts`, add `isWaitingOnOther,` to the import list from `'./labels'` (after `isAwaitingSide,`). Then replace the whole `it('agrees with the rendered label in every locale', ...)` block with:

```ts
  it('puts every labelled case in exactly one of task / waiting, in every locale', () => {
    // A case with a next-action label is either this side's task or the other
    // side's move — never both, never neither. If this fails, one screen calls
    // a case a task while another says someone else owes the next step.
    for (const t of Object.values(DICTIONARIES)) {
      for (const status of CASE_STATUSES) {
        for (const side of CASE_SIDES) {
          const labelled =
            nextActionLabel(t, status, side) !== t.nextActionNone && !isTerminalStatus(status);
          const buckets = [isAwaitingSide(status, side), isWaitingOnOther(status, side)].filter(
            Boolean,
          ).length;
          expect(buckets, `${status}/${side}`).toBe(labelled ? 1 : 0);
        }
      }
    }
  });

  it('treats waiting for the doctor as the other side’s move, not the clinic’s task', () => {
    for (const status of ['paid', 'accepted'] as const) {
      expect(isAwaitingSide(status, 'source')).toBe(false);
      expect(isWaitingOnOther(status, 'source')).toBe(true);
    }
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run components/case/labels.test.ts`
Expected: FAIL — `isWaitingOnOther` is not a function.

- [ ] **Step 3: Implement**

In `components/case/labels.ts`, replace the existing `isAwaitingSide` (doc comment + function, ~lines 228-238) with:

```ts
/**
 * Next-action keys that describe the OTHER side's move. They are shown on the
 * case list so a clinic knows where a case stands, but they are not a task:
 * nothing the clinic does will move a case the doctor has not answered.
 */
const WAITING_KEYS: ReadonlySet<NextActionKey> = new Set(['awaitDoctor']);

/**
 * Whether this case is waiting on the given side — the §5.5 task rule.
 *
 * A terminal case is never a task even if a table above still names an action,
 * so a cancelled case cannot linger on a clinic's to-do list. A waiting key is
 * never a task either; see `isWaitingOnOther`.
 */
export function isAwaitingSide(status: CaseStatus, side: CaseSide): boolean {
  if (isTerminalStatus(status)) return false;
  const key = nextActionKey(status, side);
  return key !== 'none' && !WAITING_KEYS.has(key);
}

/** Whether the given side is waiting on the other one to move this case. */
export function isWaitingOnOther(status: CaseStatus, side: CaseSide): boolean {
  if (isTerminalStatus(status)) return false;
  return WAITING_KEYS.has(nextActionKey(status, side));
}
```

Also update the comment on `nextActionKey` at ~line 166 that says "`isAwaitingSide` and `nextActionLabel` therefore cannot disagree" to: "`isAwaitingSide`, `isWaitingOnOther` and `nextActionLabel` therefore cannot disagree."

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run components/case/labels.test.ts`
Expected: PASS (all tests, including the pre-existing `submitted/source`, `paid/destination`, `declined` and terminal assertions).

- [ ] **Step 5: Commit**

```bash
git add components/case/labels.ts components/case/labels.test.ts
git commit -m "fix(case): waiting on the doctor is not the clinic's task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Time helpers and locale-aware hooks

**Files:**
- Create: `lib/dashboard/time.ts`
- Test: `lib/dashboard/time.test.ts`
- Modify: `lib/i18n/provider.tsx:125-147` (`useDateFormat`) — add `useRelativeAge`

**Interfaces:**
- Produces (from `lib/dashboard/time.ts`):
  - `STALE_AFTER_MS: number`
  - `isStale(c: { status: CaseStatus; updatedAt: string }, now: number): boolean`
  - `isWithinDays(iso: string | null | undefined, days: number, now: number): boolean`
  - `isSameLocalDay(iso: string, now: number): boolean`
  - `relativeAge(iso: string, now: number, locale: string): string`
- Produces (from `lib/i18n/provider.tsx`):
  - `useDateFormat(options?: { short?: boolean }): (value: Date | string) => string`
  - `useRelativeAge(): (iso: string) => string`

- [ ] **Step 1: Write the failing tests**

Create `lib/dashboard/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STALE_AFTER_MS, isSameLocalDay, isStale, isWithinDays, relativeAge } from './time';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const H = 60 * 60 * 1000;

describe('isStale', () => {
  it('is false for a case updated recently', () => {
    expect(isStale({ status: 'paid', updatedAt: ago(2 * H) }, NOW)).toBe(false);
  });
  it('is true past 48 hours', () => {
    expect(isStale({ status: 'paid', updatedAt: ago(49 * H) }, NOW)).toBe(true);
  });
  it('is false at exactly 48 hours', () => {
    expect(isStale({ status: 'paid', updatedAt: ago(STALE_AFTER_MS) }, NOW)).toBe(false);
  });
  it('is never true for a finished case', () => {
    expect(isStale({ status: 'closed', updatedAt: ago(500 * H) }, NOW)).toBe(false);
  });
  it('is false for an unparseable timestamp', () => {
    expect(isStale({ status: 'paid', updatedAt: '' }, NOW)).toBe(false);
  });
});

describe('isWithinDays', () => {
  it('counts an instant inside the window', () => {
    expect(isWithinDays(ago(6 * 24 * H), 7, NOW)).toBe(true);
  });
  it('excludes an instant outside the window', () => {
    expect(isWithinDays(ago(8 * 24 * H), 7, NOW)).toBe(false);
  });
  it('is false for null, undefined and garbage', () => {
    expect(isWithinDays(null, 7, NOW)).toBe(false);
    expect(isWithinDays(undefined, 7, NOW)).toBe(false);
    expect(isWithinDays('not a date', 7, NOW)).toBe(false);
  });
});

describe('isSameLocalDay', () => {
  it('matches the same calendar day', () => {
    expect(isSameLocalDay(new Date(NOW - 60_000).toISOString(), NOW)).toBe(true);
  });
  it('rejects two days ago', () => {
    expect(isSameLocalDay(ago(48 * H), NOW)).toBe(false);
  });
});

describe('relativeAge', () => {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  it('uses minutes under an hour', () => {
    expect(relativeAge(ago(30 * 60_000), NOW, 'en')).toBe(rtf.format(-30, 'minute'));
  });
  it('uses hours under a day', () => {
    expect(relativeAge(ago(5 * H), NOW, 'en')).toBe(rtf.format(-5, 'hour'));
  });
  it('uses days beyond that', () => {
    expect(relativeAge(ago(72 * H), NOW, 'en')).toBe(rtf.format(-3, 'day'));
  });
  it('renders a dash for an unparseable timestamp', () => {
    expect(relativeAge('', NOW, 'en')).toBe('—');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/dashboard/time.test.ts`
Expected: FAIL — cannot resolve `./time`.

- [ ] **Step 3: Implement `lib/dashboard/time.ts`**

```ts
import { isTerminalStatus, type CaseStatus } from '@mir/contracts';

/**
 * A live case with no recorded movement for this long is flagged "stale".
 *
 * Cases carry no due date the whole platform agrees on (spec 2026-09-25 D3), so
 * age since the last update is the honest signal: it says "nobody has touched
 * this", not "this is late".
 */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isStale(c: { status: CaseStatus; updatedAt: string }, now: number): boolean {
  if (isTerminalStatus(c.status)) return false;
  const at = Date.parse(c.updatedAt);
  return !Number.isNaN(at) && now - at > STALE_AFTER_MS;
}

export function isWithinDays(iso: string | null | undefined, days: number, now: number): boolean {
  if (iso === null || iso === undefined) return false;
  const at = Date.parse(iso);
  return !Number.isNaN(at) && now - at <= days * DAY_MS;
}

/** Same calendar day in the viewer's own time zone — "opened today". */
export function isSameLocalDay(iso: string, now: number): boolean {
  const a = new Date(iso);
  const b = new Date(now);
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** "5 hr. ago" in the given BCP-47 locale: minutes under an hour, hours under a day, then days. */
export function relativeAge(iso: string, now: number, locale: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run lib/dashboard/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the hooks in `lib/i18n/provider.tsx`**

Add with the other imports:

```ts
import { relativeAge } from '../dashboard/time';
```

Replace `useDateFormat` (~lines 127-147) with:

```ts
export function useDateFormat(options: { short?: boolean } = {}): (value: Date | string) => string {
  const { locale } = useLocale();
  const short = options.short === true;
  return useCallback(
    (value: Date | string) => {
      const date = typeof value === 'string' ? new Date(value) : value;
      if (Number.isNaN(date.getTime())) return '—';
      // Explicit components rather than dateStyle/timeStyle: the spec forbids
      // mixing the styles with timeZoneName, and compliant engines throw. The
      // zone stays visible — that requirement (P10.1) is the whole point.
      // `short` only drops a year the reader already knows: this one.
      const sameYear = date.getFullYear() === new Date().getFullYear();
      return new Intl.DateTimeFormat(DATE_LOCALE[locale], {
        year: short && sameYear ? undefined : 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(date);
    },
    [locale, short],
  );
}

/** "2 hr. ago" in the interface language, measured at render time. */
export function useRelativeAge(): (iso: string) => string {
  const { locale } = useLocale();
  return useCallback((iso: string) => relativeAge(iso, Date.now(), DATE_LOCALE[locale]), [locale]);
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck && pnpm vitest run lib/dashboard`
Expected: no errors; PASS.

```bash
git add lib/dashboard/time.ts lib/dashboard/time.test.ts lib/i18n/provider.tsx
git commit -m "feat(dashboard): staleness, relative age and short dates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard building blocks

**Files:**
- Create: `lib/dashboard/queue.ts`, `lib/dashboard/queue-cap.test.ts`
- Create: `components/dashboard/queue.tsx`
- Modify: `components/ui/stat.tsx` (`StatTile`), `components/ui/index.tsx:23` (export `Tone`)
- Modify: `lib/i18n/dictionary.ts` (keys `dashSeeAll`, `dashStale`)

**Interfaces:**
- Consumes: `useRelativeAge()` (Task 2).
- Produces:
  - `QUEUE_CAP = 5`, `capQueue<T>(rows: readonly T[], cap?: number): { shown: T[]; more: boolean }` from `lib/dashboard/queue.ts`
  - `export type Tone = 'info' | 'warning' | 'danger' | 'success'` from `components/ui/index.tsx`
  - `StatTile` gains `emphasis?: boolean`
  - From `components/dashboard/queue.tsx`:
    - `DashboardHeader({ greeting: string; subtitle?: string; action?: ReactNode; children?: ReactNode })`
    - `QueueSection({ title: string; count: number; seeAllHref?: string; more?: boolean; empty: string; testId?: string; emptyTestId?: string; children: ReactNode })`
    - `QueueRow({ reference: string; mono?: boolean; href: string; label: string; secondary?: string; tone?: Tone; at: string; stale?: boolean; action?: ReactNode; testId?: string; dataStatus?: string })`

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/queue-cap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { QUEUE_CAP, capQueue } from './queue';

describe('capQueue', () => {
  it('shows everything and no "see all" at or under the cap', () => {
    const rows = [1, 2, 3, 4, 5];
    expect(capQueue(rows)).toEqual({ shown: rows, more: false });
  });
  it('shows exactly the cap and flags more beyond it', () => {
    const rows = Array.from({ length: 44 }, (_, i) => i);
    const { shown, more } = capQueue(rows);
    expect(shown).toHaveLength(QUEUE_CAP);
    expect(shown[0]).toBe(0);
    expect(more).toBe(true);
  });
  it('handles an empty queue', () => {
    expect(capQueue([])).toEqual({ shown: [], more: false });
  });
  it('can be uncapped with Infinity', () => {
    const rows = Array.from({ length: 9 }, (_, i) => i);
    expect(capQueue(rows, Infinity)).toEqual({ shown: rows, more: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/dashboard/queue-cap.test.ts`
Expected: FAIL — cannot resolve `./queue`.

- [ ] **Step 3: Implement `lib/dashboard/queue.ts`**

```ts
/** Rows a dashboard queue shows before handing off to the full list. */
export const QUEUE_CAP = 5;

export function capQueue<T>(rows: readonly T[], cap: number = QUEUE_CAP): { shown: T[]; more: boolean } {
  return { shown: rows.slice(0, cap), more: rows.length > cap };
}
```

Run: `pnpm vitest run lib/dashboard/queue-cap.test.ts` — Expected: PASS.

- [ ] **Step 4: Export `Tone`**

In `components/ui/index.tsx` line 23 change `type Tone = 'info' | 'warning' | 'danger' | 'success';` to `export type Tone = 'info' | 'warning' | 'danger' | 'success';`.

- [ ] **Step 5: `StatTile` emphasis**

In `components/ui/stat.tsx`, replace the `StatTile` function with:

```tsx
export function StatTile({
  label,
  value,
  hint,
  href,
  emphasis = false,
  testId,
}: {
  label: string;
  value: number | null;
  hint?: string;
  /** Makes the whole tile a link to the list the number came from. */
  href?: string;
  /**
   * The one tile per dashboard that answers "is there work for me?". It wears
   * the lime highlight; the numeral still wears text ink (rule above).
   */
  emphasis?: boolean;
  testId?: string;
}): React.JSX.Element {
  const labelTone = emphasis ? 'text-highlight-foreground' : 'text-muted-foreground';
  const body = (
    <CardContent className="space-y-1">
      {value === null ? (
        <Skeleton className="h-9 w-16" />
      ) : (
        <p className="font-display text-3xl font-medium leading-none tabular-nums">{value}</p>
      )}
      <p className={cn('text-sm font-medium', labelTone)}>{label}</p>
      {hint !== undefined && <p className={cn('text-xs', labelTone)}>{hint}</p>}
    </CardContent>
  );
  const surface = emphasis ? 'border-highlight-edge bg-highlight text-highlight-foreground' : undefined;

  if (href === undefined) {
    return (
      <CardRoot className={surface} data-testid={testId}>
        {body}
      </CardRoot>
    );
  }

  return (
    <CardRoot
      className={cn('transition-colors hover:border-primary focus-within:border-primary', surface)}
      data-testid={testId}
    >
      <Link href={href} className="block rounded-lg outline-none">
        {body}
      </Link>
    </CardRoot>
  );
}
```

- [ ] **Step 6: Dictionary keys**

In `lib/i18n/dictionary.ts`, directly after the `workspaceTasks:` line of **each** dictionary (`ar` ~line 378, `fr` ~line 1087, `en` ~line 1816), add:

| key | ar | fr | en |
|---|---|---|---|
| `dashSeeAll` | `'عرض الكل'` | `'Tout voir'` | `'See all'` |
| `dashStale` | `'لا تحديث منذ أكثر من 48 ساعة'` | `'Sans mise à jour depuis plus de 48 h'` | `'No update for over 48 h'` |

- [ ] **Step 7: Create `components/dashboard/queue.tsx`**

```tsx
'use client';

import Link from '../ui/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useRelativeAge, useT } from '../../lib/i18n/provider';
import { cn } from '../../lib/utils';
import { EmptyState, SectionHeading, type Tone } from '../ui';

/**
 * The three pieces every role's home screen is built from (spec 2026-09-25 §4.3).
 *
 * A dashboard answers one question — "what needs me?" — so it is a band of
 * counts and then short queues ordered by who owes the next move, each row
 * carrying the one action it needs. The full list stays one click away.
 */

export function DashboardHeader({
  greeting,
  subtitle,
  action,
  children,
}: {
  greeting: string;
  subtitle?: string;
  action?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="space-y-5 rounded-lg bg-secondary px-4 py-5 text-secondary-foreground sm:px-6"
      data-testid="dashboard-header"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl font-normal tracking-tight">{greeting}</h1>
          {subtitle !== undefined && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function QueueSection({
  title,
  count,
  seeAllHref,
  more = false,
  empty,
  testId,
  emptyTestId,
  children,
}: {
  title: string;
  /** The full size of the queue, not the number of rows shown. */
  count: number;
  seeAllHref?: string;
  /** True when rows were cut at the cap — only then does "see all" appear. */
  more?: boolean;
  empty: string;
  testId?: string;
  emptyTestId?: string;
  children: ReactNode;
}): React.JSX.Element {
  const t = useT();
  const seeAll =
    seeAllHref !== undefined && more ? (
      <Link
        href={seeAllHref}
        className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        data-testid={testId === undefined ? undefined : `${testId}-see-all`}
      >
        {t.dashSeeAll}
        <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
      </Link>
    ) : undefined;

  return (
    <section className="space-y-3" aria-label={title}>
      <SectionHeading actions={seeAll}>
        {title}
        <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      </SectionHeading>
      {count === 0 ? (
        <EmptyState testId={emptyTestId}>{empty}</EmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" data-testid={testId}>
          {children}
        </ul>
      )}
    </section>
  );
}

const RAIL: Record<Tone | 'neutral', string> = {
  info: 'border-s-info',
  warning: 'border-s-warning',
  danger: 'border-s-danger',
  success: 'border-s-success',
  neutral: 'border-s-border',
};

export function QueueRow({
  reference,
  mono = true,
  href,
  label,
  secondary,
  tone,
  at,
  stale = false,
  action,
  testId,
  dataStatus,
}: {
  /** A case reference (mono) or an organisation name (`mono={false}`). */
  reference: string;
  mono?: boolean;
  href: string;
  label: string;
  secondary?: string;
  /** Leading rail colour; the same tone the status badge uses. */
  tone?: Tone;
  /** ISO instant the row's age is measured from. */
  at: string;
  stale?: boolean;
  action?: ReactNode;
  testId?: string;
  dataStatus?: string;
}): React.JSX.Element {
  const t = useT();
  const age = useRelativeAge();

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-s-[3px] px-4 py-3',
        RAIL[tone ?? 'neutral'],
      )}
      data-testid={testId}
      data-status={dataStatus}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* The reference is the link, not the whole row: the row may also hold
              a button, and interactive content cannot nest. */}
          <Link
            href={href}
            className={cn(
              'rounded-sm hover:text-primary hover:underline',
              mono ? 'font-mono text-xs font-semibold' : 'text-sm font-semibold',
            )}
          >
            <bdi>{reference}</bdi>
          </Link>
          <span className="text-sm">{label}</span>
        </div>
        {secondary !== undefined && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{secondary}</p>
        )}
      </div>
      <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
        {stale && (
          <>
            <span className="size-2 rounded-full bg-warning" title={t.dashStale} aria-hidden="true" />
            <span className="sr-only">{t.dashStale}</span>
          </>
        )}
        <time dateTime={at}>{age(at)}</time>
      </span>
      {action !== undefined && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </li>
  );
}
```

- [ ] **Step 8: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run lib components`
Expected: no errors; PASS.

```bash
git add lib/dashboard/queue.ts lib/dashboard/queue-cap.test.ts components/dashboard/queue.tsx components/ui/stat.tsx components/ui/index.tsx lib/i18n/dictionary.ts
git commit -m "feat(dashboard): header band, capped queues and queue rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shell — slim header, identity block, no app footer

**Files:**
- Modify: `components/shell/LocaleSelect.tsx` (optional `id` prop)
- Modify: `components/shell/AppChrome.tsx` (header right cluster ~lines 136-141, sidebar ~lines 84-97, sheet ~lines 108-118, footer ~lines 153-161)

**Interfaces:**
- Consumes: `useSession()` from `lib/session/session` (`{ user: { displayName } | null }`), `useCurrentProvider()` from `lib/provider/current-provider` (`{ provider: Provider | null }`), `Avatar` from `components/ui`.
- Produces: `LocaleSelect({ id?: string })`; sidebar identity block with `data-testid="sidebar-identity"`.

- [ ] **Step 1: `LocaleSelect` accepts an id**

The select renders in both the desktop sidebar (always in the DOM, hidden under `md`) and the drawer, so two copies would share `id="locale-select"`. In `components/shell/LocaleSelect.tsx` change the signature:

```tsx
export function LocaleSelect({ id = 'locale-select' }: { id?: string } = {}): React.JSX.Element {
```

and use `htmlFor={id}` on the label and `id={id}` on the `Select`.

- [ ] **Step 2: Add the identity block to `AppChrome.tsx`**

Add imports (replacing the existing `import { Sheet, SheetContent, SheetTrigger } from '../ui';`):

```ts
import { useSession } from '../../lib/session/session';
import { useCurrentProvider } from '../../lib/provider/current-provider';
import { Avatar, Sheet, SheetContent, SheetTrigger } from '../ui';
```

Append at the end of the file:

```tsx
/**
 * Who is working, for which organisation, and the two appearance controls.
 *
 * Pinned to the bottom of the rail so the header carries only navigation and
 * the account menu. The controls cannot move INTO the account menu: the theme
 * control is itself a menu and the language control a native select, and a
 * menu captures the keys both need. The disclaimer lives here now that the
 * signed-in footer is gone — it must stay on every screen.
 */
function SidebarIdentity({ localeId }: { localeId: string }): React.JSX.Element {
  const t = useT();
  const { user } = useSession();
  const { provider } = useCurrentProvider();

  return (
    <div className="mt-auto space-y-3 border-t pt-4" data-testid="sidebar-identity">
      {user !== null && (
        <div className="flex items-center gap-2 px-2">
          <Avatar name={user.displayName} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            {provider !== null && (
              <p className="truncate text-xs text-muted-foreground">{provider.legalName}</p>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2">
        <LocaleSelect id={localeId} />
        <ThemeToggle />
      </div>
      <p className="px-2 text-xs text-muted-foreground">{t.footerDisclaimer}</p>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the rail and the drawer**

In the desktop `<aside>`, after `<SidebarNav sections={sections} isCurrent={isCurrent} t={t} />` add:

```tsx
              <SidebarIdentity localeId="locale-select" />
```

In the `SheetContent`, after the `<div className="overflow-y-auto">…</div>` add:

```tsx
                    <SidebarIdentity localeId="locale-select-drawer" />
```

If `SheetContent`'s inner container (see `components/ui/sheet.tsx`) is not a flex column, wrap the nav div and the identity block in `<div className="flex min-h-0 flex-1 flex-col">` so `mt-auto` pins the block to the bottom. Check the rendered drawer in Task 9.

- [ ] **Step 4: Slim the header**

Replace:

```tsx
              <div className="ms-auto flex items-center gap-1.5">
                <LocaleSelect />
                <ThemeToggle />
                <UserMenu />
              </div>
```

with:

```tsx
              <div className="ms-auto flex items-center gap-1.5">
                {/* With a sidebar, the appearance controls live at its foot. A
                    role with no navigation has no sidebar, so they stay here. */}
                {sections.length === 0 && (
                  <>
                    <LocaleSelect />
                    <ThemeToggle />
                  </>
                )}
                <UserMenu />
              </div>
```

- [ ] **Step 5: Remove the footer**

Replace the whole `<footer className="border-t bg-card">…</footer>` element with:

```tsx
          {/* No sidebar means no identity block, so the disclaimer is kept here
              for those accounts rather than lost with the footer. */}
          {sections.length === 0 && (
            <p className="px-4 py-4 text-xs text-muted-foreground sm:px-6">{t.footerDisclaimer}</p>
          )}
```

`BrandMark` stays imported (the sidebar and header wordmarks use it). `t.appTagline` is no longer used in this file; leave the dictionary key (confirm other users with `grep -rn appTagline app components`).

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: no errors; all PASS.

```bash
git add components/shell/AppChrome.tsx components/shell/LocaleSelect.tsx
git commit -m "feat(shell): identity block in the rail; header and footer slimmed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Clinic dashboard — `/workspace`

**Files:**
- Create: `lib/dashboard/workspace-model.ts`, `lib/dashboard/workspace-model.test.ts`
- Modify: `app/workspace/page.tsx` (imports and the whole `Workspace` function)
- Modify: `lib/i18n/dictionary.ts`

**Interfaces:**
- Consumes: `isAwaitingSide`, `isWaitingOnOther` (Task 1), `nextActionKey`, `nextActionLabel`, `caseStatusTone` (existing, `components/case/labels.ts`); `isStale`, `isWithinDays` (Task 2); `capQueue` (Task 3); `DashboardHeader`, `QueueSection`, `QueueRow` (Task 3); `StatTile`, `StatGrid`, `Card` from `components/ui`.
- Produces: `workspaceModel(cases: readonly Case[], side: CaseSide | null, now: number): { tasks: Case[]; waiting: Case[]; stale: Case[]; answered: Case[] }`.

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/workspace-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Case, CaseStatus } from '@mir/contracts';
import { workspaceModel } from './workspace-model';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const H = 60 * 60 * 1000;

function c(ref: string, status: CaseStatus, hoursAgo: number): Case {
  const at = new Date(NOW - hoursAgo * H).toISOString();
  return {
    ref,
    corridorId: 'x',
    status,
    submittedByProviderId: 'p',
    patientId: 'pt',
    studyIds: [],
    createdAt: at,
    updatedAt: at,
    intake: {},
  } as Case;
}

describe('workspaceModel', () => {
  it('is all empty for no cases, and has no tasks for an unknown side', () => {
    expect(workspaceModel([], 'source', NOW)).toEqual({ tasks: [], waiting: [], stale: [], answered: [] });
    const m = workspaceModel([c('MIR-2026-0001', 'submitted', 1)], null, NOW);
    expect(m.tasks).toEqual([]);
    expect(m.waiting).toEqual([]);
  });

  it('splits the clinic’s tasks from cases waiting on the doctor, oldest first', () => {
    const cases = [
      c('MIR-2026-0003', 'submitted', 1),
      c('MIR-2026-0002', 'paid', 5),
      c('MIR-2026-0001', 'submitted', 10),
      c('MIR-2026-0004', 'accepted', 2),
    ];
    const m = workspaceModel(cases, 'source', NOW);
    expect(m.tasks.map((x) => x.ref)).toEqual(['MIR-2026-0001', 'MIR-2026-0003']);
    expect(m.waiting.map((x) => x.ref)).toEqual(['MIR-2026-0002', 'MIR-2026-0004']);
  });

  it('counts stale live cases and cases answered within 7 days', () => {
    const cases = [
      c('MIR-2026-0001', 'paid', 60),
      c('MIR-2026-0002', 'answered', 24),
      c('MIR-2026-0003', 'closed', 24 * 9),
      c('MIR-2026-0004', 'cancelled', 200),
    ];
    const m = workspaceModel(cases, 'source', NOW);
    expect(m.stale.map((x) => x.ref)).toEqual(['MIR-2026-0001']);
    expect(m.answered.map((x) => x.ref)).toEqual(['MIR-2026-0002']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/dashboard/workspace-model.test.ts`
Expected: FAIL — cannot resolve `./workspace-model`.

- [ ] **Step 3: Implement `lib/dashboard/workspace-model.ts`**

```ts
import { isTerminalStatus, type Case, type CaseSide } from '@mir/contracts';
import { isAwaitingSide, isWaitingOnOther } from '../../components/case/labels';
import { isStale, isWithinDays } from './time';

const oldestFirst = (a: Case, b: Case): number => Date.parse(a.updatedAt) - Date.parse(b.updatedAt);

/**
 * The clinic dashboard's buckets. Oldest first: the case that has waited
 * longest for this clinic is the one at the top of its morning.
 */
export function workspaceModel(
  cases: readonly Case[],
  side: CaseSide | null,
  now: number,
): { tasks: Case[]; waiting: Case[]; stale: Case[]; answered: Case[] } {
  const active = cases.filter((item) => !isTerminalStatus(item.status));
  return {
    tasks:
      side === null ? [] : active.filter((item) => isAwaitingSide(item.status, side)).sort(oldestFirst),
    waiting:
      side === null ? [] : active.filter((item) => isWaitingOnOther(item.status, side)).sort(oldestFirst),
    stale: active.filter((item) => isStale(item, now)).sort(oldestFirst),
    answered: cases.filter(
      (item) =>
        (item.status === 'answered' || item.status === 'closed') && isWithinDays(item.updatedAt, 7, now),
    ),
  };
}
```

Run: `pnpm vitest run lib/dashboard/workspace-model.test.ts` — Expected: PASS.

- [ ] **Step 4: Dictionary keys**

Add after `dashStale` in each dictionary:

| key | ar | fr | en |
|---|---|---|---|
| `dashHello` | `'مرحبًا،'` | `'Bonjour,'` | `'Hello,'` |
| `dashNeedsYou` | `'بحاجة إليك'` | `'À traiter'` | `'Needs you'` |
| `dashWaitingDoctor` | `'بانتظار الطبيب'` | `'En attente du médecin'` | `'Waiting on doctor'` |
| `dashWaitingEmpty` | `'لا شيء بانتظار الطبيب.'` | `'Rien en attente du médecin.'` | `'Nothing is waiting on a doctor.'` |
| `dashStaleTile` | `'متأخرة'` | `'Sans suite'` | `'Stale'` |
| `dashAnswered7d` | `'أُجيب عنها · 7 أيام'` | `'Répondus · 7 jours'` | `'Answered · 7 days'` |
| `dashYourClinic` | `'مؤسستك'` | `'Votre établissement'` | `'Your organisation'` |
| `dashQuickLinks` | `'روابط سريعة'` | `'Accès rapides'` | `'Quick links'` |
| `dashActionPick` | `'اختر'` | `'Choisir'` | `'Pick'` |
| `dashActionPay` | `'ادفع'` | `'Payer'` | `'Pay'` |
| `dashActionOpen` | `'فتح'` | `'Ouvrir'` | `'Open'` |

- [ ] **Step 5: Rewrite `app/workspace/page.tsx`**

Keep the file's doc comment and the `WorkspacePage` export unchanged. Replace the imports with:

```tsx
'use client';

import Link from '../../components/ui/link';
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import type { Case, CaseSide } from '@mir/contracts';
import { casesApi } from '../../lib/api/mock';
import { PROVIDER_ROLES } from '../../lib/corridor/registry';
import { useCurrentProvider } from '../../lib/provider/current-provider';
import { useSession } from '../../lib/session/session';
import { useT } from '../../lib/i18n/provider';
import type { Dictionary } from '../../lib/i18n/dictionary';
import { cn } from '../../lib/utils';
import { capQueue } from '../../lib/dashboard/queue';
import { isStale } from '../../lib/dashboard/time';
import { workspaceModel } from '../../lib/dashboard/workspace-model';
import { RoleGate } from '../../components/RoleGate';
import { caseStatusTone, nextActionKey, nextActionLabel } from '../../components/case/labels';
import { DashboardHeader, QueueRow, QueueSection } from '../../components/dashboard/queue';
import { Alert, Card, Main, Spinner, StatGrid, StatTile, buttonVariants } from '../../components/ui';
```

Replace the `Workspace` function with:

```tsx
function Workspace(): React.JSX.Element {
  const t = useT();
  const { user } = useSession();
  const { provider, providerId, side, loading } = useCurrentProvider();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (providerId === null) {
      setCases([]);
      return;
    }
    void casesApi
      .listCases({ providerId })
      .then(setCases)
      .catch(() => {
        setError(t.genericError);
        setCases([]);
      });
  }, [providerId, loading, t]);

  if (loading || cases === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const now = Date.now();
  const { tasks, waiting, stale, answered } = workspaceModel(cases, side, now);
  const shownTasks = capQueue(tasks);
  const shownWaiting = capQueue(waiting);
  const isSource = side === 'source';

  return (
    <Main wide className="space-y-6">
      <DashboardHeader
        greeting={user === null ? t.workspaceTitle : `${t.dashHello} ${user.displayName}`}
        subtitle={t.workspaceDescription}
        action={
          isSource ? (
            <Link href="/cases/new" className={buttonVariants()}>
              {t.casesNew}
            </Link>
          ) : undefined
        }
      >
        <StatGrid>
          <StatTile label={t.dashNeedsYou} value={tasks.length} href="/cases" emphasis testId="tile-needs-you" />
          <StatTile label={t.dashWaitingDoctor} value={waiting.length} testId="tile-waiting" />
          <StatTile label={t.dashStaleTile} value={stale.length} hint={t.dashStale} testId="tile-stale" />
          <StatTile label={t.dashAnswered7d} value={answered.length} testId="tile-answered" />
        </StatGrid>
      </DashboardHeader>

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <QueueSection
            title={t.dashNeedsYou}
            count={tasks.length}
            more={shownTasks.more}
            seeAllHref="/cases"
            empty={t.workspaceTasksEmpty}
            testId="task-list"
            emptyTestId="tasks-empty"
          >
            {shownTasks.shown.map((item) => (
              <QueueRow
                key={item.ref}
                reference={item.ref}
                href={`/cases/${item.ref}`}
                label={side === null ? '—' : nextActionLabel(t, item.status, side)}
                tone={caseStatusTone(item.status)}
                at={item.updatedAt}
                stale={isStale(item, now)}
                dataStatus={item.status}
                action={side === null ? undefined : <TaskAction t={t} item={item} side={side} />}
              />
            ))}
          </QueueSection>

          <QueueSection
            title={t.dashWaitingDoctor}
            count={waiting.length}
            more={shownWaiting.more}
            seeAllHref="/cases"
            empty={t.dashWaitingEmpty}
            testId="waiting-list"
            emptyTestId="waiting-empty"
          >
            {shownWaiting.shown.map((item) => (
              <QueueRow
                key={item.ref}
                reference={item.ref}
                href={`/cases/${item.ref}`}
                label={side === null ? '—' : nextActionLabel(t, item.status, side)}
                tone={caseStatusTone(item.status)}
                at={item.updatedAt}
                stale={isStale(item, now)}
                dataStatus={item.status}
              />
            ))}
          </QueueSection>
        </div>

        <aside className="space-y-5">
          <Card title={t.dashYourClinic}>
            {/* §5.5 P0: the account is an organisation with several users, so
                the seat count is stated rather than implied by whoever is
                logged in. */}
            <p className="flex items-center gap-2 text-sm">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-display text-2xl font-medium tabular-nums" data-testid="seat-count">
                {provider?.seatCount ?? '—'}
              </span>
              <span className="text-muted-foreground">{t.workspaceSeats}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{provider?.legalName ?? ''}</p>
            <Link
              href="/settings/team"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3')}
            >
              {t.settingsTeam}
            </Link>
          </Card>

          {isSource && (
            <Card title={t.dashQuickLinks}>
              <ul className="space-y-1 text-sm">
                {(
                  [
                    ['/cases/new', t.casesNew],
                    ['/upload', t.navUpload],
                    ['/patients', t.navPatients],
                  ] as const
                ).map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="font-medium text-primary hover:underline">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </Main>
  );
}

/** The one button a task row needs, chosen from the same table as its label. */
function TaskAction({ t, item, side }: { t: Dictionary; item: Case; side: CaseSide }): React.JSX.Element {
  const key = nextActionKey(item.status, side);
  const label = key === 'pickDoctor' ? t.dashActionPick : key === 'pay' ? t.dashActionPay : t.dashActionOpen;
  const href = key === 'pickDoctor' ? `/cases/${item.ref}/pick-doctor` : `/cases/${item.ref}`;
  return (
    <Link href={href} className={buttonVariants({ size: 'sm' })} data-testid="task-action">
      {label}
    </Link>
  );
}
```

If `Card`'s `title` prop (`components/ui/index.tsx:93`) renders differently from what the other pages expect, match those pages.

- [ ] **Step 6: Remove the now-unused key**

Run: `grep -rn "workspaceActiveCases" app components lib`. If the only hits are in `lib/i18n/dictionary.ts`, delete that line from all three dictionaries.

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: no errors; all PASS.

```bash
git add lib/dashboard/workspace-model.ts lib/dashboard/workspace-model.test.ts app/workspace/page.tsx lib/i18n/dictionary.ts
git commit -m "feat(workspace): action-queue dashboard for the clinic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Doctor dashboard — `/doctor`

**Files:**
- Create: `lib/dashboard/doctor-model.ts`, `lib/dashboard/doctor-model.test.ts`
- Modify: `app/doctor/page.tsx` (imports, remove `ACTIONABLE`, the `Inbox` render)
- Modify: `lib/i18n/dictionary.ts`

**Interfaces:**
- Consumes: `CaseRecord` from `lib/api/endpoints` (`id`, `caseRef`, `status`, `updatedAt`, `answerDueAt`, `answeredAt`, `specialty`, `reason`); `isWithinDays`, `isStale` (Task 2); queue components (Task 3).
- Produces: `doctorModel(cases: readonly CaseRecord[], now: number): { triage: CaseRecord[]; answering: CaseRecord[]; answered: CaseRecord[] }`.

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/doctor-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CaseRecord } from '../api/endpoints';
import { doctorModel } from './doctor-model';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const H = 60 * 60 * 1000;
const iso = (hoursAgo: number): string => new Date(NOW - hoursAgo * H).toISOString();

function r(id: string, status: CaseRecord['status'], extra: Partial<CaseRecord> = {}): CaseRecord {
  return { id, caseRef: id, status, updatedAt: iso(1), answerDueAt: null, answeredAt: null, ...extra } as CaseRecord;
}

describe('doctorModel', () => {
  it('is empty for no cases', () => {
    expect(doctorModel([], NOW)).toEqual({ triage: [], answering: [], answered: [] });
  });

  it('puts paid cases in triage oldest first, and accepted ones by answer due date', () => {
    const m = doctorModel(
      [
        r('a', 'paid', { updatedAt: iso(1) }),
        r('b', 'paid', { updatedAt: iso(9) }),
        r('c', 'accepted', { answerDueAt: new Date(NOW + 30 * H).toISOString() }),
        r('d', 'accepted', { answerDueAt: new Date(NOW + 2 * H).toISOString() }),
      ],
      NOW,
    );
    expect(m.triage.map((x) => x.id)).toEqual(['b', 'a']);
    expect(m.answering.map((x) => x.id)).toEqual(['d', 'c']);
  });

  it('is uncapped — the doctor has no other list to hand off to', () => {
    const many = Array.from({ length: 12 }, (_, i) => r(`p${i}`, 'paid'));
    expect(doctorModel(many, NOW).triage).toHaveLength(12);
  });

  it('counts answers from the last 7 days, ignoring null answeredAt', () => {
    const m = doctorModel(
      [
        r('x', 'answered', { answeredAt: iso(24) }),
        r('y', 'closed', { answeredAt: iso(24 * 10) }),
        r('z', 'answered', { answeredAt: null }),
      ],
      NOW,
    );
    expect(m.answered.map((x) => x.id)).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/dashboard/doctor-model.test.ts`
Expected: FAIL — cannot resolve `./doctor-model`.

- [ ] **Step 3: Implement `lib/dashboard/doctor-model.ts`**

```ts
import type { CaseRecord } from '../api/endpoints';
import { isWithinDays } from './time';

const at = (iso: string | null, fallback: string): number => Date.parse(iso ?? fallback);

/**
 * The receiving doctor's buckets. Triage is oldest first (the lab has waited
 * longest); answering is soonest-due first, because accepting started a clock.
 * Uncapped on purpose: this screen IS the doctor's list.
 */
export function doctorModel(
  cases: readonly CaseRecord[],
  now: number,
): { triage: CaseRecord[]; answering: CaseRecord[]; answered: CaseRecord[] } {
  return {
    triage: cases
      .filter((c) => c.status === 'paid')
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)),
    answering: cases
      .filter((c) => c.status === 'accepted')
      .sort((a, b) => at(a.answerDueAt, a.updatedAt) - at(b.answerDueAt, b.updatedAt)),
    answered: cases.filter((c) => isWithinDays(c.answeredAt, 7, now)),
  };
}
```

Run: `pnpm vitest run lib/dashboard/doctor-model.test.ts` — Expected: PASS.

- [ ] **Step 4: Dictionary keys**

Add after `dashActionOpen` in each dictionary:

| key | ar | fr | en |
|---|---|---|---|
| `dashToTriage` | `'بانتظار قرارك'` | `'À trier'` | `'To triage'` |
| `dashToAnswer` | `'بانتظار ردك'` | `'À répondre'` | `'To answer'` |
| `dashToAnswerEmpty` | `'لا حالات بانتظار ردك.'` | `'Aucun dossier en attente de votre réponse.'` | `'No cases waiting for your answer.'` |

- [ ] **Step 5: Rewrite the `Inbox` render in `app/doctor/page.tsx`**

Keep the file doc comment, `DoctorInboxPage`, and inside `Inbox` keep `t`, `formatDate`, all state, `load`, the effect and `act` exactly as they are. Delete the `ACTIONABLE` constant and the `rows` line.

Replace the imports with:

```tsx
'use client';

import Link from '../../components/ui/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type CaseRecord } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { cn } from '../../lib/utils';
import { doctorModel } from '../../lib/dashboard/doctor-model';
import { isStale } from '../../lib/dashboard/time';
import { caseStatusTone, patientBriefLabel, specialtyLabel } from '../../components/case/labels';
import { DashboardHeader, QueueRow, QueueSection } from '../../components/dashboard/queue';
import { RoleGate } from '../../components/RoleGate';
import { Alert, Button, buttonVariants, Card, Main, Spinner, StatGrid, StatTile } from '../../components/ui';
```

Add `const { user } = useSession();` after `const formatDate = useDateFormat();`.

Replace everything from `return (` to the end of `Inbox` with:

```tsx
  if (cases === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const now = Date.now();
  const { triage, answering, answered } = doctorModel(cases, now);
  // Age and sex, then the referral reason — the summary a doctor decides on.
  // Never the patient's name: migration 0028 removed that grant.
  const summary = (c: CaseRecord): string =>
    [patientBriefLabel(t, c), c.reason].filter((part) => part !== null && part !== '').join(' · ');

  return (
    <Main wide className="space-y-6">
      <DashboardHeader
        greeting={user === null ? t.inboxTitle : `${t.dashHello} ${user.displayName}`}
        subtitle={t.inboxDescription}
      >
        <StatGrid className="lg:grid-cols-3">
          <StatTile label={t.dashToTriage} value={triage.length} emphasis testId="tile-triage" />
          <StatTile label={t.dashToAnswer} value={answering.length} testId="tile-answer" />
          <StatTile label={t.dashAnswered7d} value={answered.length} testId="tile-answered" />
        </StatGrid>
      </DashboardHeader>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <QueueSection
            title={t.dashToTriage}
            count={triage.length}
            empty={t.inboxEmpty}
            testId="inbox-list"
            emptyTestId="inbox-empty"
          >
            {triage.map((c) => (
              <QueueRow
                key={c.id}
                testId="inbox-row"
                dataStatus={c.status}
                reference={c.caseRef}
                href={`/cases/${c.id}`}
                label={specialtyLabel(t, c.specialty)}
                secondary={summary(c)}
                tone={caseStatusTone(c.status)}
                at={c.updatedAt}
                stale={isStale(c, now)}
                action={
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      data-testid="accept-case"
                      disabled={busyId === c.id}
                      onClick={() => void act(c.id, 'accept')}
                    >
                      {t.inboxAccept}
                    </Button>
                    <Button
                      size="sm"
                      data-testid="decline-case"
                      disabled={busyId === c.id}
                      onClick={() => void act(c.id, 'decline')}
                    >
                      {t.inboxDecline}
                    </Button>
                  </>
                }
              />
            ))}
          </QueueSection>

          <QueueSection
            title={t.dashToAnswer}
            count={answering.length}
            empty={t.dashToAnswerEmpty}
            testId="answer-list"
            emptyTestId="answer-empty"
          >
            {answering.map((c) => (
              <QueueRow
                key={c.id}
                testId="inbox-row"
                dataStatus={c.status}
                reference={c.caseRef}
                href={`/cases/${c.id}`}
                label={specialtyLabel(t, c.specialty)}
                secondary={
                  c.answerDueAt === null
                    ? summary(c)
                    : `${t.inboxAnswerDue}: ${formatDate(c.answerDueAt)} · ${summary(c)}`
                }
                tone={caseStatusTone(c.status)}
                at={c.updatedAt}
                stale={isStale(c, now)}
                action={
                  // Answering IS submitting the report, written beside the images.
                  <Link
                    href={`/cases/${c.id}`}
                    data-testid="write-report"
                    className={buttonVariants({ variant: 'default', size: 'sm' })}
                  >
                    {t.inboxWriteReport}
                  </Link>
                }
              />
            ))}
          </QueueSection>
        </div>

        <aside>
          <Card title={t.navAvailability}>
            <p className="text-sm text-muted-foreground">{t.availabilityDescription}</p>
            <Link
              href="/doctor/availability"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3')}
            >
              {t.availabilityTitle}
            </Link>
          </Card>
        </aside>
      </div>
    </Main>
  );
```

`patientBriefLabel` (`components/case/labels.ts:326`) already accepted `c` in the old table, so it accepts a `CaseRecord`.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: no errors; all PASS (including `no-hardcoded-corridor` — `app/doctor/page.tsx` is already allowlisted).

```bash
git add lib/dashboard/doctor-model.ts lib/dashboard/doctor-model.test.ts app/doctor/page.tsx lib/i18n/dictionary.ts
git commit -m "feat(doctor): triage and answer queues with inline actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Admin home — `/admin`

**Files:**
- Create: `app/admin/page.tsx`
- Modify: `components/shell/nav.ts` (admin section, ~line 149), `app/page.tsx` (`DestinationKey` ~285, `DESTINATION_ICONS` ~298, `corridorDestinationsFor` ~322, `label` ~368, `description` ~385)
- Modify: `e2e/onboarding.spec.ts:86`
- Modify: `lib/i18n/dictionary.ts`

**Interfaces:**
- Consumes: `casesApi.listAllCases(status?: CaseStatus): Promise<Case[]>`, `casesApi.listVerificationQueue(): Promise<Provider[]>` (from `lib/api/mock`); `isStale`, `isSameLocalDay` (Task 2); `capQueue` (Task 3); queue components (Task 3); `caseStatusLabel`, `caseStatusTone`, `providerKindLabel(t, kind)` from `components/case/labels`.

- [ ] **Step 1: Dictionary keys**

Add after `dashToAnswerEmpty` in each dictionary:

| key | ar | fr | en |
|---|---|---|---|
| `navAdminHome` | `'نظرة عامة'` | `'Vue d’ensemble'` | `'Overview'` |
| `adminHomeDescription` | `'ما يحتاج إلى متابعة فريق المنصّة اليوم.'` | `'Ce qui attend l’équipe plateforme aujourd’hui.'` | `'What needs the platform team today.'` |
| `dashVerificationsPending` | `'طلبات تحقق معلّقة'` | `'Vérifications en attente'` | `'Verifications pending'` |
| `dashStaleCases` | `'حالات متأخرة'` | `'Dossiers sans suite'` | `'Stale cases'` |
| `dashOpenedToday` | `'فُتحت اليوم'` | `'Ouverts aujourd’hui'` | `'Opened today'` |
| `dashActive` | `'نشطة'` | `'Actifs'` | `'Active'` |
| `dashActionReview` | `'مراجعة'` | `'Examiner'` | `'Review'` |
| `dashNoPending` | `'لا طلبات بانتظار المراجعة.'` | `'Aucune demande en attente.'` | `'No applications waiting.'` |
| `dashNoStale` | `'لا توجد حالات متأخرة.'` | `'Aucun dossier sans suite.'` | `'No stale cases.'` |

- [ ] **Step 2: Create `app/admin/page.tsx`**

```tsx
'use client';

import Link from '../../components/ui/link';
import { useEffect, useState } from 'react';
import { isTerminalStatus, type Case, type Provider } from '@mir/contracts';
import { casesApi } from '../../lib/api/mock';
import { rolesForSides } from '../../lib/corridor/registry';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { capQueue } from '../../lib/dashboard/queue';
import { isSameLocalDay, isStale } from '../../lib/dashboard/time';
import { RoleGate } from '../../components/RoleGate';
import { caseStatusLabel, caseStatusTone, providerKindLabel } from '../../components/case/labels';
import { DashboardHeader, QueueRow, QueueSection } from '../../components/dashboard/queue';
import { Alert, Card, Main, Spinner, StatGrid, StatTile, buttonVariants } from '../../components/ui';

const OPS_ROLES = rolesForSides(['ops']);

/**
 * The platform team's home (spec 2026-09-25 §5.3).
 *
 * Ops has no per-case action in the consult model, so "needs you" here is the
 * verification queue — an applicant cannot work until someone decides — and
 * the cases nobody has moved in two days, which is where a corridor silently
 * fails. Everything else is one link away.
 */
export default function AdminHomePage(): React.JSX.Element {
  return (
    <RoleGate allow={OPS_ROLES}>
      <AdminHome />
    </RoleGate>
  );
}

function AdminHome(): React.JSX.Element {
  const t = useT();
  const { user, role } = useSession();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [queue, setQueue] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([casesApi.listAllCases(), casesApi.listVerificationQueue()])
      .then(([all, pending]) => {
        setCases(all);
        setQueue(pending);
      })
      .catch(() => {
        setError(t.genericError);
        setCases([]);
        setQueue([]);
      });
  }, [t]);

  if (cases === null || queue === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const now = Date.now();
  const active = cases.filter((c) => !isTerminalStatus(c.status));
  const stale = active
    .filter((c) => isStale(c, now))
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  const openedToday = cases.filter((c) => isSameLocalDay(c.createdAt, now));
  const pending = [...queue].sort(
    (a, b) => Date.parse(a.verification.submittedAt) - Date.parse(b.verification.submittedAt),
  );
  const shownPending = capQueue(pending);
  const shownStale = capQueue(stale);

  return (
    <Main wide className="space-y-6">
      <DashboardHeader
        greeting={user === null ? t.navAdminHome : `${t.dashHello} ${user.displayName}`}
        subtitle={t.adminHomeDescription}
      >
        <StatGrid>
          <StatTile
            label={t.dashVerificationsPending}
            value={pending.length}
            href="/admin/providers"
            emphasis
            testId="tile-verifications"
          />
          <StatTile label={t.dashStaleCases} value={stale.length} hint={t.dashStale} testId="tile-stale" />
          <StatTile label={t.dashOpenedToday} value={openedToday.length} testId="tile-today" />
          <StatTile label={t.dashActive} value={active.length} href="/admin/cases" testId="tile-active" />
        </StatGrid>
      </DashboardHeader>

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <QueueSection
            title={t.adminQueueTitle}
            count={pending.length}
            more={shownPending.more}
            seeAllHref="/admin/providers"
            empty={t.dashNoPending}
            testId="verification-queue"
            emptyTestId="verification-queue-empty"
          >
            {shownPending.shown.map((p) => (
              <QueueRow
                key={p.id}
                reference={p.legalName}
                mono={false}
                href="/admin/providers"
                label={providerKindLabel(t, p.kind)}
                tone="warning"
                at={p.verification.submittedAt}
                action={
                  <Link href="/admin/providers" className={buttonVariants({ size: 'sm' })}>
                    {t.dashActionReview}
                  </Link>
                }
              />
            ))}
          </QueueSection>

          <QueueSection
            title={t.dashStaleCases}
            count={stale.length}
            more={shownStale.more}
            seeAllHref="/admin/cases"
            empty={t.dashNoStale}
            testId="stale-list"
            emptyTestId="stale-empty"
          >
            {shownStale.shown.map((c) => (
              <QueueRow
                key={c.ref}
                reference={c.ref}
                href={`/cases/${c.ref}`}
                label={caseStatusLabel(t, c.status)}
                tone={caseStatusTone(c.status)}
                at={c.updatedAt}
                stale
                dataStatus={c.status}
              />
            ))}
          </QueueSection>
        </div>

        <aside>
          <Card title={t.dashQuickLinks}>
            <ul className="space-y-1 text-sm">
              <li>
                <Link href="/admin/cases" className="font-medium text-primary hover:underline">
                  {t.navAdminCases}
                </Link>
              </li>
              <li>
                <Link href="/admin/ledger" className="font-medium text-primary hover:underline">
                  {t.navAdminLedger}
                </Link>
              </li>
              {/* Same gate as the nav: the audit log is admin-only. */}
              {role === 'admin' && (
                <li>
                  <Link href="/admin/audit" className="font-medium text-primary hover:underline">
                    {t.navAudit}
                  </Link>
                </li>
              )}
            </ul>
          </Card>
        </aside>
      </div>
    </Main>
  );
}
```

- [ ] **Step 3: Nav item**

In `components/shell/nav.ts`, add `LayoutDashboard` to the `lucide-react` import, and insert as the **first** item of the `navSectionAdmin` section:

```ts
      {
        href: '/admin',
        labelKey: 'navAdminHome',
        descriptionKey: 'adminHomeDescription',
        roles: OPS_ROLES,
        Icon: LayoutDashboard,
      },
```

`AppChrome`'s `isCurrent` already resolves `/admin` vs `/admin/cases`: on `/admin/cases` the prefix `/admin/` matches, but another item's href equals the pathname, so only `/admin/cases` lights up.

- [ ] **Step 4: Signed-in root destination**

In `app/page.tsx`:
- add `| 'adminHome'` to `DestinationKey`;
- import `LayoutDashboard` from `lucide-react` and add `adminHome: LayoutDashboard,` to `DESTINATION_ICONS`;
- in `corridorDestinationsFor`, make the ops list start with `{ key: 'adminHome', href: '/admin' },`;
- add `adminHome: t.navAdminHome,` to the `label` map and `adminHome: t.adminHomeDescription,` to the `description` map.

- [ ] **Step 5: e2e gate list**

In `e2e/onboarding.spec.ts:86` change the array to:

```ts
  for (const path of ['/cases', '/ledger', '/workspace', '/notifications', '/admin', '/admin/cases']) {
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: no errors; all PASS (including `no-hardcoded-corridor` — the new page names no role literal).

```bash
git add app/admin/page.tsx components/shell/nav.ts app/page.tsx e2e/onboarding.spec.ts lib/i18n/dictionary.ts
git commit -m "feat(admin): platform home with verification and stale-case queues

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full lists — status first, counts, paging

**Files:**
- Create: `lib/dashboard/pagination.ts`, `lib/dashboard/pagination.test.ts`, `components/ui/pager.tsx`
- Modify: `app/cases/page.tsx`, `app/admin/cases/page.tsx`
- Modify: `lib/i18n/dictionary.ts`

**Interfaces:**
- Consumes: `useDateFormat({ short: true })` (Task 2).
- Produces: `PAGE_SIZE = 25`; `pageOf<T>(rows: readonly T[], page: number, size?: number): { rows: T[]; page: number; pages: number; from: number; to: number }`; `Pager({ page: number; pages: number; from: number; to: number; total: number; onPage: (page: number) => void })`.

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/pagination.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, pageOf } from './pagination';

const rows = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('pageOf', () => {
  it('reports an empty list as one empty page', () => {
    expect(pageOf([], 1)).toEqual({ rows: [], page: 1, pages: 1, from: 0, to: 0 });
  });
  it('slices the first page', () => {
    const p = pageOf(rows(45), 1);
    expect(p.rows).toHaveLength(PAGE_SIZE);
    expect(p).toMatchObject({ page: 1, pages: 2, from: 1, to: 25 });
  });
  it('slices the last partial page', () => {
    expect(pageOf(rows(45), 2)).toMatchObject({ page: 2, pages: 2, from: 26, to: 45 });
  });
  it('clamps a page past the end — a filter shrank the list while on page 2', () => {
    const p = pageOf(rows(3), 2);
    expect(p).toMatchObject({ page: 1, pages: 1, from: 1, to: 3 });
    expect(p.rows).toEqual([1, 2, 3]);
  });
  it('clamps a page below 1', () => {
    expect(pageOf(rows(10), 0).page).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run lib/dashboard/pagination.test.ts`
Expected: FAIL — cannot resolve `./pagination`.

- [ ] **Step 3: Implement `lib/dashboard/pagination.ts`**

```ts
export const PAGE_SIZE = 25;

/**
 * One page of an already-loaded list. The page is clamped, so a filter that
 * shrinks the list under the reader never leaves them on an empty page.
 *
 * ponytail: client paging over a fully loaded list; move to server paging when
 * a provider's list exceeds a few hundred rows.
 */
export function pageOf<T>(
  rows: readonly T[],
  page: number,
  size: number = PAGE_SIZE,
): { rows: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pages,
    from: slice.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}
```

Run: `pnpm vitest run lib/dashboard/pagination.test.ts` — Expected: PASS.

- [ ] **Step 4: Dictionary keys**

Add after `dashNoStale` in each dictionary:

| key | ar | fr | en |
|---|---|---|---|
| `pagerLabel` | `'التنقل بين الصفحات'` | `'Pagination'` | `'Pagination'` |
| `pagerPrev` | `'السابق'` | `'Précédent'` | `'Previous'` |
| `pagerNext` | `'التالي'` | `'Suivant'` | `'Next'` |

- [ ] **Step 5: Create `components/ui/pager.tsx`**

```tsx
'use client';

import { useT } from '../../lib/i18n/provider';
import { Button } from './index';

/** Previous / Next under a paged table, with "26–45 / 45". Renders nothing for one page. */
export function Pager({
  page,
  pages,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
}): React.JSX.Element | null {
  const t = useT();
  if (pages <= 1) return null;
  return (
    <nav
      aria-label={t.pagerLabel}
      className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm text-muted-foreground"
      data-testid="pager"
    >
      <span className="tabular-nums">
        <bdi>{`${from}–${to} / ${total}`}</bdi>
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="pager-prev">
          {t.pagerPrev}
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="pager-next">
          {t.pagerNext}
        </Button>
      </div>
    </nav>
  );
}
```

`Button` lives in `components/ui/index.tsx`, so re-exporting `Pager` from `index.tsx` makes a circular import. **Do not** re-export it: both pages import it from `components/ui/pager` directly.

- [ ] **Step 6: Page `/cases`**

In `app/cases/page.tsx`:
- add imports `import { pageOf } from '../../lib/dashboard/pagination';` and `import { Pager } from '../../components/ui/pager';`;
- change `const formatDate = useDateFormat();` to `const formatDate = useDateFormat({ short: true });`;
- add state `const [page, setPage] = useState(1);` next to the other `useState`s, and at the start of the effect that reloads on filter change (the one calling `casesApi.listCases`, ~line 66) add `setPage(1);` — filters reset to page 1;
- change the non-loading `<Main>` to `<Main wide>`;
- change the `PageHeader` title to ``title={`${t.casesTitle} · ${cases.length}`}``;
- right before `return (` (the non-loading one), add `const paged = pageOf(cases, page);`;
- in the table header move `<TableHead>{t.colStatus}</TableHead>` **before** `<TableHead>{t.colCaseRef}</TableHead>`, and in each row move the `CaseStatusBadge` cell before the ref cell;
- iterate `paged.rows.map(...)` instead of `cases.map(...)`;
- wrap `<Table>…</Table>` in a fragment and add after it:

```tsx
          <Pager
            page={paged.page}
            pages={paged.pages}
            from={paged.from}
            to={paged.to}
            total={cases.length}
            onPage={setPage}
          />
```

- [ ] **Step 7: Page `/admin/cases`**

In `app/admin/cases/page.tsx`:
- same two imports; `useDateFormat({ short: true })`;
- `const [page, setPage] = useState(1);`; call `setPage(1)` in the search `onChange` and in both branches of the status `onChange`;
- title ``title={`${t.adminCasesTitle} · ${visible.length}`}``;
- `const paged = pageOf(visible, page);` right after `visible` is computed;
- header order: status, ref, updated (then the override columns unchanged); the same order in the row cells;
- iterate `paged.rows.map(...)`; wrap `<Table>` in a fragment and add the same `<Pager … total={visible.length} …/>` after it.

- [ ] **Step 8: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: no errors; all PASS.

```bash
git add lib/dashboard/pagination.ts lib/dashboard/pagination.test.ts components/ui/pager.tsx app/cases/page.tsx app/admin/cases/page.tsx lib/i18n/dictionary.ts
git commit -m "feat(lists): status first, counts and 25-row pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verification sweep

**Files:** none tracked (scripts live in the session scratchpad).

- [ ] **Step 1: Full unit/lint/type run**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. Record the summary line.

- [ ] **Step 2: Isolated build**

Never build in the main `apps/web` while `mir-web` or another session serves from it:

```bash
SP=<session scratchpad>
git -C /mnt/c/Users/moham/OneDrive/Desktop/MIR worktree add --detach $SP/wt HEAD
cd $SP/wt && pnpm install --frozen-lockfile --prefer-offline && pnpm --filter @mir/contracts build
cp /mnt/c/Users/moham/OneDrive/Desktop/MIR/apps/web/.env.local apps/web/.env.local
cd apps/web && API_ORIGIN=http://127.0.0.1:3100 pnpm build
pnpm exec next start -p 3002   # run in the background
```

- [ ] **Step 3: Screenshot sweep**

Sign in **through the `/login` form** (bearer injection alone renders pages signed-out on this build), then navigate in-app with `window.next.router.push(path)`. Use Playwright from `apps/web/node_modules/@playwright/test`. For each of:
- clinic `dev-doctor@example.test` / `dev-doctor-pass-1234`: `/workspace`, `/cases`
- receiver `dev-radiologist@example.test` / `dev-radio-pass-1234`: `/doctor`
- admin `dev-ops@example.test` / `dev-ops-pass-1234`: `/admin`, `/admin/cases`

capture 1440×900 full-page and 390×844 viewport, in Arabic (default) and French (switch with the sidebar/drawer locale select). Check and record each:
- no dashboard page taller than ~2 viewports at 1440 wide;
- `document.documentElement.scrollWidth <= innerWidth` at 390 wide in Arabic;
- the clinic "Needs you" tile count is below the old 44 (waiting cases now have their own queue);
- the drawer shows the identity block with the locale select and theme toggle at its bottom;
- no signed-in page shows the old footer.

- [ ] **Step 4: e2e**

In the worktree only, edit `apps/web/playwright.config.ts` so `PORT` is 3002, then run `pnpm test:e2e`.
Expected: pass. Report any failure with its output; do not mark the task done on a red run.

- [ ] **Step 5: Clean up**

Stop the `next start` on 3002 and run `git worktree remove --force $SP/wt`. Report the results to the owner with before/after screenshots.
