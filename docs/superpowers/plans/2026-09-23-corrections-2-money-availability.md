# Platform Corrections — Plan 2: Availability, Consult Price & Split, Yearly Plans

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A newly approved Tunisian doctor can switch availability on and is found by clinics; every consult costs a flat $100 split clinic $30 / doctor $20 / platform $50 and the ledger records it; the plan catalogue is two yearly tiers (Libyan clinic $1,000/yr, Tunisian doctor 1,000 TND/yr).

**Architecture:** One migration (`0031_consult_money_and_profiles`) carries all schema and SQL-function changes so they land atomically. The split is locked onto the case at quote time (like the amount already is) and the ledger reads the case, never the price table. Services change minimally: `PricingService.quoteFor` returns the corridor's flat price and shares; `CasesService` writes them at quote, accrues the clinic's remittance at pay and the doctor's payout at answer; `accept` accrues nothing.

**Tech Stack:** PostgreSQL migrations (`apps/api/migrations/NNNN_*.up.sql` + `.down.sql`), NestJS services, vitest against a real Postgres (`rls-harness`), zod contracts, Next.js client pages.

**Spec:** `docs/superpowers/specs/2026-09-21-platform-corrections-design.md` (§3, §4, §7)

## Global Constraints

- Money is integer MINOR units. USD has 2 digits (10000 = $100.00); **TND has 3** (1000000 = 1,000.000 TND). Divide only with `toMajorUnits`.
- The platform's share is never stored: `platform = amount − clinic_share − doctor_share`.
- A quoted case's amount and shares are never recomputed after quote.
- `LedgerSummary` keeps kinds in separate totals; nothing sums a remittance, a payout and a subscription into one number (§5.7 P0).
- Migrations ship a working `.down.sql`. Never delete a `billing_plans` row (subscriptions reference it) — deactivate.
- Copy is dictionary keys, all three locales (scratchpad `add_keys.py`).
- Rebuild contracts after every contracts change (`pnpm --filter @mir/contracts build`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Reproduction (done before writing this plan)

- `identity_decide_verification` flips a destination applicant to `tunisia_doctor` but **creates no `identity_doctor_profiles` row**. `cases_set_accepting` then updates zero rows → the API answers 404 → the switch shows "Something went wrong". Every doctor approved through the ops screen hits this.
- Tunisian sign-up asks for a CNOM number but **no specialty**, so even a profile would match no clinic's specialty filter.
- Earlier seeds wrote `Radiology`; cases and rates use `radiology`. The equality filter never matched.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/migrations/0031_consult_money_and_profiles.up.sql` / `.down.sql` | **Create.** Approval creates a verified profile; lowercase specialties; `pricing_consult_price`; case share columns; `doctor_payout` ledger kind; yearly plans. |
| `apps/api/src/modules/organisations/approval-profile.test.ts` | **Create.** Approval → profile → switch → directory. |
| `apps/web/lib/corridor/registry.ts` | **Modify.** Destination asks for `specialty` (select over `CONSULT_SPECIALTIES`). |
| `apps/web/components/case/CorridorFields.tsx` | **Modify.** A `specialty` select labels its options with `specialtyLabel`. |
| `apps/web/app/doctor/availability/page.tsx` | **Modify.** A 404 says "profile not complete — contact support", not the generic error. |
| `packages/contracts/src/pricing.ts` (+ test) | **Modify.** `ConsultSplit`, `splitOf(...)`. |
| `packages/contracts/src/ledger.ts` (+ test) | **Modify.** `doctor_payout` kind, schema, summary bucket. |
| `apps/api/src/modules/pricing/internal/pricing.service.ts` | **Modify.** Flat corridor price + shares. |
| `apps/api/src/modules/cases/internal/cases.service.ts` | **Modify.** Shares at quote; remittance at pay; no fee at accept; payout at answer. |
| `apps/api/src/modules/cases/internal/directory.service.ts` | **Modify.** Indicative price = the flat price. |
| `apps/api/src/modules/ledger/internal/ledger.service.ts` | **Modify.** `accrueClinicRemittance`, `accrueDoctorPayout`; `toEntry` maps `doctor_payout`. |
| `apps/api/src/modules/cases/cases-lifecycle.test.ts`, `apps/api/src/modules/ledger/ledger.test.ts` | **Modify.** Split and ledger tests. |
| `apps/web/app/cases/[ref]/pick-doctor/page.tsx` | **Modify.** Quote shows $100 · you keep $30 · you pay $70. |
| `apps/web/app/ledger/page.tsx`, `apps/web/app/admin/ledger/page.tsx`, `apps/web/lib/ledger/csv.ts` | **Modify.** Render `doctor_payout`; admin shows in / out / margin. |
| `packages/contracts/src/plan.ts` (+ test) | **Modify.** Codes `src_clinic_yearly`, `dst_doctor_yearly`; `price` + `interval`; catalogue. |
| `apps/api/src/modules/plans/internal/plans.service.ts` (+ `plans.test.ts`) | **Modify.** Map interval; yearly period. |
| `apps/web/app/pricing/page.tsx`, `apps/web/app/settings/billing/page.tsx` | **Modify.** Per-year prices. |

---

### Task 1: Approval creates a verified doctor profile; the switch works

**Interfaces:** Produces the SQL behaviour "approving a destination organisation upserts `identity_doctor_profiles` for each seated member with `verified_at = now()`, `specialty = lower(credentials->>'specialty')` (default `'unspecified'`), `license_number = credentials->>'cnomNumber'`".

- [x] **Step 1: Failing test** `approval-profile.test.ts`: an applicant seated in a pending destination organisation with credentials `{"cnomNumber":"TN-TEST-1","specialty":"Radiology"}` (set up via `h.owner`, mirroring `provisioning.test.ts`); admin context calls `OrganisationsService.decide(orgId, true)`; the doctor (`tunisia_doctor` context) calls `DirectoryService.setAccepting(true)` — resolves; a referring doctor seated in an approved source org of `ly-tn` sees the doctor in `listAcceptingDoctors('radiology')`. The profile row has `verified_at` set and `specialty = 'radiology'`.
- [x] **Step 2:** Run → FAIL (`NotFoundException: No doctor profile for this account`).
- [x] **Step 3: Migration** first section: `CREATE OR REPLACE FUNCTION identity_decide_verification(...)` — same body, plus, inside `IF p_approve`, when `p_granted_role = 'tunisia_doctor'`:

```sql
    INSERT INTO identity_doctor_profiles
      (user_id, country, license_number, specialty, clinic_name, verified_at, verified_by)
    SELECT m.user_id, 'TN',
           COALESCE(NULLIF(o.credentials->>'cnomNumber', ''), 'UNSET-' || left(m.user_id::text, 8)),
           COALESCE(NULLIF(lower(o.credentials->>'specialty'), ''), 'unspecified'),
           o.legal_name, now(), v_actor
      FROM identity_memberships m
      JOIN identity_organisations o ON o.id = m.organisation_id
     WHERE m.organisation_id = p_org
    ON CONFLICT (user_id) DO UPDATE
       SET verified_at = COALESCE(identity_doctor_profiles.verified_at, EXCLUDED.verified_at),
           verified_by = COALESCE(identity_doctor_profiles.verified_by, EXCLUDED.verified_by),
           specialty   = lower(identity_doctor_profiles.specialty);
```

  plus `UPDATE identity_doctor_profiles SET specialty = lower(specialty) WHERE specialty <> lower(specialty);`. The `.down.sql` restores the previous body (copied from `pg_get_functiondef` before editing).
- [x] **Step 4:** Migrate and run the test → PASS.
- [x] **Step 5: Sign-up asks the specialty.** Destination `documentRequirements` gains `{ key: 'specialty', kind: 'select', required: true, labelKey: 'caseNewSpecialty', options: [...CONSULT_SPECIALTIES] }`; `CorridorFields` labels a `specialty` select's options with `specialtyLabel`. Onboarding e2e still passes.
- [x] **Step 6: Specific message.** A 404 from `setAccepting` shows `t.availabilityNoProfile` ("Your doctor profile is not complete yet. Contact support to finish verification.") instead of the generic error.
- [x] **Step 7:** Commit.

### Task 2: A flat $100 consult with a 30 / 20 / 50 split, locked at quote

**Interfaces:** contracts `ConsultSplit { amountMinor; clinicShareMinor; doctorShareMinor; platformShareMinor; currency }`, `splitOf(amountMinor, clinicShareMinor, doctorShareMinor, currency)` (throws on shares exceeding the amount or non-integer/negative values). API `Quote` gains `clinicShareMinor`, `doctorShareMinor`; `CaseDto`/`CaseRecord` gain both (`number | null`).

- [x] **Step 1: Contract test first:** `splitOf(10000, 3000, 2000, 'USD')` → platform 5000; throws for 6000 + 5000 on 10000; throws for 0.5.
- [x] **Step 2: Migration section:**

```sql
CREATE TABLE pricing_consult_price (
  corridor_id        text PRIMARY KEY,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           text   NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  clinic_share_minor bigint NOT NULL CHECK (clinic_share_minor >= 0),
  doctor_share_minor bigint NOT NULL CHECK (doctor_share_minor >= 0),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (clinic_share_minor + doctor_share_minor <= amount_minor)
);
INSERT INTO pricing_consult_price VALUES ('ly-tn', 10000, 'USD', 3000, 2000, now());
-- RLS: readable by any authenticated role, writable by admin.

ALTER TABLE cases_cases
  ADD COLUMN clinic_share_minor bigint CHECK (clinic_share_minor >= 0),
  ADD COLUMN doctor_share_minor bigint CHECK (doctor_share_minor >= 0);
```

  and widen `billing_ledger_entries.kind` to `doctor_payout` (payout requires a case), with `CREATE UNIQUE INDEX billing_ledger_one_payout_per_case ON billing_ledger_entries (case_id) WHERE kind = 'doctor_payout'`. Read the real constraint names with `\d billing_ledger_entries` first.
- [x] **Step 3: API tests first:** quote stores 10000 / 3000 / 2000 for any specialty and tier; editing `pricing_consult_price` after quote leaves the quoted case unchanged; pay → one `coordination_fee` of 7000 USD on the clinic org; accept → no ledger row; answer → one `doctor_payout` of 2000 USD on the doctor's org; a repeated answer adds none.
- [x] **Step 4: Implement.** `quoteFor` reads `pricing_consult_price` (404 if none), keeps the closed-specialty 409. `quote` writes both shares in its UPDATE. `markPaid` → `ledger.accrueClinicRemittance(caseId)` (`quoted − clinic_share`, case's organisation). `accept` drops the destination accrual. `markAnswered` → `ledger.accrueDoctorPayout(caseId)` (`doctor_share`, org via `billing_owing_organisation(case, 'destination')`). Directory indicative price = the flat price.
- [x] **Step 5: Contracts ledger:** `doctorPayoutEntrySchema` in the union; `LedgerSummary.doctorPayouts` and `outstanding.doctor_payout`; `toEntry` maps it.
- [x] **Step 6: Web:** quoted card shows consult $100.00 · you keep $30.00 · you pay the platform $70.00; ledger labels payouts and totals them separately; admin ledger shows in / out / platform margin per case; CSV has the kind.
- [x] **Step 7:** Browser walk of pay → accept → answer and the three ledgers. Commit.

### Task 3: Two yearly plans

**Interfaces:** `PLAN_CODES` gains `src_clinic_yearly`, `dst_doctor_yearly` (old codes stay parseable). `PlanTier.priceMonthly` → `price: Money | null` + `interval: 'month' | 'year'`.

- [x] **Step 1: Tests first:** the catalogue has exactly one source tier (`src_clinic_yearly`, 100000 USD, year) and one destination tier (`dst_doctor_yearly`, 1000000 TND, year), `toMajorUnits` 1000 each; API `catalogue()` returns only those two; a yearly subscription's period is one year; the side trigger still refuses a cross-side plan.
- [x] **Step 2: Migration section:** `billing_interval` column (`month`|`year`), widened code check, the two plans inserted, the rest `active = false`, `billing_public_plans()` returns the interval.
- [x] **Step 3: Implement** contracts, `plans.service` (interval; `'1 year'` period), pricing and billing pages ("… / year").
- [x] **Step 4:** Browser check of `/pricing` and each role's billing settings. Commit.

### Task 4: Verification pass

- [x] Full API suite, web unit, Playwright; browser walk for clinic, doctor and ops. Record results and anything deferred at the bottom of this file.

---

## Execution notes (completed 2026-09-24)

**Deviations from the plan.**
- Three migrations, not one: 0031 (profile on approval), 0032 (consult price and split), 0033 (yearly plans). Each ships a down; 0033's round trip (down → up → down → up) was run on a scratch database.
- Plan codes are `src_clinic_yearly` / `dst_doctor_yearly`; the six monthly tiers are deactivated, never deleted, and stay parseable in `PLAN_CODES`.

**Defects found while executing (all fixed, with tests).**
1. **The ledger never accrued anything for a real caller.** `billing_ledger_entries` admits INSERT only for the system role, and accrual ran as the clinic or doctor, so it returned null silently — every referral was free. `CasesService` now runs `accrueClinicRemittance` / `accrueDoctorPayout` under `systemContext`; `LedgerService` still refuses a direct call from a clinic (pinned by `ledger.test.ts`).
2. **Billing settings offered both sides' plans.** A clinic could choose the doctor plan and only the 0022 trigger refused it. Now `tiersForSide`.
3. **The viewer bundle budget measured the wrong thing.** It summed every script loaded by the time it looked, which included Cornerstone fetched after first paint. It passed only while the full-resolution upgrade was broken (fixed in plan 1). Now measured to a `mir:viewer-first-image` performance mark: 293 KB against a 600 KB budget.

**Database move (owner's decision, 2026-09-23: "move to supabase").** The compose file had a hardcoded Supabase URL that connected as `postgres`, which has BYPASSRLS there — every policy off. The API's `DATABASE_URL` is now built from `.env` (`DATABASE_APP_USER/HOST/NAME` + `MIR_APP_DEV_PASSWORD`) and is always `mir_app`; new `DATABASE_SSL` (`off|require|verify`) — without it the Supabase connection was plain text. Tests and local walks stay on the local database. Supabase has 0001–0032 and no data; 0033 is not applied there yet.

**Measurements.**
- API: 413 passed (46 files). Web unit: 359 passed. Playwright: 124 passed, 84 skipped, 0 failed (2 workers; with the default worker count ten tests time out on page load on this machine — load, not regressions: all pass at 1–2 workers).
- Browser walk (production build, local API), case MIR-2026-0004: directory shows $100; quote shows $100 · keep $30 · pay the platform $70; paying writes one $70 coordination fee on the clinic's organisation; the availability switch goes off and back on; accept writes nothing; answer writes one $20 payout on the doctor's organisation; clinic and doctor billing each offer only their own yearly plan (US$1,000 / TND 1,000 per year); `/pricing` shows the two plans with no placeholder notice; ops sees $280 in, $80 out, $200 margin (four answered cases × $50). No page errors in any role.

**Deferred / open.**
- 0033 on Supabase: runs with the next `migrate` against that database.
- `.env` needs the four `DATABASE_APP_*` / `DATABASE_SSL` lines and a strong `MIR_APP_DEV_PASSWORD` (the owner's to set; the automated edit was refused).
- The Supabase admin password is in git history (commit d5272df, pushed) and must be rotated.
- A subscriber on a retired tier sees "no plan" as their current plan (the catalogue no longer lists it); they can move to the yearly plan from the same screen.
