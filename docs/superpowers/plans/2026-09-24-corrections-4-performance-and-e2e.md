# Corrections 4 — Dashboard performance, stack e2e, UI pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every role's dashboard makes each API call once and stays inside the §8 budget, and the §10 journeys run as Playwright tests against the real local stack, with a sweep of every route per role that fails on errors, duplicate calls, overflow and slowness.

**Architecture:** Duplicate GETs are merged once, in `apiFetch`, which every screen routes through; the two remaining structural causes (the case page re-reading a record it already holds, the admin ledger asking once per organisation) are fixed where they live. A second Playwright config (`playwright.stack.config.ts`, `e2e-stack/`) drives an already-running API + web build, signs in through the real login form, sets up its own data through the API, and asserts against the database. The default stubbed suite stays hermetic and unchanged.

**Tech Stack:** Next.js 15 client pages, NestJS + PostgreSQL (RLS), Playwright, vitest, `pg`.

**Spec:** `docs/superpowers/specs/2026-09-21-platform-corrections-design.md` — §8 (performance), §10 (testing), §0 (the local world). §9 is already done: `casesApi` is live by default (`apps/web/lib/api/mock/index.ts`).

## Global Constraints

- §8 budget: "no main-thread task over 200 ms after first paint, dashboard interactive within 1 s locally."
- §10: "The final report lists what failed, not only what passed."
- Logical-direction Tailwind utilities only (lint-enforced); every visible string is a dictionary key in ar, fr and en.
- The stack suite runs only against loopback hosts — it uses dev credentials and writes to the database.
- Never build `apps/web` while another session serves from `apps/web/.next` (`pgrep -af "next start|next-server"` first).
- Money is integer minor units. $100 consult: clinic keeps $30 and owes $70 (`coordination_fee` 7000); doctor paid $20 (`doctor_payout` 2000); platform keeps $50.

## Measured baseline (2026-09-24, local, production build)

In-app navigation, every nav page, clinic / doctor / ops: settles in 53–206 ms, **no long tasks** (≥ 50 ms). Cold reload of each dashboard: DOM interactive 57–74 ms, no long tasks, session survives the reload. §8's budgets therefore already hold locally; what the traces show is **redundant requests**:

| Page | Duplicates |
|---|---|
| `/cases/:id` (both sides) | `GET /cases/:id` ×3, `GET /organisations/mine` ×2 |
| `/admin/providers` | `GET /admin/organisations` ×2 |
| `/admin/ledger` | `GET /ledger?organisationId=` ×N (one per organisation — 6 today, grows with every clinic and doctor) + `GET /admin/organisations` ×2 |

Causes: `findCaseRecord` + `casesApi.getCase` + `casesApi.listCaseEvents` each read the case (`lib/api/live/live-cases.ts`); `useCurrentProvider` and `useCaseAudience` each call `api.organisations.mine()` (`lib/provider/current-provider.ts`); `listProviders` and `listVerificationQueue` each call `api.organisations.queue()`; `listAllLedger` loops over organisations.

## Review Focus

1. **A different user signs in on the same tab while a request is in flight** — a merged request must never hand user A's answer to user B. → Task 1 test "never merges across two sessions".
2. **One caller mutates the object it got back** — a merged response shared by reference would change another screen's data. → Task 1 test "each caller gets its own copy".
3. **An organisation with no ledger entries** must still be listed on the admin ledger (zero totals), as it is today. → Task 2 `adminLedgerRows` test.
4. **The stack suite re-run against the same database** — specs must not depend on seeded rows a previous run consumed (an accepted case gets answered; an applicant gets approved). → Every stack spec creates its own case / account with a per-run stamp (Tasks 3–6).
5. **Arabic (RTL) at phone width on the new screens** (report form, viewer toolbar, read-and-report grid) — no horizontal page scroll. → Task 3 sweep asserts `scrollWidth <= innerWidth` on every route at 390 px in Arabic.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/lib/api/client.ts` (+ `client.test.ts`) | **Modify.** Merge identical in-flight GETs. |
| `apps/web/app/cases/[ref]/page.tsx` | **Modify.** The live branch adapts the record it already read. |
| `apps/api/src/modules/ledger/internal/ledger.service.ts`, `ledger.controller.ts` (+ `ledger.test.ts`) | **Modify.** `GET /ledger/all` for ops, one query. |
| `apps/web/lib/ledger/admin-rows.ts` (+ test), `lib/api/endpoints.ts`, `lib/api/live/live-cases.ts`, `app/admin/ledger/page.tsx` | **Create / modify.** Admin ledger in one request; rows from the provider list. |
| `apps/web/playwright.stack.config.ts` | **Create.** The stack suite's config: no web server, one worker. |
| `apps/web/e2e-stack/helpers.ts` | **Create.** Loopback guard, tokens, API calls, DB, sign-in, per-run data. |
| `apps/web/e2e-stack/sweep.stack.spec.ts` | **Create.** Every nav route per role: budget, duplicates, errors, overflow, screenshots. |
| `apps/web/e2e-stack/clinic.stack.spec.ts`, `doctor.stack.spec.ts`, `admin.stack.spec.ts` | **Create.** The §10 journeys. |
| `apps/web/package.json` | **Modify.** `test:stack` script; `pg`, `@types/pg` dev dependencies. |

**Running the stack for Tasks 3–8:** local Postgres (5433), Keycloak (8081), Redis, Orthanc up; `node scripts/dev-bootstrap.mjs` and `node scripts/dev-seed-imaging.mjs` run once; an API from `apps/api/dist/main.js` on `E2E_API` (default `http://127.0.0.1:3110`); the web built with `API_ORIGIN=$E2E_API pnpm build` and served with `npx next start -p 3231` (`E2E_WEB`, default `http://127.0.0.1:3231`).

---

### Task 1: Each API call once

**Files:**
- Modify: `apps/web/lib/api/client.ts`, `apps/web/app/cases/[ref]/page.tsx`
- Test: `apps/web/lib/api/client.test.ts` (create)

