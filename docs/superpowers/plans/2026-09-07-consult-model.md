# Consult Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the calendar-and-booking model with a doctor directory, a priced case, and an answer — so a Libyan lab picks a Tunisian doctor who is accepting work, at a price the platform quotes and locks.

**Architecture:** The `scheduling` module is reshaped in place into `cases`, not rebuilt, because it owns the three SECURITY DEFINER predicates the P3.2 gate tests exercise. Two migrations: one renames and strips, one adds availability and pricing. A new `pricing` module owns the quote formula; the `cases` module owns the lifecycle. The web calendar surface is deleted outright.

**Tech Stack:** TypeScript strict, NestJS, PostgreSQL 16 with row-level security, Zod contracts in `@mir/contracts`, Vitest (API + contracts), Playwright (web e2e).

**Spec:** `docs/superpowers/specs/2026-09-07-consult-model-design.md`

## Global Constraints

- **Money is integer minor units, everywhere.** `moneySchema` in `packages/contracts/src/ledger.ts` is the only shape. No floats in any price path.
- **Multipliers are integer basis points** (`10_000` = ×1.00). One rounding, half-up, at the very end of the formula.
- **The seven P3.2 gate tests in `apps/api/src/shared/db/rls.test.ts` must be green at the end of every task that touches SQL.** They are the acceptance bar for the rename. If a predicate must be loosened to make one pass, stop and escalate.
- **Every route handler carries `@RequiresRole(...)` or `@PublicEndpoint()`.** A missing decorator fails `route-access-audit.test.ts` (P1.5).
- **Migrations are reversible pairs** `NNNN_name.up.sql` / `NNNN_name.down.sql`, applied in filename sort order by `apps/api/src/shared/db/migrator.ts`.
- **A module never imports another module's `internal/`.** `pnpm boundaries` fails the build if it does.
- **Tests need Postgres on `127.0.0.1:5433`** (`docker compose up -d postgres`). Run `pnpm db:clean` if worker databases go stale.
- Timeouts, TTLs and windows are **configuration**, never constants (BUILD_SPEC §2).

**Verification command used throughout:**

```bash
cd /mnt/c/Users/moham/OneDrive/Desktop/MIR
pnpm --filter @mir/contracts test          # contracts only, fast
pnpm --filter @mir/api test                # API, needs Postgres
pnpm verify                                # the full gate, before the final commit
```

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/contracts/src/pricing.ts` | Tier codes, the surge ladder, `quoteAmountMinor`. Pure arithmetic, no I/O. |
| `packages/contracts/src/pricing.test.ts` | Rounding, overflow bounds, ladder edges. |
| `apps/api/migrations/0025_cases_from_scheduling.{up,down}.sql` | Rename, strip the calendar, rewrite the status machine and the three predicates. |
| `apps/api/migrations/0026_availability_and_pricing.{up,down}.sql` | `accepting_cases`, `pricing_specialty_rates`, `pricing_tiers`, `tier_code`. |
| `apps/api/src/modules/pricing/index.ts` | Public API: `PricingService`, `Quote`. |
| `apps/api/src/modules/pricing/pricing.module.ts` | Nest wiring. |
| `apps/api/src/modules/pricing/internal/pricing.service.ts` | Reads rates and tiers, counts accepting doctors, returns a quote. |
| `apps/api/src/modules/pricing/pricing.test.ts` | Quote against a live database. |
| `apps/api/src/modules/cases/internal/directory.service.ts` | The doctor directory the lab browses. Split out of the old service. |
| `apps/api/src/modules/cases/cases.test.ts` | Lifecycle: quote lock, decline re-price, expiry. |

**Renamed** (`git mv`, so history follows)

| From | To |
|---|---|
| `apps/api/src/modules/scheduling/` | `apps/api/src/modules/cases/` |
| `internal/scheduling.service.ts` | `internal/cases.service.ts` |
| `internal/scheduling.controller.ts` | `internal/cases.controller.ts` |
| `internal/scheduling.maintenance.ts` | `internal/cases.maintenance.ts` |
| `scheduling.module.ts` | `cases.module.ts` |
| `scheduling.test.ts` | `cases-lifecycle.test.ts` |

**Deleted**

- `apps/web/app/schedule/` (whole tree), `apps/web/app/appointments/` (whole tree)
- `apps/web/components/schedule/BookAppointment.tsx`
- `SCHEDULING_TRIAGE_BEFORE_PAYMENT` from `config.schema.ts` and `.env.example`

`scheduling.service.ts` is 45 KB and does calendar, booking, directory and lifecycle at once. This plan removes the calendar half and splits the directory out, which should land it near 15 KB. Do not restructure further — that is not this plan's job.

---

### Task 1: The case status machine

**Files:**
- Modify: `packages/contracts/src/case.ts`
- Test: `packages/contracts/src/case.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CASE_STATUSES`, `CaseStatus`, `canTransition(from, to)`, `nextStatuses(from)`, `isTerminalStatus(status)` — all already exported under these names; only the values change.

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/src/case.test.ts`:

```ts
describe('the consult status machine', () => {
  it('quotes before it takes money', () => {
    expect(canTransition('submitted', 'quoted')).toBe(true);
    expect(canTransition('submitted', 'paid')).toBe(false);
  });

  /**
   * A decline is not the end of a case. The lab picks again, so `declined`
   * must lead back to `submitted` — and it must NOT be terminal, which is the
   * property the ledger relies on to keep the hold open.
   */
  it('returns a declined case to the lab rather than ending it', () => {
    expect(canTransition('paid', 'declined')).toBe(true);
    expect(canTransition('declined', 'submitted')).toBe(true);
    expect(isTerminalStatus('declined')).toBe(false);
  });

  it('lets an expired quote fall back to submitted', () => {
    expect(canTransition('quoted', 'submitted')).toBe(true);
  });

  it('only an accepted case can be answered or expire', () => {
    expect(canTransition('accepted', 'answered')).toBe(true);
    expect(canTransition('accepted', 'expired')).toBe(true);
    expect(canTransition('paid', 'answered')).toBe(false);
    expect(canTransition('paid', 'expired')).toBe(false);
  });

  it('ends at closed, cancelled and expired', () => {
    expect(isTerminalStatus('closed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('expired')).toBe(true);
  });

  /** There is no appointment to miss. */
  it('has no no_show status', () => {
    expect(CASE_STATUSES).not.toContain('no_show');
  });

  /** Choosing a doctor and locking their price are one act. */
  it('has no assigned status', () => {
    expect(CASE_STATUSES).not.toContain('assigned');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @mir/contracts test case`
Expected: FAIL — `canTransition('submitted','quoted')` returns `false`, and `CASE_STATUSES` still contains `no_show`… actually it contains `under_review`/`matched`/`in_progress`, so several assertions fail at once.

- [ ] **Step 3: Rewrite the machine**

In `packages/contracts/src/case.ts`, replace `CASE_STATUSES` and `TRANSITIONS`:

```ts
/**
 * The consult lifecycle.
 *
 * `quoted` carries the doctor: a quote is for one case AND one doctor, because
 * the doctor's tier is a term in the price. There is deliberately no `assigned`
 * state — a case holding a doctor but no price, or a price but no doctor, is a
 * state the pricing rules cannot describe.
 *
 * `declined` is NOT terminal. The doctor refused; the lab picks again and the
 * payment hold stays open, so the case walks back to `submitted` for a fresh
 * quote against whoever they choose next.
 */
export const CASE_STATUSES = [
  'submitted',
  'quoted',
  'paid',
  'accepted',
  'answered',
  'closed',
  'declined',
  'cancelled',
  'expired',
] as const;

export const caseStatusSchema = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

const TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  submitted: ['quoted', 'cancelled'],
  // Back to `submitted` when the quote's TTL lapses before payment.
  quoted: ['paid', 'submitted', 'cancelled'],
  paid: ['accepted', 'declined', 'cancelled'],
  accepted: ['answered', 'expired', 'cancelled'],
  declined: ['submitted'],
  answered: ['closed'],
  closed: [],
  cancelled: [],
  expired: [],
};
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @mir/contracts test case`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/case.ts packages/contracts/src/case.test.ts
git commit -m "feat(contracts): the consult status machine replaces the booking one"
```

---

### Task 2: The pricing formula

**Files:**
- Create: `packages/contracts/src/pricing.ts`
- Create: `packages/contracts/src/pricing.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `moneySchema`, `CurrencyCode` from `./ledger`.
- Produces:
  - `TIER_CODES: readonly ['standard','senior','expert']`, `TierCode`
  - `SURGE_LADDER: readonly SurgeRung[]` where `SurgeRung = { minAccepting: number; multiplierBp: number }`
  - `surgeMultiplierBp(acceptingCount: number): number | null` — `null` means the specialty is closed
  - `quoteAmountMinor(baseMinor: number, tierBp: number, surgeBp: number): number`
  - `BP_ONE = 10_000`

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/src/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BP_ONE, quoteAmountMinor, surgeMultiplierBp, SURGE_LADDER } from './pricing';