**Interfaces:**
- Consumes: `toCase(r: CaseRecord, corridorId: string): Case` and `timelineFor(r: CaseRecord): CaseEvent[]` from `lib/api/live/adapt.ts`; `DEFAULT_CORRIDOR_ID` from `lib/corridor/registry`.
- Produces: `apiFetch` behaviour — concurrent identical GETs (same path, same bearer token, no `signal`) share one network request; each caller receives its own parsed copy; errors reach every merged caller as `ApiError` with the status.

- [ ] **Step 1: Write the failing test** — `apps/web/lib/api/client.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, setAccessToken } from './client';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('apiFetch — identical GETs in flight', () => {
  it('share one request, and each caller gets its own copy', async () => {
    const fetchMock = vi.fn(async () => json({ organisation: { id: 'o1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([
      apiFetch<{ organisation: { id: string } }>('/organisations/mine'),
      apiFetch<{ organisation: { id: string } }>('/organisations/mine'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('asks again once the first answer is back', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/x');
    await apiFetch('/x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never merges across two sessions', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('token-a');
    const first = apiFetch('/organisations/mine');
    setAccessToken('token-b');
    const second = apiFetch('/organisations/mine');
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never merges writes, nor a request that carries its own abort signal', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([
      apiFetch('/cases', { method: 'POST', body: {} }),
      apiFetch('/cases', { method: 'POST', body: {} }),
    ]);
    const ctrl = new AbortController();
    await Promise.all([apiFetch('/y', { signal: ctrl.signal }), apiFetch('/y', { signal: ctrl.signal })]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('still rejects every merged caller with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"nope"}', { status: 404 })));
    const results = await Promise.allSettled([apiFetch('/z'), apiFetch('/z')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect((results[0] as PromiseRejectedResult).reason).toMatchObject({ status: 404 });
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run** `cd apps/web && npx vitest run lib/api/client.test.ts` → FAIL on the first test (`toHaveBeenCalledTimes(1)`, received 2).

- [ ] **Step 3: Implement** in `apps/web/lib/api/client.ts`. Add above `apiFetch`:

```ts
/**
 * Identical GETs in flight share one request — spec 2026-09-21 §8. Two hooks
 * that both need the caller's organisation on mount used to cost two round
 * trips on every screen. The key carries the bearer token, so a request
 * started for one session is never answered to the next; each caller parses
 * its own copy of the body, so one screen mutating its result cannot change
 * another's. Writes, and requests with their own abort signal, never merge.
 */
const inflight = new Map<string, Promise<{ status: number; text: string }>>();

async function send(path: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const res = await fetch(`${API_BASE}${path}`, init);
  return { status: res.status, text: res.status === 204 ? '' : await res.text() };
}
```

and replace the body of `apiFetch` after the four `headers` lines (from `const res = await fetch(` to the final `return parsed as T;`) with:

```ts
  const init: RequestInit = {
    method,
    headers,
    signal,
    // Cookies too: the edge may carry the session as a cookie while the API
    // reads a bearer token. Sending both keeps the client working under either
    // arrangement instead of silently 401ing when the deployment changes.
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  let pending: Promise<{ status: number; text: string }>;
  if (method === 'GET' && signal === undefined) {
    const key = `${accessToken ?? ''} ${path}`;
    const shared = inflight.get(key);
    if (shared !== undefined) {
      pending = shared;
    } else {
      pending = send(path, init).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
  } else {
    pending = send(path, init);
  }
  const { status, text } = await pending;

  if (status === 204) return undefined as T;

  const parsed: unknown = text === '' ? null : safeJson(text);

  if (status < 200 || status >= 300) {
    throw new ApiError(status, parsed, extractMessage(parsed) ?? `${method} ${path} failed`);
  }

  return parsed as T;
```

- [ ] **Step 4: The case page reads its case once** — in `apps/web/app/cases/[ref]/page.tsx` add

```ts
import { timelineFor, toCase } from '../../../lib/api/live/adapt';
import { DEFAULT_CORRIDOR_ID } from '../../../lib/corridor/registry';
```

and in the `if (live) {` branch of `load`, replace

```ts
      const found = await casesApi.getCase(r.id, audience);
      if (found === null) {
        setItem('missing');
        return;
      }
      setItem(found);
      const [timeline, linked] = await Promise.all([
        casesApi.listCaseEvents(r.id, audience),
        api.imaging.studiesForCase(r.id).catch(() => ({ studies: [] as Study[] })),
      ]);
      setEvents(timeline);
```

with

```ts
      // The record is already here: adapting it is free, and asking the case
      // API for it again was two more reads of the same row (§8 baseline).
      setItem(toCase(r, DEFAULT_CORRIDOR_ID));
      setEvents(timelineFor(r));
      const linked = await api.imaging
        .studiesForCase(r.id)
        .catch(() => ({ studies: [] as Study[] }));
```

(`setStudies(linked.studies)` and the report load after it stay as they are.)

- [ ] **Step 5: Run** `npx vitest run lib/api lib/provider && npx tsc --noEmit -p . && npx eslint lib/api "app/cases/[ref]/page.tsx"` → PASS, clean.

- [ ] **Step 6: Commit** — `perf(web): each API call once — identical GETs in flight share a request; the case page adapts the record it read`

---

### Task 2: The admin ledger in one request

**Files:**
- Modify: `apps/api/src/modules/ledger/internal/ledger.service.ts`, `ledger.controller.ts`; `apps/web/lib/api/endpoints.ts`, `lib/api/live/live-cases.ts`, `app/admin/ledger/page.tsx`
- Create: `apps/web/lib/ledger/admin-rows.ts`, `admin-rows.test.ts`
- Test: `apps/api/src/modules/ledger/ledger.test.ts` (extend)

**Interfaces:**
- Produces:
  - API `GET /ledger/all` (admin only) → `{ organisations: { organisationId: string; entries: LedgerEntry[] }[] }` — only organisations with entries; entries newest first.
  - `LedgerService.listAll(): Promise<{ organisationId: string; entries: LedgerEntry[] }[]>`
  - `api.ledger.all(): Promise<{ organisations: { organisationId: string; entries: LedgerEntry[] }[] }>`
  - `adminLedgerRows(providers: Provider[], grouped: { organisationId: string; entries: LedgerEntry[] }[]): { providerId: string; provider: Provider; entries: LedgerEntry[] }[]`

- [ ] **Step 1: Failing API test** — append to `apps/api/src/modules/ledger/ledger.test.ts`, which already has `h`, `ledger`, `sys(userId)` (the system identity the ledger's INSERT policy requires) and `priced()` (a paid case between two fresh practices, `src` and `dst`, each `{ orgId, doctorId }`):

```ts
describe('the ledger for ops, in one read (spec 2026-09-21 §8)', () => {
  it('groups entries by organisation, and lists only organisations that have any', async () => {
    const one = await priced();
    await runWithContext(sys(one.src.doctorId), () => ledger.accrueClinicRemittance(one.appt));
    await runWithContext(sys(one.src.doctorId), () => ledger.accrueDoctorPayout(one.appt));
    const two = await priced();
    await runWithContext(sys(two.src.doctorId), () => ledger.accrueClinicRemittance(two.appt));

    const all = await runWithContext(sys(one.src.doctorId), () => ledger.listAll());
    const kinds = new Map(all.map((g) => [g.organisationId, g.entries.map((e) => e.kind)]));
    expect(kinds.get(one.src.orgId)).toEqual(['coordination_fee']);
    expect(kinds.get(one.dst.orgId)).toEqual(['doctor_payout']);
    expect(kinds.get(two.src.orgId)).toEqual(['coordination_fee']);
    expect(kinds.has(two.dst.orgId)).toBe(false);
  });

  it('a clinic reaching the service directly still sees only its own organisation', async () => {
    const one = await priced();
    await runWithContext(sys(one.src.doctorId), () => ledger.accrueClinicRemittance(one.appt));
    await runWithContext(sys(one.src.doctorId), () => ledger.accrueDoctorPayout(one.appt));
    const seen = await runWithContext({ ...sys(one.src.doctorId), role: 'libya_doctor' }, () => ledger.listAll());
    expect(seen.map((g) => g.organisationId)).toEqual([one.src.orgId]);
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && npx vitest run src/modules/ledger` → FAIL (`listAll is not a function`).

- [ ] **Step 3: Implement** — `ledger.service.ts`, beside `listForOrganisation`:

```ts
  /**
   * Every organisation's entries in ONE read — for ops' ledger, which used to
   * ask once per organisation (spec 2026-09-21 §8). RLS still decides which
   * rows come back; the route admits only ops.
   */
  async listAll(): Promise<{ organisationId: string; entries: LedgerEntry[] }[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<DbEntry & { organisation_id: string }>(
        `SELECT e.id, e.kind, e.amount_minor, e.currency, e.status, e.occurred_at,
                e.organisation_id, a.case_ref
           FROM billing_ledger_entries e
           LEFT JOIN cases_cases a ON a.id = e.case_id
          ORDER BY e.organisation_id, e.occurred_at DESC`,
      );
      const groups = new Map<string, LedgerEntry[]>();
      for (const r of res.rows) {
        const entry = toEntry(r);
        if (entry == null) continue;
        const list = groups.get(r.organisation_id) ?? [];
        list.push(entry);
        groups.set(r.organisation_id, list);
      }
      return [...groups].map(([organisationId, entries]) => ({ organisationId, entries }));
    });
  }
```

`ledger.controller.ts`, above `list`:

```ts
  /** Ops' ledger across every organisation, in one request. */
  @RequiresRole('admin')
  @Get('all')
  async all(): Promise<{ organisations: { organisationId: string; entries: LedgerEntry[] }[] }> {
    return { organisations: await this.ledger.listAll() };
  }
```

- [ ] **Step 4: Run** `npx vitest run src/modules/ledger src/shared && npx tsc --noEmit -p .` → PASS (the route-role audit under `src/shared` must accept the new route).

- [ ] **Step 5: Failing web test** — `apps/web/lib/ledger/admin-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LedgerEntry, Provider } from '@mir/contracts';
import { adminLedgerRows } from './admin-rows';

const provider = (id: string) => ({ id, legalName: id }) as unknown as Provider;
const entry = { id: 'e1' } as unknown as LedgerEntry;

describe('adminLedgerRows', () => {
  it('lists every provider, with an empty ledger for one that has no entries', () => {
    const rows = adminLedgerRows([provider('a'), provider('b')], [{ organisationId: 'a', entries: [entry] }]);
    expect(rows.map((r) => [r.providerId, r.entries.length])).toEqual([
      ['a', 1],
      ['b', 0],
    ]);
    expect(rows[1]?.provider.legalName).toBe('b');
  });
});
```

- [ ] **Step 6: Run** `cd apps/web && npx vitest run lib/ledger/admin-rows` → FAIL (module missing).

- [ ] **Step 7: Implement** `apps/web/lib/ledger/admin-rows.ts`:

```ts
import type { LedgerEntry, Provider } from '@mir/contracts';

/**
 * One row per organisation ops can see, with its entries — `[]` when it has
 * none, so a new clinic still appears with zero totals rather than vanishing.
 */
export function adminLedgerRows(
  providers: Provider[],
  grouped: { organisationId: string; entries: LedgerEntry[] }[],
): { providerId: string; provider: Provider; entries: LedgerEntry[] }[] {
  const byOrg = new Map(grouped.map((g) => [g.organisationId, g.entries]));
  return providers.map((provider) => ({
    providerId: provider.id,
    provider,
    entries: byOrg.get(provider.id) ?? [],
  }));
}
```

`lib/api/endpoints.ts`, inside `ledger: {`:

```ts
    /** Ops only: every organisation's entries in one request. */
    all: () =>
      apiFetch<{ organisations: { organisationId: string; entries: LedgerEntry[] }[] }>(
        '/ledger/all',
      ),
```

`lib/api/live/live-cases.ts`, replace `listAllLedger`:

```ts
  async listAllLedger() {
    const { organisations } = await api.ledger.all();
    return organisations.map((g) => ({ providerId: g.organisationId, entries: g.entries }));
  },
```

`app/admin/ledger/page.tsx` (around lines 75–85, where `casesApi.listAllLedger()` and `casesApi.listProviders()` are combined): build the rows from the providers instead of from the ledgers —

```ts
        const rows = adminLedgerRows(
          providers,
          ledgers.map((l) => ({ organisationId: l.providerId, entries: l.entries })),
        );
```

— and map each row into the page's existing row type as the current code does (`provider` is now always set). Import `adminLedgerRows` from `../../../lib/ledger/admin-rows`.

- [ ] **Step 8: Run** `npx vitest run lib/ledger lib/api && npx tsc --noEmit -p . && npx eslint app/admin/ledger lib/ledger lib/api` → PASS.

- [ ] **Step 9: Commit** — `perf(ledger): ops' ledger in one request instead of one per organisation`

---

### Task 3: The stack suite, and a sweep of every route

**Files:**
- Create: `apps/web/playwright.stack.config.ts`, `apps/web/e2e-stack/helpers.ts`, `apps/web/e2e-stack/sweep.stack.spec.ts`
- Modify: `apps/web/package.json`; `apps/web/tsconfig.json` only if `e2e-stack` must be excluded from the Next build the way `e2e` is (check its `exclude`/`include`).

**Interfaces:**
- Produces (`e2e-stack/helpers.ts`):
  - `STACK: { web: string; api: string; kc: string; db: string }` — env `E2E_WEB`, `E2E_API`, `E2E_KC`, `E2E_DB`; throws at import on a non-loopback host.
  - `ACCOUNTS: Record<'clinic' | 'doctor' | 'ops' | 'assistant', { email: string; password: string; role: Role }>`
  - `token(email: string, password: string): Promise<string>`
  - `apiCall<T>(bearer: string, path: string, init?: { method?: string; body?: unknown; idempotent?: boolean }): Promise<{ status: number; body: T }>`
  - `query<T>(sql: string, params?: unknown[]): Promise<T[]>`
  - `signIn(page: Page, who: keyof typeof ACCOUNTS): Promise<void>`
  - `SEED(): Promise<{ patientId: string; studyId: string; receiverId: string }>`
  - `acceptedCase(opts?: { reason?: string }): Promise<{ id: string; ref: string }>`

- [ ] **Step 1: Dependencies and config.** From the repo root: `pnpm --filter web add -D pg@$(node -p "require('./apps/api/node_modules/pg/package.json').version") @types/pg`, then confirm `apps/web/node_modules/next/package.json` still exists (an install on this OneDrive tree has dropped it before; `pnpm install --frozen-lockfile --prefer-offline` restores it). Add `"test:stack": "playwright test -c playwright.stack.config.ts"` to `apps/web/package.json` scripts. Create `apps/web/playwright.stack.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * The stack suite — spec 2026-09-21 §10. Runs against an API and a web build
 * that are ALREADY RUNNING (e2e-stack/helpers.ts has the URLs), signs in
 * through the real login form, and writes to the local database. It never
 * starts a server; the default suite (playwright.config.ts) stays hermetic.
 */
export default defineConfig({
  testDir: './e2e-stack',
  testMatch: /.*\.stack\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: process.env['E2E_WEB'] ?? 'http://127.0.0.1:3231',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 2: Helpers** — `apps/web/e2e-stack/helpers.ts`:

```ts
import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import type { Role } from '@mir/contracts';

const env = (k: string, d: string): string => process.env[k] ?? d;
export const STACK = {
  web: env('E2E_WEB', 'http://127.0.0.1:3231'),
  api: env('E2E_API', 'http://127.0.0.1:3110'),
  kc: env('E2E_KC', 'http://localhost:8081'),
  db: env('E2E_DB', 'postgresql://postgres:postgres@127.0.0.1:5433/mir'),
};
for (const [k, v] of Object.entries(STACK)) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(v).hostname)) {
    throw new Error(`stack suite refuses a non-loopback ${k}: it uses dev credentials and writes data`);
  }
}

export const ACCOUNTS = {
  clinic: { email: 'dev-doctor@example.test', password: 'dev-doctor-pass-1234', role: 'libya_doctor' },
  doctor: { email: 'dev-receiver@example.test', password: 'dev-receiver-pass-1234', role: 'tunisia_doctor' },
  ops: { email: 'dev-ops@example.test', password: 'dev-ops-pass-1234', role: 'admin' },
  assistant: { email: 'dev-assistant@example.test', password: 'dev-assist-pass-1234', role: 'assistant' },
} as const satisfies Record<string, { email: string; password: string; role: Role }>;

export async function token(email: string, password: string): Promise<string> {
  const res = await fetch(`${STACK.kc}/realms/mir/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'mir-web', username: email, password, scope: 'openid' }),
  });
  if (!res.ok) throw new Error(`token for ${email}: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function apiCall<T = unknown>(
  bearer: string,
  path: string,
  init: { method?: string; body?: unknown; idempotent?: boolean } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${STACK.api}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      ...(init.idempotent === true ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client(STACK.db);
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

export async function signIn(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  const { email, password } = ACCOUNTS[who];
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

let seed: { patientId: string; studyId: string; receiverId: string } | null = null;
/** The seeded MR study and its patient (dev-seed-imaging.mjs), and dev-receiver. */
export async function SEED(): Promise<{ patientId: string; studyId: string; receiverId: string }> {
  if (seed !== null) return seed;
  const [row] = await query<{ patient_id: string; study_id: string; receiver: string }>(
    `SELECT c.patient_id, cs.study_id,
            (SELECT id FROM identity_users WHERE email = 'dev-receiver@example.test') AS receiver
       FROM cases_cases c JOIN cases_case_studies cs ON cs.case_id = c.id
      WHERE c.reason = 'seed:accepted'`,
  );
  if (row === undefined) {
    throw new Error('no seeded study: run scripts/dev-bootstrap.mjs then scripts/dev-seed-imaging.mjs');
  }
  seed = { patientId: row.patient_id, studyId: row.study_id, receiverId: row.receiver };
  return seed;
}

/** A fresh case accepted by dev-receiver, with the seeded MR study linked. */
export async function acceptedCase(opts: { reason?: string } = {}): Promise<{ id: string; ref: string }> {
  const s = await SEED();
  const lab = await token(ACCOUNTS.clinic.email, ACCOUNTS.clinic.password);
  const doc = await token(ACCOUNTS.doctor.email, ACCOUNTS.doctor.password);
  const must = <T>(r: { status: number; body: T }, what: string): T => {
    expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
    return r.body;
  };
  must(await apiCall(doc, '/doctors/me/accepting', { method: 'PATCH', body: { accepting: true } }), 'accepting');
  const c = must(
    await apiCall<{ id: string }>(lab, '/cases', {
      method: 'POST',
      body: {
        patientId: s.patientId,
        specialty: 'radiology',
        studyIds: [s.studyId],
        reason: opts.reason ?? `stack ${Date.now()}`,
      },
    }),
    'submit',
  );
  must(await apiCall(lab, `/cases/${c.id}/quote`, { method: 'POST', body: { doctorId: s.receiverId } }), 'quote');
  must(await apiCall(lab, `/cases/${c.id}/pay`, { method: 'POST', idempotent: true }), 'pay');
  must(await apiCall(doc, `/cases/${c.id}/accept`, { method: 'POST', idempotent: true }), 'accept');
  const [row] = await query<{ case_ref: string }>('SELECT case_ref FROM cases_cases WHERE id = $1', [c.id]);
  return { id: c.id, ref: row!.case_ref };
}
```

- [ ] **Step 3: The sweep** — `apps/web/e2e-stack/sweep.stack.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { navItemsForRole } from '../components/shell/nav';
import { ACCOUNTS, acceptedCase, signIn } from './helpers';

/**
 * Every route each role can reach — spec 2026-09-21 §8 and §10 ("every
 * dashboard and route clicked through as each role, with the console and
 * network panels open"). Per route it fails on: a console error, an API 5xx,
 * the same API GET twice, a main-thread task over 200 ms, settling later than
 * 1 s, and (Arabic, 390 px) a horizontal page scroll. A screenshot of each
 * route lands in test-results/sweep/ for the UI pass (Task 7).
 */

async function watch(page: Page) {
  const gets: string[] = [];
  const errors: string[] = [];
  let pending = 0;
  let last = Date.now();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().includes('/api/')) return;
    pending++;
    last = Date.now();
    if (r.method() === 'GET') gets.push(new URL(r.url()).pathname + new URL(r.url()).search);
  });
  const finished = (status: number | null, url: string): void => {
    pending = Math.max(0, pending - 1);
    last = Date.now();
    if (status !== null && status >= 500) errors.push(`${status} ${url}`);
  };
  page.on('requestfinished', (r) => {
    if (r.url().includes('/api/')) void r.response().then((res) => finished(res?.status() ?? null, r.url()));
  });
  page.on('requestfailed', (r) => {
    if (r.url().includes('/api/')) finished(null, r.url());
  });
  const settled = async (t0: number): Promise<number> => {
    while (Date.now() - t0 < 10_000) {
      if (pending === 0 && Date.now() - last > 300) return last - t0;
      await page.waitForTimeout(50);
    }
    return Number.POSITIVE_INFINITY;
  };
  const reset = (): void => {
    gets.length = 0;
    errors.length = 0;
  };
  return { gets, errors, settled, reset };
}

const drainLongTasks = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as unknown as { __long: number[] }).__long.splice(0));

const push = (page: Page, path: string): Promise<void> =>
  page.evaluate((p) => (window as unknown as { next: { router: { push(p: string): void } } }).next.router.push(p), path);

let caseId = '';
test.beforeAll(async () => {
  caseId = (await acceptedCase({ reason: `sweep ${Date.now()}` })).id;
});

for (const who of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
  const routes = (): string[] => [
    ...new Set([
      ...navItemsForRole(ACCOUNTS[who].role).map((i) => i.href),
      '/profile',
      '/settings',
      ...(who === 'clinic' || who === 'doctor' ? [`/cases/${caseId}`] : []),
    ]),
  ];

  test.describe(`${who}: every route`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __long: number[] };
        w.__long = [];
        new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({
          type: 'longtask',
          buffered: true,
        });
      });
    });

    test('English, desktop: fast, quiet, each call once', async ({ page }) => {
      const w = await watch(page);
      await signIn(page, who);
      await w.settled(Date.now());
      for (const path of routes()) {
        await test.step(path, async () => {
          w.reset();
          await drainLongTasks(page);
          const t0 = Date.now();
          await push(page, path);
          const ms = await w.settled(t0);
          await page.screenshot({ path: `test-results/sweep/${who}-en${path.replaceAll('/', '_')}.png`, fullPage: true });
          const dupes = w.gets.filter((g, i) => w.gets.indexOf(g) !== i);
          expect.soft(w.errors, `${path}: console errors / 5xx`).toEqual([]);
          expect.soft(dupes, `${path}: duplicate GETs`).toEqual([]);
          expect.soft(Math.max(0, ...(await drainLongTasks(page))), `${path}: longest task (ms)`).toBeLessThanOrEqual(200);
          expect.soft(ms, `${path}: settle (ms)`).toBeLessThanOrEqual(1000);
        });
      }
    });

    test('Arabic, 390 px: no horizontal scroll', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, who);
      await setArabic(page);
      for (const path of routes()) {
        await test.step(path, async () => {
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
          await page.screenshot({ path: `test-results/sweep/${who}-ar390${path.replaceAll('/', '_')}.png`, fullPage: true });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect.soft(overflow, `${path}: horizontal overflow (px)`).toBeLessThanOrEqual(0);
        });
      }
    });
  });
}