describe('surge ladder', () => {
  it('is flat when the specialty is well staffed', () => {
    expect(surgeMultiplierBp(5)).toBe(10_000);
    expect(surgeMultiplierBp(50)).toBe(10_000);
  });

  it('steps up as doctors go offline', () => {
    expect(surgeMultiplierBp(4)).toBe(11_500);
    expect(surgeMultiplierBp(3)).toBe(11_500);
    expect(surgeMultiplierBp(2)).toBe(13_000);
    expect(surgeMultiplierBp(1)).toBe(13_000);
  });

  /**
   * Nobody accepting is not "very expensive" — it is closed. Returning a huge
   * number here would quote a lab a price no doctor can answer.
   */
  it('refuses to quote when nobody is accepting', () => {
    expect(surgeMultiplierBp(0)).toBeNull();
    expect(surgeMultiplierBp(-1)).toBeNull();
  });

  it('is bounded — the top rung is the top price', () => {
    const max = Math.max(...SURGE_LADDER.map((r) => r.multiplierBp));
    expect(max).toBe(13_000);
  });
});

describe('quoteAmountMinor', () => {
  it('is the base when both multipliers are one', () => {
    expect(quoteAmountMinor(4_000, BP_ONE, BP_ONE)).toBe(4_000);
  });

  it('applies tier and surge together', () => {
    // 4000 x 1.2 x 1.15 = 5520
    expect(quoteAmountMinor(4_000, 12_000, 11_500)).toBe(5_520);
  });

  /**
   * THE POINT OF THIS TEST. The formula must be exact for values where a
   * naive float chain is not. Assert the exact one-shot results.
   */
  it('rounds once, at the end', () => {
    expect(quoteAmountMinor(1, 11_500, 13_000)).toBe(1); // 1.495
    expect(quoteAmountMinor(3, 11_500, 13_000)).toBe(4); // 4.485
    expect(quoteAmountMinor(7, 11_500, 13_000)).toBe(10); // 10.465
  });

  it('rounds half up', () => {
    // 1 x 1.5 x 1.0 = 1.5 -> 2
    expect(quoteAmountMinor(1, 15_000, BP_ONE)).toBe(2);
  });

  /**
   * baseMinor x tierBp x surgeBp overflows a double well before it overflows
   * the arithmetic this uses. A $1,000,000 base must still be exact.
   */
  it('is exact at absurd magnitudes', () => {
    expect(quoteAmountMinor(100_000_000, 14_000, 13_000)).toBe(182_000_000);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @mir/contracts test pricing`
Expected: FAIL — `Cannot find module './pricing'`.

- [ ] **Step 3: Write the module**

Create `packages/contracts/src/pricing.ts`:

```ts
/**
 * What a consult costs.
 *
 *   quote = specialty base x the doctor's earned tier x scarcity surge
 *
 * WHY BASIS POINTS AND NOT FLOATS. Money in this codebase is integer minor
 * units (`moneySchema`), and a float multiplier reintroduces exactly the
 * rounding that convention exists to prevent. A multiplier is an integer count
 * of ten-thousandths; `BP_ONE` is x1.00.
 *
 * WHY ONE ROUNDING. Three multiplications rounded independently drift, and the
 * drift lands in the doctor's payout. The whole product is computed exactly and
 * rounded once, at the end.
 */

export const BP_ONE = 10_000;

export const TIER_CODES = ['standard', 'senior', 'expert'] as const;
export type TierCode = (typeof TIER_CODES)[number];

export interface SurgeRung {
  /** The fewest accepting doctors this rung applies to. */
  readonly minAccepting: number;
  readonly multiplierBp: number;
}

/**
 * Published, bounded, four rungs. A continuous formula is impossible to explain
 * to a lab, impossible to defend to a regulator, and unbounded in exactly the
 * direction that looks worst in a medical market.
 *
 * Ordered densest-first; `surgeMultiplierBp` takes the first rung that matches.
 */
export const SURGE_LADDER: readonly SurgeRung[] = [
  { minAccepting: 5, multiplierBp: 10_000 },
  { minAccepting: 3, multiplierBp: 11_500 },
  { minAccepting: 1, multiplierBp: 13_000 },
];

/**
 * `null` means the specialty is closed — nobody is accepting, so there is no
 * price to quote. Returning a very large number instead would quote a lab a
 * price that no doctor is available to answer.
 */
export function surgeMultiplierBp(acceptingCount: number): number | null {
  if (!Number.isInteger(acceptingCount) || acceptingCount < 1) return null;
  for (const rung of SURGE_LADDER) {
    if (acceptingCount >= rung.minAccepting) return rung.multiplierBp;
  }
  return null;
}

/**
 * BigInt because `baseMinor x tierBp x surgeBp` leaves the exact-integer range
 * of a double at around a $90,000 base, and a silently inexact price is worse
 * than a slow one. Values are non-negative, so `+ half` then truncate is
 * half-up.
 */
export function quoteAmountMinor(baseMinor: number, tierBp: number, surgeBp: number): number {
  if (!Number.isInteger(baseMinor) || baseMinor < 0) {
    throw new RangeError(`baseMinor must be a non-negative integer, got ${baseMinor}`);
  }
  if (!Number.isInteger(tierBp) || tierBp <= 0) {
    throw new RangeError(`tierBp must be a positive integer, got ${tierBp}`);
  }
  if (!Number.isInteger(surgeBp) || surgeBp <= 0) {
    throw new RangeError(`surgeBp must be a positive integer, got ${surgeBp}`);
  }
  const divisor = BigInt(BP_ONE) * BigInt(BP_ONE);
  const scaled = BigInt(baseMinor) * BigInt(tierBp) * BigInt(surgeBp);
  return Number((scaled + divisor / 2n) / divisor);
}
```

- [ ] **Step 4: Export it and run the tests**

Add `export * from './pricing';` to `packages/contracts/src/index.ts`, after the `./ledger` line.

Run: `pnpm --filter @mir/contracts test pricing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/pricing.ts packages/contracts/src/pricing.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): the consult price — base x tier x surge, one rounding"
```

---

### Task 3: Migration 0025 — cases from scheduling

The big one. It renames the tables, strips the calendar, rewrites the status machine, and rewrites the five SECURITY DEFINER functions that name the old tables.

**Why the functions must be rewritten in the same migration:** a classic `LANGUAGE sql` function stores its body as *text* and re-resolves names at first execution. `ALTER TABLE … RENAME TO` does not rewrite that text. Rename the table without replacing the functions and every policy that calls one fails at runtime with `relation "scheduling_appointments" does not exist` — which reads as a broken database, not a broken migration.

**Files:**
- Create: `apps/api/migrations/0025_cases_from_scheduling.up.sql`
- Create: `apps/api/migrations/0025_cases_from_scheduling.down.sql`
- Test: `apps/api/src/shared/db/rls.test.ts` (modified — the gate)

**Interfaces:**
- Consumes: `app_current_role()`, `app_current_user_id()`, `app_created_patient(uuid)`, `app_has_consent_for(uuid)` — all unchanged.
- Produces, for every later task and for the RLS policies:
  - table `cases_cases`, link table `cases_case_studies (case_id, study_id)`
  - `app_has_case_with(p_patient uuid) -> boolean`
  - `app_study_linked_to_my_case(p_study uuid) -> boolean`
  - `app_can_see_case(p_case uuid) -> boolean`
  - `app_can_see_study(p_study uuid) -> boolean` (body changed, signature identical)
  - `billing_owing_organisation(p_case uuid, p_side text)` — parameter renamed, behaviour identical

- [ ] **Step 1: Write the failing test**

In `apps/api/src/shared/db/rls.test.ts`, the D3 `describe('D3 triage gating')` block is replaced. Delete it and add:

```ts
describe('imaging unlocks on acceptance', () => {
  /**
   * The doctor triages on a summary and commits by accepting. Before that they
   * have paid work in front of them and no images — which is the whole point of
   * the triage step, not a configuration of it.
   */
  it('a paid case shows the doctor no imaging', async () => {
    await seedCase({ status: 'paid' });
    const rows = await asDoctor(`SELECT id FROM imaging_studies`);
    expect(rows.rowCount).toBe(0);
  });

  it('an accepted case shows the doctor the imaging', async () => {
    await seedCase({ status: 'accepted' });
    const rows = await asDoctor(`SELECT id FROM imaging_studies`);
    expect(rows.rowCount).toBe(1);
  });

  it('a declined case gives the imaging back up', async () => {
    await seedCase({ status: 'declined' });
    const rows = await asDoctor(`SELECT id FROM imaging_studies`);
    expect(rows.rowCount).toBe(0);
  });

  it('an answered case keeps the imaging readable to its author', async () => {
    await seedCase({ status: 'answered' });
    const rows = await asDoctor(`SELECT id FROM imaging_studies`);
    expect(rows.rowCount).toBe(1);
  });

  it('acceptance never bypasses consent', async () => {
    await seedCase({ status: 'accepted', consent: false });
    const rows = await asDoctor(`SELECT id FROM imaging_studies`);
    expect(rows.rowCount).toBe(0);
  });
});
```

Adapt `seedCase` / `asDoctor` from the existing helpers in that file — the current block uses the same shape against `scheduling_appointments`; point the seed at `cases_cases` and give it a `status` parameter. Delete the test `'the database rejects double-booking regardless of application logic'`: the exclusion constraint it asserts is removed by this migration, and a test for a deleted guarantee is worse than no test.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @mir/api test rls`
Expected: FAIL — `relation "cases_cases" does not exist`.

- [ ] **Step 3: Write the up migration**

Create `apps/api/migrations/0025_cases_from_scheduling.up.sql`:

```sql
-- The scheduling module becomes the cases module.
--
-- WHY THIS IS A RENAME AND NOT A NEW TABLE. `scheduling_appointments` has been
-- the case record in everything but name since migration 0024 put `case_ref`
-- on it. 0023 keyed `billing_ledger_entries` to it by foreign key. 0021
-- rewrote its policies. Most of all, this table is the subject of the three
-- SECURITY DEFINER predicates the P3.2 gate tests exercise, and 0021's own
-- header states the rule: a migration that redefines those functions is
-- rewriting the access-control core under cover of a refactor. So the table is
-- renamed and the predicates are rewritten deliberately, here, with the gate
-- tests as the bar.
--
-- WHY THE FUNCTIONS MUST BE REPLACED IN THIS SAME MIGRATION. A classic
-- `LANGUAGE sql` function stores its body as text and re-resolves the names at
-- first execution. ALTER TABLE ... RENAME does not rewrite that text. Renaming
-- without replacing leaves every policy that calls one failing at runtime with
-- `relation "scheduling_appointments" does not exist`.
--
-- WHAT LEAVES, AND WHY IT IS SAFE. There are no slots, so there is nothing to
-- double-book: the gist exclusion constraint and its btree_gist dependency go,
-- along with starts_at/ends_at/kind/reminder_sent_at and the availability
-- tables. `no_show` goes with them — 0014 added it deliberately and 0023
-- defended it, but the verb has no referent once attendance does not exist.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables and indexes.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_appointments        RENAME TO cases_cases;
ALTER TABLE scheduling_appointment_studies RENAME TO cases_case_studies;
ALTER TABLE cases_case_studies             RENAME COLUMN appointment_id TO case_id;

ALTER INDEX scheduling_appointments_patient_idx      RENAME TO cases_cases_patient_idx;
ALTER INDEX scheduling_appointments_doctor_idx       RENAME TO cases_cases_doctor_idx;
ALTER INDEX scheduling_appointment_studies_study_idx RENAME TO cases_case_studies_study_idx;

-- The agenda index was "this doctor, this day". There is no day any more.
DROP INDEX IF EXISTS scheduling_appointments_doctor_day_idx;

-- ---------------------------------------------------------------------------
-- 2. The calendar leaves.
-- ---------------------------------------------------------------------------
ALTER TABLE cases_cases
  DROP CONSTRAINT IF EXISTS scheduling_appointments_doctor_id_tstzrange_excl;

DROP TABLE IF EXISTS scheduling_availability_rules;
DROP TABLE IF EXISTS scheduling_availability;

ALTER TABLE cases_cases
  DROP COLUMN starts_at,
  DROP COLUMN ends_at,
  DROP COLUMN kind,
  DROP COLUMN reminder_sent_at;

-- ---------------------------------------------------------------------------
-- 3. The status machine.
--
-- pending   -> submitted   (referred, not yet priced)
-- confirmed -> accepted    (the doctor took it)
-- completed -> answered    (a diagnosis exists)
-- no_show   -> cancelled   (the verb is gone; the case is not)
-- ---------------------------------------------------------------------------
ALTER TABLE cases_cases DROP CONSTRAINT IF EXISTS scheduling_appointments_status_check;

UPDATE cases_cases SET status = CASE status
  WHEN 'pending'   THEN 'submitted'
  WHEN 'confirmed' THEN 'accepted'
  WHEN 'completed' THEN 'answered'
  WHEN 'no_show'   THEN 'cancelled'
  ELSE status
END;

ALTER TABLE cases_cases
  ALTER COLUMN status SET DEFAULT 'submitted',
  ADD CONSTRAINT cases_cases_status_check CHECK (status IN (
    'submitted','quoted','paid','accepted','answered','closed',
    'declined','cancelled','expired'
  ));

-- ---------------------------------------------------------------------------
-- 4. What a case now carries.
--
-- `organisation_id` is stored rather than joined. Today the debtor is derived
-- through patients_patients.created_by_doctor -> identity_memberships, which
-- silently follows a clinician to a new employer and would re-attribute a
-- settled case. Who owed the money is a fact of the case.
--
-- `specialty` is fixed at submission for the same reason: pricing reads it, and
-- it must not follow the doctor's profile if that later changes.
-- ---------------------------------------------------------------------------
ALTER TABLE cases_cases
  ADD COLUMN organisation_id      uuid REFERENCES identity_organisations(id),
  ADD COLUMN specialty            text,
  ADD COLUMN quoted_amount_minor  bigint CHECK (quoted_amount_minor > 0),
  ADD COLUMN quoted_currency      text CHECK (quoted_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN quoted_at            timestamptz,
  ADD COLUMN quote_expires_at     timestamptz,
  ADD COLUMN accepted_at          timestamptz,
  ADD COLUMN answered_at          timestamptz,
  ADD COLUMN answer_due_at        timestamptz;

-- A quote is one price for one doctor at one moment. Half a quote is not a
-- state the pricing rules can describe, so the database refuses to hold one.
ALTER TABLE cases_cases ADD CONSTRAINT cases_quote_is_whole CHECK (
  (quoted_amount_minor IS NULL AND quoted_currency IS NULL
   AND quoted_at IS NULL AND quote_expires_at IS NULL)
  OR
  (quoted_amount_minor IS NOT NULL AND quoted_currency IS NOT NULL
   AND quoted_at IS NOT NULL AND quote_expires_at IS NOT NULL)
);

UPDATE cases_cases c
   SET organisation_id = o.id
  FROM patients_patients p
  JOIN identity_memberships m ON m.user_id = p.created_by_doctor
  JOIN identity_organisations o ON o.id = m.organisation_id AND o.side = 'source'
 WHERE p.id = c.patient_id;

UPDATE cases_cases c
   SET specialty = COALESCE(dp.specialty, 'unspecified')
  FROM identity_doctor_profiles dp
 WHERE dp.user_id = c.doctor_id;

-- Same honesty as 0021: there is no production data (README — no real
-- patients, no infrastructure), so a row that cannot be attributed to an
-- organisation is local or test data. Inventing a debtor would be worse.
DELETE FROM cases_case_studies WHERE case_id IN (
  SELECT id FROM cases_cases WHERE organisation_id IS NULL OR specialty IS NULL
);
DELETE FROM billing_ledger_entries WHERE appointment_id IN (
  SELECT id FROM cases_cases WHERE organisation_id IS NULL OR specialty IS NULL
);
DELETE FROM cases_cases WHERE organisation_id IS NULL OR specialty IS NULL;

ALTER TABLE cases_cases
  ALTER COLUMN organisation_id SET NOT NULL,
  ALTER COLUMN specialty       SET NOT NULL;

CREATE INDEX cases_cases_org_idx ON cases_cases (organisation_id, created_at DESC);
CREATE INDEX cases_cases_open_idx ON cases_cases (doctor_id, status)
  WHERE status IN ('paid','accepted');

ALTER TABLE billing_ledger_entries RENAME COLUMN appointment_id TO case_id;
ALTER INDEX billing_ledger_one_fee_per_org_per_appointment
  RENAME TO billing_ledger_one_fee_per_org_per_case;

-- ---------------------------------------------------------------------------
-- 5. The predicates. Renamed to match the tables, bodies rewritten.
--
-- THE ONE SEMANTIC CHANGE IS IN app_study_linked_to_my_case, and it is
-- deliberate: imaging unlocks on ACCEPTANCE, not on payment. D3's
-- triage-before-payment toggle is gone, because a summary before acceptance is
-- now the flow rather than a configuration of it. A config key that can no
-- longer be false is a lie in the schema.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_has_case_with(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases_cases
    WHERE patient_id = p_patient
      AND doctor_id = app_current_user_id()
      AND status NOT IN ('cancelled','declined','expired')
  );
$$;

CREATE OR REPLACE FUNCTION app_study_linked_to_my_case(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM cases_case_studies ccs
    JOIN cases_cases c ON c.id = ccs.case_id
    WHERE ccs.study_id = p_study
      AND c.doctor_id = app_current_user_id()
      AND c.status IN ('accepted','answered','closed')
  );
$$;

CREATE OR REPLACE FUNCTION app_can_see_case(p_case uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases_cases c
    WHERE c.id = p_case
      AND (
        (app_current_role() = 'tunisia_doctor' AND c.doctor_id = app_current_user_id())
        OR (app_current_role() = 'libya_doctor' AND app_created_patient(c.patient_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_can_see_study(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM imaging_studies s
    WHERE s.id = p_study
      AND (
        (app_current_role() = 'libya_doctor' AND s.uploaded_by = app_current_user_id())
        OR (app_current_role() = 'tunisia_doctor'
            AND app_study_linked_to_my_case(s.id)
            AND app_has_consent_for(s.patient_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION billing_owing_organisation(p_case uuid, p_side text)
RETURNS TABLE (organisation_id uuid, corridor_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT o.id, o.corridor_id
    FROM cases_cases c
    JOIN identity_organisations o
      ON o.id = CASE
                  WHEN p_side = 'source' THEN c.organisation_id
                  ELSE (SELECT m.organisation_id
                          FROM identity_memberships m
                          JOIN identity_organisations d ON d.id = m.organisation_id
                         WHERE m.user_id = c.doctor_id AND d.side = 'destination'
                         LIMIT 1)
                END
   WHERE c.id = p_case
     AND app_current_role() = 'admin'
   LIMIT 1;
$$;

DROP FUNCTION IF EXISTS app_has_appointment_with(uuid);
DROP FUNCTION IF EXISTS app_study_linked_to_my_appointment(uuid);
DROP FUNCTION IF EXISTS app_can_see_appointment(uuid);
DROP FUNCTION IF EXISTS app_triage_before_payment();

GRANT EXECUTE ON FUNCTION
  app_has_case_with(uuid), app_study_linked_to_my_case(uuid),
  app_can_see_case(uuid), app_can_see_study(uuid),
  billing_owing_organisation(uuid, text)
TO mir_app;

-- ---------------------------------------------------------------------------
-- 6. Policies. `ALTER TABLE ... RENAME` carries policies across, but their
--    names and their bodies still say "appointment". Recreate the ones whose
--    bodies referenced a renamed function or column; rename the rest.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS appointments_doctor          ON cases_cases;
DROP POLICY IF EXISTS appointments_doctor_update   ON cases_cases;
DROP POLICY IF EXISTS appointments_doctor_insert   ON cases_cases;
DROP POLICY IF EXISTS appointments_referring_doctor ON cases_cases;
DROP POLICY IF EXISTS appointments_referring_update ON cases_cases;
DROP POLICY IF EXISTS appointments_admin           ON cases_cases;
DROP POLICY IF EXISTS appointments_admin_update    ON cases_cases;
DROP POLICY IF EXISTS appointment_studies_visible  ON cases_case_studies;
DROP POLICY IF EXISTS appointment_studies_insert   ON cases_case_studies;

CREATE POLICY cases_doctor ON cases_cases FOR SELECT
  USING (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id());

CREATE POLICY cases_doctor_update ON cases_cases FOR UPDATE
  USING (app_current_role() = 'tunisia_doctor' AND doctor_id = app_current_user_id())
  WITH CHECK (doctor_id = app_current_user_id());

CREATE POLICY cases_referring ON cases_cases FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id));

CREATE POLICY cases_referring_insert ON cases_cases FOR INSERT
  WITH CHECK (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id));

CREATE POLICY cases_referring_update ON cases_cases FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id))
  WITH CHECK (app_created_patient(patient_id));

CREATE POLICY cases_admin ON cases_cases FOR SELECT
  USING (app_current_role() = 'admin');

CREATE POLICY cases_admin_update ON cases_cases FOR UPDATE
  USING (app_current_role() = 'admin') WITH CHECK (app_current_role() = 'admin');

CREATE POLICY case_studies_visible ON cases_case_studies FOR SELECT
  USING (app_can_see_case(case_id) AND app_can_see_study(study_id));

CREATE POLICY case_studies_insert ON cases_case_studies FOR INSERT
  WITH CHECK (app_current_role() = 'libya_doctor' AND app_can_see_study(study_id));

COMMIT;
```

- [ ] **Step 4: Write the down migration**

Create `apps/api/migrations/0025_cases_from_scheduling.down.sql`. It reverses the rename and restores the calendar shell. It does **not** restore the deleted availability rows — a down migration recreates structure, not data that no longer exists.

```sql
BEGIN;

DROP POLICY IF EXISTS cases_doctor            ON cases_cases;
DROP POLICY IF EXISTS cases_doctor_update     ON cases_cases;
DROP POLICY IF EXISTS cases_referring         ON cases_cases;
DROP POLICY IF EXISTS cases_referring_insert  ON cases_cases;
DROP POLICY IF EXISTS cases_referring_update  ON cases_cases;
DROP POLICY IF EXISTS cases_admin             ON cases_cases;
DROP POLICY IF EXISTS cases_admin_update      ON cases_cases;
DROP POLICY IF EXISTS case_studies_visible    ON cases_case_studies;
DROP POLICY IF EXISTS case_studies_insert     ON cases_case_studies;

ALTER TABLE billing_ledger_entries RENAME COLUMN case_id TO appointment_id;
ALTER INDEX billing_ledger_one_fee_per_org_per_case
  RENAME TO billing_ledger_one_fee_per_org_per_appointment;

DROP INDEX IF EXISTS cases_cases_open_idx;
DROP INDEX IF EXISTS cases_cases_org_idx;

ALTER TABLE cases_cases
  DROP CONSTRAINT IF EXISTS cases_quote_is_whole,
  DROP COLUMN organisation_id,
  DROP COLUMN specialty,
  DROP COLUMN quoted_amount_minor,
  DROP COLUMN quoted_currency,
  DROP COLUMN quoted_at,
  DROP COLUMN quote_expires_at,
  DROP COLUMN accepted_at,
  DROP COLUMN answered_at,
  DROP COLUMN answer_due_at;

ALTER TABLE cases_cases DROP CONSTRAINT IF EXISTS cases_cases_status_check;
UPDATE cases_cases SET status = CASE status
  WHEN 'submitted' THEN 'pending'
  WHEN 'quoted'    THEN 'pending'
  WHEN 'paid'      THEN 'pending'
  WHEN 'accepted'  THEN 'confirmed'
  WHEN 'answered'  THEN 'completed'
  WHEN 'closed'    THEN 'completed'
  WHEN 'expired'   THEN 'cancelled'
  ELSE status
END;
ALTER TABLE cases_cases
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD CONSTRAINT scheduling_appointments_status_check
    CHECK (status IN ('pending','confirmed','declined','cancelled','completed','no_show'));

ALTER TABLE cases_cases
  ADD COLUMN starts_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN ends_at          timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  ADD COLUMN kind             text NOT NULL DEFAULT 'consultation'
                                CHECK (kind IN ('consultation','follow_up','imaging','other')),
  ADD COLUMN reminder_sent_at timestamptz;

CREATE TABLE scheduling_availability (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  doctor_id    uuid NOT NULL REFERENCES identity_users(id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  slot_minutes int NOT NULL DEFAULT 30,
  withdrawn_at timestamptz,
  rule_id      uuid,
  CHECK (ends_at > starts_at)
);
CREATE INDEX scheduling_availability_doctor_idx ON scheduling_availability (doctor_id, starts_at);

CREATE TABLE scheduling_availability_rules (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  doctor_id    uuid NOT NULL REFERENCES identity_users(id),
  weekday      int  NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  slot_minutes int  NOT NULL DEFAULT 30,
  valid_from   date NOT NULL,
  valid_until  date,
  withdrawn_at timestamptz,
  CHECK (end_time > start_time)
);
ALTER TABLE scheduling_availability
  ADD CONSTRAINT scheduling_availability_rule_fk
  FOREIGN KEY (rule_id) REFERENCES scheduling_availability_rules(id);

ALTER TABLE cases_case_studies RENAME COLUMN case_id TO appointment_id;
ALTER TABLE cases_case_studies RENAME TO scheduling_appointment_studies;
ALTER TABLE cases_cases        RENAME TO scheduling_appointments;

ALTER INDEX cases_cases_patient_idx      RENAME TO scheduling_appointments_patient_idx;
ALTER INDEX cases_cases_doctor_idx       RENAME TO scheduling_appointments_doctor_idx;
ALTER INDEX cases_case_studies_study_idx RENAME TO scheduling_appointment_studies_study_idx;

DROP FUNCTION IF EXISTS app_has_case_with(uuid);
DROP FUNCTION IF EXISTS app_study_linked_to_my_case(uuid);
DROP FUNCTION IF EXISTS app_can_see_case(uuid);

COMMIT;
```

> **Note for the implementer:** the down migration recreates `scheduling_availability` and `scheduling_availability_rules` from the shapes in `0001_init.up.sql` and `0016_recurring_availability.up.sql`. Read both before writing it and copy the column list exactly — the sketch above is the shape, and a `migrate down` that produces a subtly different table is worse than one that fails loudly.

- [ ] **Step 5: Verify the migration round-trips**

Run:
```bash
pnpm --filter @mir/api test rls
```
Expected: PASS — all seven P3.2 gate tests plus the five new acceptance-gating tests.

Then prove reversibility, which the repo requires of every migration pair:
```bash
node -e "require('./apps/api/dist/shared/db/migrator.js')" 2>/dev/null || pnpm --filter @mir/api build
pnpm --filter @mir/api test migrat
```
Expected: PASS. If no migrator round-trip test exists, add one asserting `up → down → up` applies cleanly against a scratch database.

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations/0025_cases_from_scheduling.up.sql \
        apps/api/migrations/0025_cases_from_scheduling.down.sql \
        apps/api/src/shared/db/rls.test.ts
git commit -m "feat(db): the scheduling module becomes the cases module"
```

---

### Task 4: Migration 0026 — availability and pricing

**Files:**
- Create: `apps/api/migrations/0026_availability_and_pricing.up.sql`
- Create: `apps/api/migrations/0026_availability_and_pricing.down.sql`
- Test: `apps/api/src/shared/db/rls.test.ts` (extended)

**Interfaces:**
- Consumes: `app_current_role()` from 0002; `identity_doctor_profiles` from 0001.
- Produces: `identity_doctor_profiles.accepting_cases boolean`, `identity_doctor_profiles.tier_code text`, tables `pricing_specialty_rates`, `pricing_tiers`, and two definer functions consumed by Task 5:
  - `pricing_accepting_count(p_corridor text, p_specialty text) -> int`
  - `pricing_tier_bp(p_doctor uuid) -> int`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/shared/db/rls.test.ts`:

```ts
describe('the doctor directory', () => {
  /**
   * Default false. Nothing about a doctor's presence in the system implies
   * consent to receive cases, and an approved doctor who has not opted in must
   * not appear in a lab's directory.
   */
  it('a newly approved doctor is not accepting cases', async () => {
    const { rows } = await owner(
      `SELECT accepting_cases FROM identity_doctor_profiles WHERE user_id = $1`,
      [tunisiaDoctorId],
    );
    expect(rows[0]?.accepting_cases).toBe(false);
  });

  it('the rate card is readable by any authenticated role', async () => {
    const rows = await asReferringDoctor(`SELECT specialty FROM pricing_specialty_rates`);
    expect(rows.rowCount).toBeGreaterThan(0);
  });

  it('the rate card is not writable by a clinician', async () => {
    await expect(
      asReferringDoctor(
        `INSERT INTO pricing_specialty_rates (corridor_id, specialty, amount_minor, currency)
         VALUES ('ly-tn','radiology',1,'USD')`,
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @mir/api test rls`
Expected: FAIL — `column "accepting_cases" does not exist`.

- [ ] **Step 3: Write the up migration**

Create `apps/api/migrations/0026_availability_and_pricing.up.sql`:

```sql
-- Availability collapses to one boolean, and the platform gets a rate card.
--
-- WHY DEFAULT FALSE. It matches how `applicant` works: the fail-closed
-- direction. An approved doctor appears in no lab's directory until they say
-- they are open for work. Defaulting true would enrol every doctor into
-- receiving cases at the moment ops approves them, which is a decision that
-- belongs to the doctor.
--
-- WHY THESE ARE TABLES AND NOT CONSTANTS. Same reason `billing_fee_schedule`
-- is a table (0023): the agreed rate is rows, not a branch in code. Changing
-- radiology's price is an UPDATE, not a deploy.
--
-- WHY BASIS POINTS. Money is integer minor units everywhere in this schema. A
-- numeric multiplier would reintroduce exactly the rounding that convention
-- exists to prevent.

BEGIN;

ALTER TABLE identity_doctor_profiles
  ADD COLUMN accepting_cases boolean NOT NULL DEFAULT false,
  ADD COLUMN tier_code       text    NOT NULL DEFAULT 'standard';

CREATE TABLE pricing_tiers (
  code          text PRIMARY KEY,
  multiplier_bp int  NOT NULL CHECK (multiplier_bp > 0),
  min_answered  int  NOT NULL CHECK (min_answered >= 0),
  sort          int  NOT NULL
);

INSERT INTO pricing_tiers (code, multiplier_bp, min_answered, sort) VALUES
  ('standard', 10000,   0, 0),
  ('senior',   12000,  50, 1),
  ('expert',   14000, 200, 2);

ALTER TABLE identity_doctor_profiles
  ADD CONSTRAINT identity_doctor_profiles_tier_fk
  FOREIGN KEY (tier_code) REFERENCES pricing_tiers(code);

CREATE TABLE pricing_specialty_rates (
  corridor_id  text   NOT NULL,
  specialty    text   NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency     text   NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  active       boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corridor_id, specialty)
);

-- Seed rates in USD, matching the corridor's currency list in the web
-- registry. These are placeholders for a commercial decision, not a quote.
INSERT INTO pricing_specialty_rates (corridor_id, specialty, amount_minor, currency) VALUES
  ('ly-tn', 'radiology',   4000, 'USD'),
  ('ly-tn', 'cardiology',  5500, 'USD'),
  ('ly-tn', 'neurology',   6000, 'USD'),
  ('ly-tn', 'oncology',    6500, 'USD'),
  ('ly-tn', 'unspecified', 4000, 'USD');

ALTER TABLE pricing_tiers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tiers           FORCE  ROW LEVEL SECURITY;
ALTER TABLE pricing_specialty_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_specialty_rates FORCE  ROW LEVEL SECURITY;

-- The rate card is not patient data. Every authenticated role may read it —
-- a lab must see what a case costs before it commits — and nobody but ops may
-- write it.
CREATE POLICY pricing_tiers_readable ON pricing_tiers FOR SELECT
  USING (app_current_role() IS NOT NULL);
CREATE POLICY pricing_rates_readable ON pricing_specialty_rates FOR SELECT
  USING (app_current_role() IS NOT NULL);
CREATE POLICY pricing_rates_ops_write ON pricing_specialty_rates FOR ALL
  USING (app_current_role() = 'admin') WITH CHECK (app_current_role() = 'admin');

GRANT SELECT ON pricing_tiers TO mir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pricing_specialty_rates TO mir_app;

-- ---------------------------------------------------------------------------
-- Surge needs a headcount, and the lab asking for it cannot see the doctors.
--
-- A referring doctor has no policy granting SELECT on identity_doctor_profiles
-- or identity_memberships, and rightly so. But the price they are quoted
-- depends on how many doctors are accepting, so the count has to come through
-- a narrow definer function that returns a NUMBER and never a row. That is the
-- whole surface: no names, no ids, no way to enumerate who is online.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pricing_accepting_count(p_corridor text, p_specialty text)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(DISTINCT dp.user_id)::int
    FROM identity_doctor_profiles dp
    JOIN identity_memberships m     ON m.user_id = dp.user_id
    JOIN identity_organisations o   ON o.id = m.organisation_id
   WHERE dp.accepting_cases
     AND dp.specialty  = p_specialty
     AND o.corridor_id = p_corridor
     AND o.side        = 'destination'
     AND o.verification_status = 'approved';
$$;

-- The tier multiplier for one doctor, for the same reason.
CREATE OR REPLACE FUNCTION pricing_tier_bp(p_doctor uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT t.multiplier_bp
    FROM identity_doctor_profiles dp
    JOIN pricing_tiers t ON t.code = dp.tier_code
   WHERE dp.user_id = p_doctor;
$$;

GRANT EXECUTE ON FUNCTION
  pricing_accepting_count(text, text), pricing_tier_bp(uuid)
TO mir_app;

COMMIT;
```

- [ ] **Step 4: Write the down migration**

Create `apps/api/migrations/0026_availability_and_pricing.down.sql`:

```sql
BEGIN;
ALTER TABLE identity_doctor_profiles
  DROP CONSTRAINT IF EXISTS identity_doctor_profiles_tier_fk;
ALTER TABLE identity_doctor_profiles
  DROP COLUMN IF EXISTS accepting_cases,
  DROP COLUMN IF EXISTS tier_code;
DROP FUNCTION IF EXISTS pricing_accepting_count(text, text);
DROP FUNCTION IF EXISTS pricing_tier_bp(uuid);
DROP TABLE IF EXISTS pricing_specialty_rates;
DROP TABLE IF EXISTS pricing_tiers;
COMMIT;
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @mir/api test rls`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations/0026_availability_and_pricing.up.sql \
        apps/api/migrations/0026_availability_and_pricing.down.sql \
        apps/api/src/shared/db/rls.test.ts
git commit -m "feat(db): a per-doctor accepting switch and the platform rate card"
```

---

### Task 5: The pricing service

**Files:**
- Create: `apps/api/src/modules/pricing/index.ts`
- Create: `apps/api/src/modules/pricing/pricing.module.ts`
- Create: `apps/api/src/modules/pricing/internal/pricing.service.ts`
- Create: `apps/api/src/modules/pricing/pricing.test.ts`
- Modify: `apps/api/src/app.module.ts` (register `PricingModule`)

**Interfaces:**
- Consumes: `quoteAmountMinor`, `surgeMultiplierBp`, `BP_ONE` from `@mir/contracts`; `DatabaseService` from `../../shared/db/database.service`; `pricing_accepting_count`, `pricing_tier_bp` from migration 0026.
- Produces:
  - `class PricingService { quoteFor(input: QuoteInput): Promise<Quote> }`
  - `interface QuoteInput { corridorId: string; specialty: string; doctorId: string }`
  - `interface Quote { amountMinor: number; currency: CurrencyCode; tierBp: number; surgeBp: number; acceptingCount: number }`
  - `class SpecialtyClosedError extends ConflictException`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/pricing/pricing.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PricingService, SpecialtyClosedError } from './index';
// Reuse the RLS harness's database bootstrap; see rls.test.ts for the pattern.
import { makeTestDb, type TestDb } from '../../shared/db/testing/rls-harness';

describe('PricingService', () => {
  let db: TestDb;
  let pricing: PricingService;

  beforeEach(async () => {
    db = await makeTestDb();
    pricing = new PricingService(db.service);
  });

  it('quotes base x tier x surge', async () => {
    // 5 accepting doctors -> surge x1.00; the chosen one is 'senior' -> x1.20
    await db.seedAcceptingDoctors({ specialty: 'radiology', count: 5 });
    const doctorId = await db.seedDoctor({ specialty: 'radiology', tier: 'senior' });

    const quote = await pricing.quoteFor({
      corridorId: 'ly-tn',
      specialty: 'radiology',
      doctorId,
    });

    expect(quote.amountMinor).toBe(4800); // 4000 x 1.20 x 1.00
    expect(quote.currency).toBe('USD');
    expect(quote.tierBp).toBe(12_000);
    expect(quote.surgeBp).toBe(10_000);
  });

  it('surges when the specialty thins out', async () => {
    await db.seedAcceptingDoctors({ specialty: 'radiology', count: 2 });
    const doctorId = await db.seedDoctor({ specialty: 'radiology', tier: 'standard' });

    const quote = await pricing.quoteFor({
      corridorId: 'ly-tn',
      specialty: 'radiology',
      doctorId,
    });

    expect(quote.surgeBp).toBe(13_000);
    expect(quote.amountMinor).toBe(5200); // 4000 x 1.00 x 1.30
  });

  /**
   * Nobody accepting is closed, not expensive. This must be a clean refusal the
   * UI can render, not a 500 and not a huge number.
   */
  it('refuses to quote a closed specialty', async () => {
    const doctorId = await db.seedDoctor({ specialty: 'oncology', tier: 'standard' });
    await expect(
      pricing.quoteFor({ corridorId: 'ly-tn', specialty: 'oncology', doctorId }),
    ).rejects.toBeInstanceOf(SpecialtyClosedError);
  });

  it('refuses a specialty with no rate rather than inventing one', async () => {
    await db.seedAcceptingDoctors({ specialty: 'dermatology', count: 5 });
    const doctorId = await db.seedDoctor({ specialty: 'dermatology', tier: 'standard' });
    await expect(
      pricing.quoteFor({ corridorId: 'ly-tn', specialty: 'dermatology', doctorId }),
    ).rejects.toThrow(/no active rate/i);
  });
});
```

> The harness helpers `makeTestDb`, `seedDoctor` and `seedAcceptingDoctors` do not exist yet. Add them to `apps/api/src/shared/db/testing/rls-harness.ts` alongside the existing owner/app connection pair, following the same rule that harness already enforces: seed with the **owner** connection, assert with the **app** connection.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @mir/api test pricing`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Write the service**

Create `apps/api/src/modules/pricing/internal/pricing.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BP_ONE, quoteAmountMinor, surgeMultiplierBp, type CurrencyCode } from '@mir/contracts';
import { DatabaseService } from '../../../shared/db/database.service';

export interface QuoteInput {
  corridorId: string;
  specialty: string;
  doctorId: string;
}

export interface Quote {
  amountMinor: number;
  currency: CurrencyCode;
  tierBp: number;
  surgeBp: number;
  acceptingCount: number;
}

/**
 * Nobody in this specialty is accepting work. A 409 rather than a 404: the
 * specialty exists and is priced, it is simply closed right now, and the lab's
 * correct move is to come back or choose another specialty.
 */
export class SpecialtyClosedError extends ConflictException {
  constructor(specialty: string) {
    super(`No doctor is currently accepting ${specialty} cases`);
  }
}

/**
 * What a consult costs — BUILD_SPEC successor, consult-model spec Part 2.
 *
 * The arithmetic lives in `@mir/contracts` so the web app quotes the same
 * indicative price the API charges; this service only supplies the three
 * inputs. Two of them come through SECURITY DEFINER functions (migration 0026)
 * because the lab asking for a price has no policy granting it sight of the
 * doctors it is being priced against.
 */
@Injectable()
export class PricingService {
  constructor(private readonly db: DatabaseService) {}

  async quoteFor(input: QuoteInput): Promise<Quote> {
    return this.db.tx(async (tx) => {
      const rate = await tx.query<{ amount_minor: string; currency: CurrencyCode }>(
        `SELECT amount_minor, currency
           FROM pricing_specialty_rates
          WHERE corridor_id = $1 AND specialty = $2 AND active`,
        [input.corridorId, input.specialty],
      );
      const row = rate.rows[0];
      if (row === undefined) {
        throw new NotFoundException(
          `No active rate for ${input.specialty} on corridor ${input.corridorId}`,
        );
      }

      const counted = await tx.query<{ n: number }>(
        `SELECT pricing_accepting_count($1, $2) AS n`,
        [input.corridorId, input.specialty],
      );
      const acceptingCount = counted.rows[0]?.n ?? 0;

      const surgeBp = surgeMultiplierBp(acceptingCount);
      if (surgeBp === null) throw new SpecialtyClosedError(input.specialty);

      const tiered = await tx.query<{ bp: number }>(`SELECT pricing_tier_bp($1) AS bp`, [
        input.doctorId,
      ]);
      // A doctor with no profile row cannot be quoted against; fall back to the
      // base tier rather than to a free consult.
      const tierBp = tiered.rows[0]?.bp ?? BP_ONE;

      return {
        amountMinor: quoteAmountMinor(Number(row.amount_minor), tierBp, surgeBp),
        currency: row.currency,
        tierBp,
        surgeBp,
        acceptingCount,
      };
    });
  }
}
```

Create `apps/api/src/modules/pricing/index.ts`:

```ts
/**
 * Public API of the `pricing` module.
 *
 * Deliberately NOT exported: nothing else. There is no way to read the rate
 * card row-by-row through this module — a caller asks what a case costs and
 * gets a number. Ops edits rates through the database, not through an endpoint
 * that would need its own authorization story.
 */
export { PricingService, SpecialtyClosedError } from './internal/pricing.service';
export type { Quote, QuoteInput } from './internal/pricing.service';
export { PricingModule } from './pricing.module';
```

Create `apps/api/src/modules/pricing/pricing.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { PricingService } from './internal/pricing.service';

@Module({
  imports: [DatabaseModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
```

- [ ] **Step 4: Run the tests and the boundary check**

Run:
```bash
pnpm --filter @mir/api test pricing
pnpm boundaries
```
Expected: PASS, and no boundary violation (`pricing/internal` is imported only from inside `pricing`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pricing apps/api/src/app.module.ts apps/api/src/shared/db/testing/rls-harness.ts
git commit -m "feat(pricing): quote a consult from the rate card, the tier and the surge"
```

---

### Task 6: The cases service

Renames the module and removes the calendar half. `scheduling.service.ts` is 45 KB; after this it should be near 15 KB with the directory split out.

**Files:**
- Rename: `apps/api/src/modules/scheduling/` → `apps/api/src/modules/cases/` (use `git mv` so history follows)
- Modify: `apps/api/src/modules/cases/internal/cases.service.ts`
- Create: `apps/api/src/modules/cases/internal/directory.service.ts`
- Modify: `apps/api/src/modules/cases/index.ts`, `cases.module.ts`
- Test: `apps/api/src/modules/cases/cases-lifecycle.test.ts`

**Interfaces:**
- Consumes: `PricingService.quoteFor` (Task 5); `canTransition`, `CaseStatus` (Task 1); `app_can_see_case` (Task 3).
- Produces:
  - `CasesService.submit(input: SubmitInput): Promise<CaseSummary>`
  - `CasesService.quote(caseId: string, doctorId: string): Promise<CaseSummary>`
  - `CasesService.markPaid(caseId: string): Promise<void>`
  - `CasesService.accept(caseId: string): Promise<void>`
  - `CasesService.decline(caseId: string): Promise<void>`
  - `CasesService.markAnswered(caseId: string): Promise<void>`
  - `CasesService.cancel(caseId: string, reason?: string): Promise<void>`
  - `CasesService.listCases(filter?): Promise<CaseSummary[]>`
  - `CasesService.getCase(caseId: string): Promise<CaseSummary>`
  - `CasesService.expireOverdue(): Promise<number>`
  - `DirectoryService.listAcceptingDoctors(corridorId, specialty): Promise<DirectoryEntry[]>`
  - `DirectoryService.setAccepting(accepting: boolean): Promise<void>`

**Deleted from the service:** `addAvailability`, `listOpenSlots`, `listAvailability`, `withdrawAvailability`, `addAvailabilityRule`, `materialiseRule`, `listAvailabilityRules`, `withdrawAvailabilityRule`, `reschedule`, `markNoShow`, `sendDueReminders`, `book`, `attemptBooking`, `withContentionRetries`, `SlotUnavailableError`.

`withContentionRetries` goes with `book`: it existed to survive the exclusion constraint under concurrent slot grabs, and there is no longer a contended resource. Deleting it is the point — retry machinery with nothing to retry is code that will be miscopied later.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/cases/cases-lifecycle.test.ts`:

```ts
describe('the consult lifecycle', () => {
  it('locks the quote: paying charges the stored number, not a fresh one', async () => {
    const c = await asLab.submit({ specialty: 'radiology' });
    const quoted = await asLab.quote(c.id, doctorId);
    expect(quoted.quotedAmountMinor).toBe(4800);

    // The doctor is promoted between quote and payment.
    await owner(`UPDATE identity_doctor_profiles SET tier_code = 'expert' WHERE user_id = $1`, [
      doctorId,
    ]);

    await asLab.markPaid(c.id);
    const after = await asLab.getCase(c.id);
    expect(after.quotedAmountMinor).toBe(4800);
  });

  it('refuses to pay against an expired quote', async () => {
    const c = await asLab.submit({ specialty: 'radiology' });
    await asLab.quote(c.id, doctorId);
    await owner(`UPDATE cases_cases SET quote_expires_at = now() - interval '1 minute'
                  WHERE id = $1`, [c.id]);
    await expect(asLab.markPaid(c.id)).rejects.toThrow(/quote/i);
  });

  it('a decline sends the case back to the lab without ending it', async () => {
    const c = await paidCase();
    await asDoctor.decline(c.id);
    const after = await asLab.getCase(c.id);
    expect(after.status).toBe('declined');
    expect(canTransition(after.status, 'submitted')).toBe(true);
  });

  it('cannot quote against a doctor who is not accepting', async () => {
    await owner(`UPDATE identity_doctor_profiles SET accepting_cases = false WHERE user_id = $1`, [
      doctorId,
    ]);
    const c = await asLab.submit({ specialty: 'radiology' });
    await expect(asLab.quote(c.id, doctorId)).rejects.toThrow(/accepting/i);
  });

  it('accepting starts the answer clock', async () => {
    const c = await paidCase();
    await asDoctor.accept(c.id);
    const after = await asDoctor.getCase(c.id);
    expect(after.acceptedAt).not.toBeNull();
    expect(after.answerDueAt).not.toBeNull();
  });

  it('expires an accepted case exactly once, however often the sweep runs', async () => {
    const c = await acceptedCase();
    await owner(`UPDATE cases_cases SET answer_due_at = now() - interval '1 hour' WHERE id = $1`, [
      c.id,
    ]);
    expect(await cases.expireOverdue()).toBe(1);
    expect(await cases.expireOverdue()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @mir/api test cases-lifecycle`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Rename the module**

```bash
git mv apps/api/src/modules/scheduling apps/api/src/modules/cases
cd apps/api/src/modules/cases
git mv internal/scheduling.service.ts     internal/cases.service.ts
git mv internal/scheduling.controller.ts  internal/cases.controller.ts
git mv internal/scheduling.maintenance.ts internal/cases.maintenance.ts
git mv scheduling.module.ts               cases.module.ts
git mv scheduling.test.ts                 cases-lifecycle.test.ts
```

Then fix every import and identifier: `SchedulingService` → `CasesService`, `SchedulingModule` → `CasesModule`, `SchedulingController` → `CasesController`, `SchedulingMaintenance` → `CasesMaintenance`. `rg -l 'Scheduling' apps/api/src apps/web packages` finds the call sites.

- [ ] **Step 4: Delete the calendar half and add the lifecycle verbs**

Remove every method in the "Deleted from the service" list above, and the interfaces `AvailabilityWindow`, `AvailabilityRule`, `BookingInput`, `AppointmentKind`. Rename `Appointment` → `Case` (the row shape) and `AppointmentSummary` → `CaseSummary` (the row plus its joined display fields — every service verb returns this one), `DoctorSummary` → `DirectoryEntry` (moving the last to `directory.service.ts`).

Add the two verbs that carry the new rules:

```ts
/**
 * Lock a price against one doctor.
 *
 * WHY THE DOCTOR IS CHECKED HERE AND NOT ONLY IN THE UI. `accepting_cases` is
 * the doctor's consent to receive work. A lab that kept a stale directory page
 * open, or that calls the API directly, must not be able to push a case at a
 * doctor who has switched off.
 */
async quote(caseId: string, doctorId: string): Promise<CaseSummary> {
  return this.db.txAs(requireContext(), async (tx) => {
    const current = await this.loadForUpdate(tx, caseId);
    this.assertTransition(current.status, 'quoted');

    const accepting = await tx.query<{ ok: boolean }>(
      `SELECT accepting_cases AS ok FROM identity_doctor_profiles WHERE user_id = $1`,
      [doctorId],
    );
    if (accepting.rows[0]?.ok !== true) {
      throw new ConflictException('That doctor is not accepting cases');
    }

    const quote = await this.pricing.quoteFor({
      corridorId: current.corridorId,
      specialty: current.specialty,
      doctorId,
    });

    await tx.query(
      `UPDATE cases_cases
          SET doctor_id = $2,
              quoted_amount_minor = $3,
              quoted_currency = $4,
              quoted_at = now(),
              quote_expires_at = now() + ($5 || ' minutes')::interval,
              status = 'quoted'
        WHERE id = $1`,
      [caseId, doctorId, quote.amountMinor, quote.currency, this.config.CASES_QUOTE_TTL_MINUTES],
    );
    return this.getCase(caseId);
  });
}

/**
 * The payment gate reads the STORED price. It never recomputes.
 *
 * A price that moves between the screen and the charge is a dispute the
 * platform loses, and re-deriving the number here is exactly how that happens.
 */
async markPaid(caseId: string): Promise<void> {
  await this.db.txAs(requireContext(), async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE cases_cases
          SET status = 'paid'
        WHERE id = $1
          AND status = 'quoted'
          AND quote_expires_at > now()`,
      [caseId],
    );
    if (rowCount === 0) {
      throw new ConflictException('This quote has expired; request a new one');
    }
  });
}
```

`expireOverdue` replaces `releaseUnansweredReferrals`, keeping its sweep shape:

```ts
/**
 * Move accepted-but-unanswered cases to `expired`.
 *
 * The UPDATE is the guard. Selecting the overdue rows and then updating them
 * would let two sweeps both see the same case and both refund it; a single
 * conditional UPDATE makes double-expiry unrepresentable rather than unlikely,
 * which is the same reasoning as the ledger's partial unique index (0023).
 */
async expireOverdue(): Promise<number> {
  return this.db.tx(async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE cases_cases
          SET status = 'expired'
        WHERE status = 'accepted' AND answer_due_at < now()`,
    );
    return rowCount ?? 0;
  });
}
```

- [ ] **Step 5: Split the directory out**

Create `apps/api/src/modules/cases/internal/directory.service.ts` holding `listAcceptingDoctors` (the reshaped `listDoctors`) and `setAccepting`. It is a separate file because it answers a different question from the lifecycle — "who can take this?" rather than "where is this case?" — and because `cases.service.ts` is already too big.

- [ ] **Step 6: Run the tests**

Run:
```bash
pnpm --filter @mir/api test cases-lifecycle
pnpm --filter @mir/api test rls
pnpm boundaries
```
Expected: PASS on all three.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/cases
git commit -m "feat(cases): the scheduling service becomes the case lifecycle"
```

---

### Task 7: Routes, config, the sweep, and the notification templates

**Files:**
- Modify: `apps/api/src/modules/cases/internal/cases.controller.ts`
- Modify: `apps/api/src/modules/cases/internal/cases.maintenance.ts`
- Modify: `apps/api/src/shared/config/config.schema.ts`
- Modify: `.env.example`
- Modify: `apps/api/src/modules/notifications/internal/templates.ts`
- Test: `apps/api/src/shared/config/config.schema.test.ts`, `apps/api/src/modules/notifications/notifications.test.ts`, `apps/api/src/shared/authz/route-access-audit.test.ts`

**Interfaces:**
- Consumes: every `CasesService` and `DirectoryService` verb from Task 6.
- Produces: the HTTP surface below. No other task adds routes.

| Method | Path | Role |
|---|---|---|
| `GET` | `/cases/directory?specialty=` | `libya_doctor` |
| `POST` | `/cases` | `libya_doctor` |
| `GET` | `/cases` | `libya_doctor`, `tunisia_doctor`, `assistant` |
| `GET` | `/cases/:id` | `libya_doctor`, `tunisia_doctor`, `assistant` |
| `POST` | `/cases/:id/quote` | `libya_doctor` |
| `POST` | `/cases/:id/pay` | `libya_doctor` |
| `POST` | `/cases/:id/accept` | `tunisia_doctor` |
| `POST` | `/cases/:id/decline` | `tunisia_doctor` |
| `POST` | `/cases/:id/cancel` | `libya_doctor` |
| `PATCH` | `/doctors/me/accepting` | `tunisia_doctor` |

**Deleted routes:** `GET /scheduling/availability`, `POST /scheduling/availability`, `DELETE /scheduling/availability/:id`, `GET /scheduling/availability/rules`, `POST /scheduling/availability/rules`, `DELETE /scheduling/availability/rules/:id`, `GET /scheduling/doctors/:id/slots`, `PATCH /scheduling/appointments/:id/time`, `POST /scheduling/appointments/:id/no-show`, `POST /scheduling/appointments/:id/complete`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/shared/config/config.schema.test.ts`:

```ts
it('has no triage toggle — a summary before acceptance is the flow, not a setting', () => {
  expect(Object.keys(configSchema.shape)).not.toContain('SCHEDULING_TRIAGE_BEFORE_PAYMENT');
});

it('carries the quote TTL and the answer window as configuration', () => {
  const parsed = configSchema.parse({ ...validEnv });
  expect(parsed.CASES_QUOTE_TTL_MINUTES).toBe(30);
  expect(parsed.CASES_ANSWER_WINDOW_HOURS).toBe(72);
});
```

In `apps/api/src/modules/notifications/notifications.test.ts`, extend the forbidden-field list so a template can never interpolate a price or a clinical detail:

```ts
it('no template mentions money — a lab learns a price on the platform, not by SMS', () => {
  for (const [name, template] of Object.entries(TEMPLATES)) {
    expect(template.allowed, name).not.toContain('amount');
    expect(template.allowed, name).not.toContain('price');
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @mir/api test config.schema notifications`
Expected: FAIL — `SCHEDULING_TRIAGE_BEFORE_PAYMENT` is still in the shape and the new keys are missing.

- [ ] **Step 3: Change the config**

In `apps/api/src/shared/config/config.schema.ts`, delete the `SCHEDULING_TRIAGE_BEFORE_PAYMENT` line (currently line 157) and add:

```ts
  /**
   * How long a quoted price stands. The lab pays this exact number or asks for
   * a new quote; the API never recomputes at payment time.
   */
  CASES_QUOTE_TTL_MINUTES: intFromEnv('CASES_QUOTE_TTL_MINUTES', 5, 240).prefault('30'),

  /**
   * How long an accepted case has before it expires and refunds. BUILD_SPEC §2
   * requires anything a legal answer might move to be configuration — the
   * refund window is exactly that (PRD open question 2).
   */
  CASES_ANSWER_WINDOW_HOURS: intFromEnv('CASES_ANSWER_WINDOW_HOURS', 1, 720).prefault('72'),
```

Mirror both in `.env.example`, replacing the `SCHEDULING_TRIAGE_BEFORE_PAYMENT=false` line at `.env.example:91`.

`PAYMENT_AUTHORIZATION_WINDOW_HOURS` (`config.schema.ts:162`) is the other
survivor of D2 — it bounded how long a card authorisation could sit before the
slot was released, and migration 0023 removed the authorisation. Delete it here
too; sub-project 4 introduces its own hold window under a name that describes
what it actually bounds.

- [ ] **Step 4: Rewrite the controller**

Rename the controller prefix from `scheduling` to `cases` and implement the route table above. Every handler keeps an explicit `@RequiresRole(...)` — `route-access-audit.test.ts` fails the build otherwise (P1.5).

Delete `CALENDAR_ROLES` and replace its uses with the explicit role lists in the table.

- [ ] **Step 5: Rewrite the sweep**

In `cases.maintenance.ts`, the tick currently calls `releaseUnansweredReferrals()` and `sendDueReminders(REMINDER_LEAD_HOURS)`. Replace both with a single `expireOverdue()` call and delete `REMINDER_LEAD_HOURS`. There are no appointments to remind anybody about.

- [ ] **Step 6: Retire the appointment templates**

In `templates.ts`, delete `booking_confirmed`, `appointment_reminder`, `appointment_moved` and `appointment_cancelled`, and the `appointmentTime` field. Add, keeping the existing rule that no template carries a clinical detail:

```ts
  case_accepted: {
    allowed: ['caseRef', 'link'],
    sms: {
      ar: 'تم قبول الحالة {{caseRef}}.',
      fr: 'Le dossier {{caseRef}} a été accepté.',
    },
    email: {
      ar: 'تم قبول الحالة {{caseRef}}. {{link}}',
      fr: 'Le dossier {{caseRef}} a été accepté. {{link}}',
    },
  },
  case_declined: {
    allowed: ['caseRef', 'link'],
    sms: {
      ar: 'لم يتم قبول الحالة {{caseRef}}. اختر طبيبًا آخر.',
      fr: 'Le dossier {{caseRef}} n\'a pas été accepté. Choisissez un autre médecin.',
    },
    email: {
      ar: 'لم يتم قبول الحالة {{caseRef}}. اختر طبيبًا آخر. {{link}}',
      fr: 'Le dossier {{caseRef}} n\'a pas été accepté. Choisissez un autre médecin. {{link}}',
    },
  },
  case_answered: {
    allowed: ['caseRef', 'link'],
    sms: {
      ar: 'الرد على الحالة {{caseRef}} جاهز.',
      fr: 'La réponse au dossier {{caseRef}} est prête.',
    },
    email: {
      ar: 'الرد على الحالة {{caseRef}} جاهز. {{link}}',
      fr: 'La réponse au dossier {{caseRef}} est prête. {{link}}',
    },
  },
```

A case reference is a pseudonym, not an identifier — it is the only case-level fact these templates may carry, and the existing test that blocks clinical fields keeps guarding the rest.

- [ ] **Step 7: Run the tests**

Run:
```bash
pnpm --filter @mir/api test
```
Expected: PASS, including `route-access-audit.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src apps/api/.env.example .env.example
git commit -m "feat(cases): the HTTP surface, the quote TTL, and the expiry sweep"
```

---

### Task 8: The web surface

**Files:**
- Delete: `apps/web/app/schedule/` (tree), `apps/web/app/appointments/` (tree), `apps/web/components/schedule/BookAppointment.tsx`
- Create: `apps/web/app/cases/[ref]/pick-doctor/page.tsx`
- Modify: `apps/web/app/cases/[ref]/page.tsx`, `apps/web/app/doctor/page.tsx`, `apps/web/components/shell/` navigation
- Modify: `apps/web/lib/i18n/dictionary.ts`
- Test: `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/public-surface.spec.ts`

**Interfaces:**
- Consumes: the route table from Task 7; `CASE_STATUSES` from Task 1; `quoteAmountMinor`, `surgeMultiplierBp` from Task 2 (for the indicative directory price).
- Produces: no new shared interfaces.

- [ ] **Step 1: Write the failing test**

In `apps/web/e2e/public-surface.spec.ts`:

```ts
test('the calendar surface is gone', async ({ page }) => {
  for (const path of ['/schedule', '/schedule/calendar', '/schedule/availability', '/appointments']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @mir/web test:e2e public-surface`
Expected: FAIL — the routes still render.

- [ ] **Step 3: Delete the calendar surface**

```bash
git rm -r apps/web/app/schedule apps/web/app/appointments
git rm apps/web/components/schedule/BookAppointment.tsx
```

Remove the corresponding navigation entries from the shell, and every dictionary key that only those screens used (`scheduleAgendaEmpty`, `scheduleSlotTaken`, `bookingSlotTaken`, and the rest of the `schedule*`/`booking*` families). `dictionary.test.ts` asserts ar and fr stay in step, so a key deleted from one must go from both.

- [ ] **Step 4: Build the doctor picker**

`/cases/[ref]/pick-doctor` lists doctors from `GET /cases/directory?specialty=`, each row showing tier, answered-case count and the indicative price. Choosing one calls `POST /cases/:id/quote` and moves to a confirmation showing the locked price and its expiry.

The screen must state the two facts a lab needs and cannot infer:
- the price is held until `quote_expires_at`, and
- a decline returns the case without a second charge.

Both come from the dictionary; do not hard-code copy. Add `dstQuoteHeldUntil`, `dstQuoteExpired`, `dstDeclineNoSecondCharge`, `dstDirectoryEmpty` and their ar/fr values.

When the API answers 409 `SpecialtyClosedError`, render "no doctor is accepting this specialty right now" — never a price and never an empty table with no explanation.

- [ ] **Step 5: Run the tests**

Run:
```bash
pnpm --filter @mir/web test
pnpm --filter @mir/web test:e2e
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): the doctor picker replaces the calendar"
```

---

### Task 9: Record the superseded decisions, then run the full gate

**Files:**
- Modify: `docs/decisions.md`
- Modify: `BUILD_SPEC.md` §1.1, §1.3
- Modify: `docs/pre-launch-checklist.md`

- [ ] **Step 1: Append a dated revision to `docs/decisions.md`**

That file's own rule is that a changed decision is "a new revision of this file with a date and a rationale — not an edit in place." Append:

```markdown
---

# Revision — 2026-09-07: the consult model supersedes booking

## D2, D2a — superseded

D2 read "authorise at booking, capture when the Tunisian doctor accepts." Both
halves are gone: migration 0021 removed the patient card the authorisation was
taken against, and there is no booking. The replacement is in
`docs/superpowers/specs/2026-09-07-consult-model-design.md` — the lab pays a
quoted price, the funds are held, and they move when the doctor submits an
answer. D2a's choice of Stripe still stands as the rail, and it is still
unwired pending L7.

## D3 — superseded

D3 made triage-before-payment a toggle, default off. In the consult model the
doctor always sees a summary before accepting and never sees imaging before
accepting, so the toggle has no false position.
`SCHEDULING_TRIAGE_BEFORE_PAYMENT` is deleted rather than defaulted, because a
config key that can no longer be false is a lie in the schema.

## D4 — unchanged here, and under review

Arabic and French stand. Sub-project 6 puts English as the default to counsel
and to the product owner; until that is decided this file still says no English
in v1.
```

- [ ] **Step 2: Correct the stale positioning in `BUILD_SPEC.md`**

§1.1's actor table lists a patient who logs in and books, and §1.3 calls the
platform "a transfer and scheduling service." The scheduling half is now false.
Rewrite §1.1's rows for the two remaining actors and change §1.3 to describe a
transfer and consulting service — **keeping the reference-only viewer
constraint exactly as written.** That constraint is not touched by this
sub-project; sub-project 3 is where it is deliberately revisited.

- [ ] **Step 3: Run the full gate**

Run:
```bash
pnpm verify
```
Expected: every stage exits 0 — `check:synthetic`, `typecheck`, `lint`, `boundaries`, `boundaries:verify`, `test`, `build`, `check:bundle`.

If `pnpm test` fails with connection errors rather than assertions, run `pnpm db:clean` and retry: stale per-worker databases from the migration work are the usual cause.

- [ ] **Step 4: Confirm the gate that matters**

Run:
```bash
pnpm --filter @mir/api test rls
```
Expected: the seven P3.2 tests green, plus the five acceptance-gating tests from Task 3 and the three directory tests from Task 4. **This is the acceptance bar for the whole plan.** A green `pnpm verify` with a skipped RLS suite is not a pass — check the reported test count, since a suite that cannot reach Postgres is reported as skipped, not failed.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions.md BUILD_SPEC.md docs/pre-launch-checklist.md
git commit -m "docs: record the decisions the consult model supersedes"
```

---

## What this plan does not do

Named here so the next plan starts from an accurate picture, not from an
assumption that alignment is finished:

- **No money moves.** `payment-rail.ts` stays unwired. `POST /cases/:id/pay`
  records the state transition and nothing else — sub-project 4 puts a rail
  behind it, adds the hold and the release, and turns the destination-side
  coordination fee into a commission on the payout.
- **The doctor still sees the patient's name.** `patients_receiving_doctor`
  (`0002_rls.up.sql:303`) and the `patientName` field on the case DTO are
  untouched here. That is sub-project 2, and it is the PRD's stated top rule —
  do not ship a doctor-facing screen to real users before it lands.
- **There is no diagnosis to submit.** `markAnswered` moves a status; nothing
  authors a diagnosis or a prescription yet. Sub-project 3.
- **`tier_code` never changes on its own.** The column and the ladder exist and
  are read; the nightly job that recomputes a doctor's tier from their answered
  count arrives with sub-project 7, which is also where the admin analytics
  read the same counters. Until then every doctor stays `standard`.