/** Switch the UI to Arabic the way a user does: the header's language select. */
async function setArabic(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: /language|langue|اللغة/i }).first().selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}
```

The login page's snapshot shows the language control is a `combobox` named "اللغة"/"Language" with options العربية / Français / English; `setArabic` selects by value `ar` — read the header component's `<option value>`s and use the real value if it differs. If Playwright cannot import `components/shell/nav.ts` (it pulls a module touching `window` at import time), copy the per-role `href` lists out of `nav.ts` into the spec with a comment naming the source.

- [ ] **Step 4: Run** the stack (see "Running the stack" above) and `cd apps/web && pnpm test:stack e2e-stack/sweep.stack.spec.ts`. After Tasks 1–2 the English duplicate assertions are expected to pass. Every soft failure is a finding: fix it in this task when it is a duplicate call, a console error, a 5xx, or an overflow with a one-file cause (commit each fix separately: `fix(<area>): …`); otherwise record it under "Findings" at the bottom of this file.

- [ ] **Step 5: Commit** — `test(e2e): a stack suite against the running app, and a sweep of every route per role`

---

### Task 4: Clinic journey (§10)

**Files:**
- Create: `apps/web/e2e-stack/clinic.stack.spec.ts`

**Interfaces:**
- Consumes: Task 3 helpers; test ids on `app/upload/page.tsx` (`patient-select`, `folder-input`), `app/cases/new/page.tsx` (`field-patient`, `field-specialty`, `field-study`, `submit-case`), `app/cases/[ref]/page.tsx` (`next-pick-doctor`), `app/cases/[ref]/pick-doctor/page.tsx` (`directory-row`, `choose-doctor`, `quoted-price`, `quoted-clinic-share`, `quoted-remittance`, `pay-case`).

- [ ] **Step 1: Write the spec** — `apps/web/e2e-stack/clinic.stack.spec.ts`:

```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { SEED, query, signIn } from './helpers';

const SERIES = join(process.cwd(), '../../test-data/dicom/03-mr-series');

test('clinic: upload the MRI → new case → pick a doctor → sees $100 / $30 / $70 → pays', async ({ page }) => {
  test.setTimeout(300_000);
  const s = await SEED();
  const [receiver] = await query<{ full_name: string }>('SELECT full_name FROM identity_users WHERE id = $1', [s.receiverId]);
  const startedAt = new Date();
  await signIn(page, 'clinic');

  // 1. Upload the series for the seeded patient; wait until ingestion made it a ready study.
  await page.goto('/upload');
  await page.getByTestId('patient-select').selectOption(s.patientId);
  await page.getByTestId('folder-input').setInputFiles(readdirSync(SERIES).map((f) => join(SERIES, f)));
  await expect
    .poll(
      async () =>
        (await query<{ n: number }>(
          `SELECT count(*)::int AS n FROM imaging_studies WHERE patient_id = $1 AND status = 'ready' AND created_at > $2`,
          [s.patientId, startedAt],
        ))[0]?.n ?? 0,
      { timeout: 240_000, intervals: [2000] },
    )
    .toBeGreaterThan(0);

  // 2. New radiology case for that patient with the new study.
  await page.goto('/cases/new');
  await page.getByTestId('field-patient').selectOption(s.patientId);
  await page.getByTestId('field-specialty').selectOption('radiology');
  await page.getByTestId('field-study').first().check();
  await page.getByTestId('submit-case').click();
  await page.waitForURL(/\/cases\/[0-9a-f-]{36}$/);
  const caseId = page.url().split('/').pop()!;

  // 3. Pick dev-receiver: the quote is the flat price and the split.
  await page.getByTestId('next-pick-doctor').click();
  await page.getByTestId('directory-row').filter({ hasText: receiver!.full_name }).getByTestId('choose-doctor').click();
  await expect(page.getByTestId('quoted-price')).toContainText('100');
  await expect(page.getByTestId('quoted-clinic-share')).toContainText('30');
  await expect(page.getByTestId('quoted-remittance')).toContainText('70');

  // 4. Pay: the case is paid and the $70 fee is on the ledger exactly once.
  await page.getByTestId('pay-case').click();
  await expect
    .poll(async () =>
      (await query<{ status: string; fees: number }>(
        `SELECT c.status,
                (SELECT count(*)::int FROM billing_ledger_entries e
                  WHERE e.case_id = c.id AND e.kind = 'coordination_fee' AND e.amount_minor = 7000) AS fees
           FROM cases_cases c WHERE c.id = $1`,
        [caseId],
      ))[0],
    )
    .toEqual({ status: 'paid', fees: 1 });
});
```

Before running, read the four screens once: if `field-patient`/`patient-select` are not native `<select>`s, if `field-study` is not a checkbox, or if `submit-case` lands somewhere other than `/cases/<uuid>`, change the matching line to what the screen really does (and keep the assertion).

- [ ] **Step 2: Run** `pnpm test:stack e2e-stack/clinic.stack.spec.ts` → PASS. A failure that is a product defect (not a selector) is fixed in the product in this task, with a unit or API test where one fits.

- [ ] **Step 3: Commit** — `test(e2e): the clinic's journey against the running stack`

---

### Task 5: Doctor journey (§10)

**Files:**
- Create: `apps/web/e2e-stack/doctor.stack.spec.ts`

**Interfaces:**
- Consumes: Task 3 helpers; `app/doctor/availability/page.tsx` (`toggle-accepting`, a `Switch` with `role="switch"`), `app/cases/[ref]/page.tsx` (`accept-case`, `read-and-report`), Plan 3 ids (`viewer`, `image-position`, `cornerstone-viewport`, `tool-length`, `report-finding-region`, `report-save-state`, `report-submit`, `report-missing`, `report-exam-type`, `report-impression-line`, `report-view`, `report-download-pdf`).

- [ ] **Step 1: Write the spec** — `apps/web/e2e-stack/doctor.stack.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ACCOUNTS, SEED, apiCall, query, signIn, token } from './helpers';

test('doctor: switch on → accept → read → report → submit → PDF', async ({ page }) => {
  test.setTimeout(240_000);
  const s = await SEED();
  await signIn(page, 'doctor');

  // Switch on, in the UI.
  await page.goto('/doctor/availability');
  const toggle = page.getByTestId('toggle-accepting');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  // The clinic sends this doctor a paid case.
  const lab = await token(ACCOUNTS.clinic.email, ACCOUNTS.clinic.password);
  const c = (
    await apiCall<{ id: string }>(lab, '/cases', {
      method: 'POST',
      body: { patientId: s.patientId, specialty: 'radiology', studyIds: [s.studyId], reason: `doctor journey ${Date.now()}` },
    })
  ).body;
  expect((await apiCall(lab, `/cases/${c.id}/quote`, { method: 'POST', body: { doctorId: s.receiverId } })).status).toBeLessThan(300);
  expect((await apiCall(lab, `/cases/${c.id}/pay`, { method: 'POST', idempotent: true })).status).toBeLessThan(300);

  // Accept on the case page; the workspace opens.
  await page.goto(`/cases/${c.id}`);
  await page.getByTestId('accept-case').click();
  await page.getByTestId('read-and-report').waitFor();

  // Read: full fidelity, the wheel moves the slice, the length tool draws.
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-fidelity', 'full', { timeout: 60_000 });
  const before = (await page.getByTestId('image-position').textContent()) ?? '';
  await page.getByTestId('cornerstone-viewport').hover();
  await page.mouse.wheel(0, 300);
  await expect(page.getByTestId('image-position')).not.toHaveText(before);
  await page.getByTestId('tool-length').click();
  const box = (await page.getByTestId('cornerstone-viewport').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-testid=cornerstone-viewport] svg text').first()).toBeVisible();

  // Report: a draft survives a reload; submit waits for what is required.
  await page.getByTestId('report-finding-region').first().fill('Posterior fossa');
  await expect(page.getByTestId('report-save-state')).not.toBeEmpty({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId('report-finding-region').first()).toHaveValue('Posterior fossa');
  await expect(page.getByTestId('report-submit')).toBeDisabled();
  await expect(page.getByTestId('report-missing')).toBeVisible();
  await page.getByTestId('report-exam-type').selectOption('mri_brain');
  await page.getByTestId('report-impression-line').first().fill('No intracranial mass.');
  await page.getByTestId('report-submit').click();
  await page.getByTestId('report-view').waitFor();

  // The PDF, and the money: one $20 payout.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-download-pdf').click()]);
  expect(readFileSync(await dl.path()).subarray(0, 5).toString()).toBe('%PDF-');
  const [row] = await query<{ status: string; payouts: number }>(
    `SELECT c.status,
            (SELECT count(*)::int FROM billing_ledger_entries e
              WHERE e.case_id = c.id AND e.kind = 'doctor_payout' AND e.amount_minor = 2000) AS payouts
       FROM cases_cases c WHERE c.id = $1`,
    [c.id],
  );
  expect(row).toEqual({ status: 'answered', payouts: 1 });
});
```

- [ ] **Step 2: Run** `pnpm test:stack e2e-stack/doctor.stack.spec.ts` → PASS.

- [ ] **Step 3: Commit** — `test(e2e): the doctor's journey — accept, read, report, PDF — against the running stack`

---

### Task 6: Admin journey and the signed-out front door (§10)

**Files:**
- Create: `apps/web/e2e-stack/admin.stack.spec.ts`
- Modify: `apps/web/e2e-stack/helpers.ts` (add `freshApplicant`)

**Interfaces:**
- Consumes: `POST /auth/register` (`registrationSchema`: `fullName`, `email`, `password`, `phoneE164`, `locale`), `POST /auth/verify-email` (`email`, `code`), DB function `identity_issue_email_code(p_email, p_code_hash, p_ttl_minutes)` (code hash = sha256 hex, `registration.service.ts`); `app/signup/provider/page.tsx` (`field-kind`, `field-side`, `field-corridor`, `field-legal-name`, `field-seats`, and the corridor fields `field-cnomNumber`, `field-specialty`, `field-facilityPermit`, then `submit-signup` → `signup-success`); `app/admin/providers/page.tsx` (`approve-${organisationId}`); `identity_organisations.legal_name`.
- Produces: `freshApplicant(): Promise<{ email: string; password: string; fullName: string }>`

- [ ] **Step 1: `freshApplicant`** — append to `helpers.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * A new, email-verified applicant. Locally the verification code goes to the
 * console mailer, so the suite re-issues a code it knows through the same
 * database function the service uses, then verifies through the API — the
 * account path under test is the real one; only the inbox is skipped.
 */
export async function freshApplicant(): Promise<{ email: string; password: string; fullName: string }> {
  const stamp = Date.now().toString();
  const email = `stack-${stamp}@example.test`;
  const password = 'stack-applicant-pass-1234';
  const fullName = `Stack Doctor ${stamp}`;
  const reg = await fetch(`${STACK.api}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, fullName, phoneE164: `+2162${stamp.slice(-7)}`, locale: 'fr' }),
  });
  if (reg.status !== 204) throw new Error(`register: ${reg.status} ${await reg.text()}`);
  const code = '424242';
  await query('SELECT identity_issue_email_code($1, $2, 15)', [
    email,
    createHash('sha256').update(code).digest('hex'),
  ]);
  const ver = await fetch(`${STACK.api}/auth/verify-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (ver.status !== 204) throw new Error(`verify: ${ver.status} ${await ver.text()}`);
  return { email, password, fullName };
}
```

- [ ] **Step 2: Write the spec** — `apps/web/e2e-stack/admin.stack.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, SEED, apiCall, freshApplicant, query, signIn, token } from './helpers';

async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('signed out, / lands on /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('ops approves a doctor → the doctor switches on → the clinic can pick them; the ledger shows the split', async ({ browser }) => {
  test.setTimeout(300_000);
  const applicant = await freshApplicant();
  const legalName = `Cabinet ${applicant.fullName}`;

  // The applicant applies as a Tunisian radiology doctor.
  const a = await (await browser.newContext()).newPage();
  await signInAs(a, applicant.email, applicant.password);
  await a.goto('/signup/provider');
  await a.getByTestId('field-side').selectOption('destination');
  await a.getByTestId('field-kind').selectOption('doctor');
  await a.getByTestId('field-legal-name').fill(legalName);
  await a.getByTestId('field-seats').fill('1');
  await a.getByTestId('field-cnomNumber').fill(`CNOM-${Date.now()}`);
  await a.getByTestId('field-specialty').selectOption('radiology');
  await a.getByTestId('field-facilityPermit').setInputFiles({ name: 'permit.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%stack\n') });
  await a.getByTestId('submit-signup').click();
  await expect(a.getByTestId('signup-success')).toBeVisible();
  const [org] = await query<{ id: string }>('SELECT id FROM identity_organisations WHERE legal_name = $1', [legalName]);

  // Ops approves it.
  const ops = await (await browser.newContext()).newPage();
  await signIn(ops, 'ops');
  await ops.goto('/admin/providers');
  await ops.getByTestId(`approve-${org!.id}`).click();
  await expect
    .poll(async () => (await query<{ s: string }>('SELECT verification_status AS s FROM identity_organisations WHERE id = $1', [org!.id]))[0]?.s)
    .toBe('approved');

  // The new doctor signs in again (the role is new) and switches on.
  const d = await (await browser.newContext()).newPage();
  await signInAs(d, applicant.email, applicant.password);
  await d.goto('/doctor/availability');
  await d.getByTestId('toggle-accepting').click();
  await expect(d.getByTestId('toggle-accepting')).toHaveAttribute('aria-checked', 'true');

  // The clinic finds them when picking a doctor for a radiology case.
  const clinic = await (await browser.newContext()).newPage();
  await signIn(clinic, 'clinic');
  // A fresh submitted radiology case (Review Focus 4: never a seeded row).
  const s = await SEED();
  const lab = await token(ACCOUNTS.clinic.email, ACCOUNTS.clinic.password);
  const fresh = await apiCall<{ id: string }>(lab, '/cases', {
    method: 'POST',
    body: { patientId: s.patientId, specialty: 'radiology', reason: `admin journey ${Date.now()}` },
  });
  expect(fresh.status).toBeLessThan(300);
  await clinic.goto(`/cases/${fresh.body.id}/pick-doctor`);
  await expect(clinic.getByTestId('directory-row').filter({ hasText: applicant.fullName })).toBeVisible();

  // Ops' ledger shows the platform's side of the split.
  await ops.goto('/admin/ledger');
  await expect(ops.getByTestId('platform-in')).toContainText(/\d/);
  await expect(ops.getByTestId('platform-margin')).toContainText(/\d/);
});
```

Two things to confirm while writing it, and fix in the spec if different: the `<option>` values of `field-side` / `field-kind` / `field-corridor` in `app/signup/provider/page.tsx` (it may need `field-corridor` set to `ly-tn` before the corridor fields render).

- [ ] **Step 3: Run** `pnpm test:stack e2e-stack/admin.stack.spec.ts` → PASS.

- [ ] **Step 4: Commit** — `test(e2e): ops approves a doctor who then reaches the clinic; signed-out / goes to login`

---

### Task 7: UI pass

**Files:** whatever the findings touch.

- [ ] **Step 1: Review** the Task 3 screenshots (`apps/web/test-results/sweep/*.png` — every route × role × {English desktop, Arabic 390 px}) with the Read tool, one role at a time. For each screen check: nothing clipped or overlapping; no English left on an Arabic screen; money, dates and counts readable (tabular figures, currency shown); every empty state says what to do next; the primary action is the visually primary button; direction-bearing icons mirror in RTL.

- [ ] **Step 2: Record** each finding as a line under "Findings" at the bottom of this file: route, role, what is wrong, severity (**breaks use** / **looks wrong** / **polish**).

- [ ] **Step 3: Fix** every "breaks use" and "looks wrong" finding, one commit per screen (`fix(ui): <screen> — <what>`), re-running `pnpm test:stack e2e-stack/sweep.stack.spec.ts` after each. "Polish" findings are listed for the owner, not fixed here.

---

### Task 8: Verification

- [ ] API full suite, contracts, web unit, default Playwright (`E2E_PORT=<free port> npx playwright test --workers=2`), the whole stack suite (`pnpm test:stack`), `npx tsc --noEmit -p .` in both apps, lint.
- [ ] Re-run the baseline measurement (in-app navigation per role; cold reload per dashboard) and put the before/after table in the notes below, with API-call counts per page.
- [ ] Execution notes at the bottom of this file: commits, suites with counts, **what failed**, and what was deferred.

---

## Findings

- **Fixed (Task 3):** `GET /cases/:id/report` answered 404 for "no report yet", so every accepted case logged a browser console error for both sides. Now 200 `null`.
- **Recorded, not fixed (polish):** a signed-out visit to `/login` makes `POST /auth/refresh` and `GET /api/auth/me`, both 401, which the browser logs as two console errors. It is the refresh-cookie session probe (4a98ac4) doing its job; a 204/`null` for "no session" would quiet it.
- **Fixed (Task 6):** approving an applicant attached the clinical realm role in Keycloak but left `applicant` on the user. The token verifier requires exactly one application role, so every newly approved doctor, clinic or assistant got 401 on every call after signing in. `KeycloakAdminClient.promote` now attaches the role and removes `applicant`; all three approval paths go through it. Users approved before the fix still carry both roles and need `applicant` removed in Keycloak by hand.
- **Recorded, not fixed (gap):** credential documents cannot be uploaded. A `kind: 'file'` credential (e.g. the facility permit) renders as a text box, so the applicant types a reference and ops has no document to check.

## Execution notes

(Filled in during Task 8.)
