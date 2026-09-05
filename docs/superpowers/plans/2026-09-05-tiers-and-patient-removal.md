# Subscription Tiers and Patient Account Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove patient accounts so a patient is a record the Libyan doctor creates and assigns to a Tunisian doctor, and make subscription tiers side-scoped with a coordination fee that accrues to both organisations.

**Architecture:** Three forward migrations (`0021`–`0023`) carry the schema. `0021` drops the patient login machinery and converts consent to a doctor attestation with an uploaded signed form, deliberately preserving `app_has_consent_for()`'s signature so the imaging policies are untouched. `0022` adds a `side` column to `billing_plans` and a trigger that refuses a cross-side subscription. `0023` builds the ledger's first real persistence, drops the Stripe patient-payment tables, and rewrites the appointment status machine that those payments defined.

**Tech Stack:** NestJS 11 + TypeScript 5.7 (`apps/api`), PostgreSQL with row-level security, Zod 4 contracts (`packages/contracts`), Next.js (`apps/web`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-tiers-and-patient-removal-design.md`

## Global Constraints

These apply to every task. They are the project's existing rules, not new ones.

- **No money is taken.** Blocking item L7 is unresolved. Nothing in this work may introduce a payment rail, a provider id, or a card. Recording what is owed is permitted; charging is not.
- **No total spanning both ledger kinds.** §5.7 P0: coordination fees and subscription charges must never merge into one "amount owed". No column, view, endpoint, or contract function may sum across `kind`.
- **Copy is dictionary keys, never translated strings** (§4.2). Anything user-visible added to a contract or a database row is a key matching `/^[a-z][A-Za-z0-9]*$/`.
- **`null` means unlimited**, never a large sentinel number.
- **Money is minor units, never a float.** The exponent is per-currency — TND and LYD are 3, not 2. Use `toMajorUnits`; never divide by 100.
- **Every route declares access.** `RequiresRole` or `PublicEndpoint` on every handler; `route-access-audit.test.ts` enforces this (P1.5).
- **RLS tests assert on the `mir_app` connection** — a non-superuser, NOBYPASSRLS, non-owner role. Asserting as the owner proves nothing.
- **Every migration ships a `.down.sql`** that restores the prior structures.
- **Limit enforcement stays unwired.** Tier contents are undecided. No guard may refuse an invitation or a case submission on a plan limit in this work. Do **not** create an unapplied `PlanGuard` decorator to mark the seam: `scripts/find-unwired.mjs` exists precisely because correct-but-uncalled code carrying a green test suite has been this repository's most expensive defect class. Document the seam in prose where the enforcement would attach (Task 7, Step 6).

## Local environment note

`pnpm --filter @mir/api test` runs `ALTER ROLE mir_app ... PASSWORD` cluster-wide (`rls-harness.ts:206`) and will break a running local API with `password authentication failed for user "mir_app"`. `.env` already sets `MIR_APP_DEV_PASSWORD=mir_app_test_pw` to match the harness default. If the error appears, run `docker compose --profile apps up -d db-grant` to re-attach it. This is expected, not a bug you introduced.

## File Structure

**Contracts** (`packages/contracts/src/`)
- `roles.ts` — loses `patient` from `ROLES`.
- `plan.ts` — gains `side` on `PlanTier`, six side-namespaced codes, `tiersForSide()`.
- `ledger.ts` — gains `LEDGER_ENTRY_KINDS` and `ledgerEntryKindSchema` so the API and the database agree on the closed set. The discriminated union is unchanged.

**Migrations** (`apps/api/migrations/`)
- `0021_remove_patient_accounts.{up,down}.sql` — role, claim machinery, patient policies, consent attestation columns and policies.
- `0022_side_scoped_plans.{up,down}.sql` — `billing_plans.side`, code set, side-match trigger, `billing_public_plans()`.
- `0023_ledger_and_fees.{up,down}.sql` — `billing_fee_schedule`, `billing_ledger_entries`, drop payment tables, appointment status machine.

**API** (`apps/api/src/`)
- `modules/consent/internal/consent.service.ts` — `grant()` becomes `attest()`.
- `modules/ledger/` — new module: `ledger.module.ts`, `index.ts`, `internal/ledger.service.ts`, `internal/ledger.controller.ts`.
- `modules/scheduling/internal/scheduling.service.ts` — accrual hooks on assign and accept.
- `modules/billing/` — payment endpoints and rail wiring removed; `payment-rail.ts` kept unwired.

**Web** (`apps/web/`)
- Delete `app/claim/`, `app/consent/`.
- `app/page.tsx`, `components/shell/nav.ts` — patient branches removed.
- `app/pricing/page.tsx` — two side tabs.
- `app/ledger/page.tsx` — real endpoint instead of `lib/api/mock`.

---

## Task 1: Remove `patient` from the role contract

**Files:**
- Modify: `packages/contracts/src/roles.ts:39-50`
- Test: `packages/contracts/src/roles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ROLES` as `['libya_doctor','tunisia_doctor','admin','applicant','assistant']`; `Role` no longer includes `'patient'`. Every later task depends on this narrowing — it is what makes the compiler find the call sites.

- [ ] **Step 1: Update the failing test**

In `packages/contracts/src/roles.test.ts`, replace the two assertions that name `patient`:

```typescript
it('rejects patient, which is no longer a role', () => {
  expect(roleSchema.safeParse('patient').success).toBe(false);
});

it('lists the five roles in a stable order', () => {
  expect(ROLES).toEqual([
    'libya_doctor',
    'tunisia_doctor',
    'admin',
    'applicant',
    'assistant',
  ]);
});
```

Delete the old `expect(roleSchema.parse('patient')).toBe('patient')`, the `isClinicalRole('patient')` case, the `requiresSecondFactor('patient')` case, and the `ROLES.slice(0, 4)` assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mir/contracts test -- roles`
Expected: FAIL — `roleSchema.safeParse('patient').success` is `true`.

- [ ] **Step 3: Make the change**

In `packages/contracts/src/roles.ts`, remove `'patient',` from the `ROLES` array. Then replace the doc comment's opening paragraph so it does not describe a role that no longer exists, and record why:

```typescript
/**
 * The roles from BUILD_SPEC P3.1, plus `applicant`. This list is the single
 * source of truth shared by the API, the web app, the Keycloak realm config,
 * and the database CHECK constraint. Adding a role means changing this, the
 * realm, and a migration — deliberately awkward, because a new role is a new
 * access path.
 *
 * WHY THERE IS NO `patient` ROLE.
 * A patient is a RECORD, never a login. The referring Libyan doctor creates the
 * record and assigns it to a receiving Tunisian doctor; the patient never
 * authenticates, so there is no session to scope and no policy to write. The
 * claim flow that used to turn a phone number into an account was removed in
 * migration 0021 along with the role itself.
 *
 * This is why consent is an ATTESTATION (0021): the doctor asserts they hold
 * the patient's signed form and uploads it, because there is no patient
 * session in which a patient could click anything.
 */
```

Keep the existing `applicant` and `assistant` paragraphs unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @mir/contracts test -- roles`
Expected: PASS.

- [ ] **Step 5: Build contracts so downstream typechecks see the narrowing**

Run: `pnpm --filter @mir/contracts build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/roles.ts packages/contracts/src/roles.test.ts
git commit -m "feat(contracts): remove the patient role

A patient is a record, never a login. Narrowing Role here is what makes
the compiler find every call site in the API and the web app."
```

---

## Task 2: Migration 0021 — drop the patient login machinery

**Files:**
- Create: `apps/api/migrations/0021_remove_patient_accounts.up.sql`
- Create: `apps/api/migrations/0021_remove_patient_accounts.down.sql`
- Test: `apps/api/src/shared/db/rls.test.ts`

**Interfaces:**
- Consumes: Task 1's narrowed `Role`.
- Produces: a schema with no `patient` role, no claim tables, and `consent_records` carrying `attested_by uuid NOT NULL`, `document_object_key text NOT NULL`, `document_sha256 text NOT NULL`. `app_has_consent_for(uuid)` keeps its exact signature and semantics. Tasks 3–5 depend on these column names.

- [ ] **Step 1: Write the up migration**

Create `apps/api/migrations/0021_remove_patient_accounts.up.sql`:

```sql
-- Patients are records, not accounts.
--
-- The referring Libyan doctor creates the patient and assigns them to a
-- receiving Tunisian doctor. Nobody signs in as a patient, so there is no
-- session to scope and no policy that can name one.
--
-- WHAT THIS MIGRATION IS CAREFUL NOT TO BREAK.
-- `app_has_consent_for(uuid)` keeps its exact signature AND its exact
-- semantics. It gates the receiving doctor's access to demographics
-- (0002_rls.up.sql:303) and to imaging (:200, :365) — the policies the P3.2
-- gate tests directly. Only the WRITER of a consent row changes here. A
-- migration that redefined that function would be rewriting the access-control
-- core under cover of a role removal.
--
-- WHY CONSENT SURVIVES AT ALL.
-- Removing the patient's login does not remove the patient's consent. The
-- patient signs on paper; the doctor attests they hold it and uploads the
-- scan. `evidence_hash` keeps its meaning (the hash of the rendered terms) and
-- `document_sha256` is a SECOND, separate hash of the signed artefact, because
-- a dispute needs to tell "these were the terms" from "this is what they
-- signed".

BEGIN;

-- ---------------------------------------------------------------------------
-- Consent becomes an attestation. Columns first: the new policies reference
-- them, and the backfill needs a value before NOT NULL can be applied.
-- ---------------------------------------------------------------------------
ALTER TABLE consent_records
  ADD COLUMN attested_by          uuid REFERENCES identity_users(id),
  ADD COLUMN document_object_key  text,
  ADD COLUMN document_sha256      text;

-- There is no production data (README: no real patients, no infrastructure),
-- so any row present is local or test data. Deleting it is honest: a consent
-- row from the old model has no attesting doctor and no signed document, and
-- inventing either would fabricate evidence.
DELETE FROM consent_records;

ALTER TABLE consent_records
  ALTER COLUMN attested_by         SET NOT NULL,
  ALTER COLUMN document_object_key SET NOT NULL,
  ALTER COLUMN document_sha256     SET NOT NULL,
  ADD CONSTRAINT consent_document_sha256_is_hex
    CHECK (document_sha256 ~ '^[0-9a-f]{64}$');

CREATE INDEX consent_records_attested_by_idx ON consent_records (attested_by);

-- ---------------------------------------------------------------------------
-- Policies naming the patient role. Dropped BEFORE the role leaves the CHECK
-- constraint: a policy referencing a value the constraint forbids is dead code
-- that still evaluates, and dead access-control code is how a system fails
-- open later.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS consent_patient_select ON consent_records;
DROP POLICY IF EXISTS consent_patient_insert ON consent_records;
DROP POLICY IF EXISTS consent_patient_revoke ON consent_records;
DROP POLICY IF EXISTS patients_claimed        ON patients_patients;
DROP POLICY IF EXISTS payments_patient        ON billing_payments;
DROP POLICY IF EXISTS payments_patient_insert ON billing_payments;
DROP POLICY IF EXISTS claim_tokens_issuer_select ON patients_claim_tokens;
DROP POLICY IF EXISTS claim_tokens_issuer_insert ON patients_claim_tokens;

-- The referring doctor attests, for a patient they created, as themselves.
-- All three conditions are required: without the third, a doctor could file an
-- attestation in a colleague's name.
CREATE POLICY consent_referring_doctor_insert ON consent_records FOR INSERT
  WITH CHECK (
    app_current_role() = 'libya_doctor'
    AND app_created_patient(patient_id)
    AND attested_by = app_current_user_id()
  );

-- Revocation still sets revoked_at and never deletes: the record of consent
-- having been granted is itself the evidence.
CREATE POLICY consent_referring_doctor_revoke ON consent_records FOR UPDATE
  USING (app_current_role() = 'libya_doctor' AND app_created_patient(patient_id))
  WITH CHECK (app_created_patient(patient_id));

-- ---------------------------------------------------------------------------
-- The claim flow, in full.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS patients_claim_with_token(text);
DROP TABLE IF EXISTS patients_claim_tokens;

DROP INDEX IF EXISTS patients_patients_claimed_by_idx;
ALTER TABLE patients_patients DROP COLUMN claimed_by_user;

-- Dropped last: the policies above referenced it.
DROP FUNCTION IF EXISTS app_claimed_patient(uuid);

-- ---------------------------------------------------------------------------
-- The two SECURITY DEFINER predicates that branch on the patient role.
-- Rewritten rather than dropped: both are still needed for the two roles that
-- remain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_can_see_study(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM imaging_studies s
    WHERE s.id = p_study
      AND (
        (app_current_role() = 'libya_doctor' AND s.uploaded_by = app_current_user_id())
        OR (app_current_role() = 'tunisia_doctor'
            AND app_study_linked_to_my_appointment(s.id)
            AND app_has_consent_for(s.patient_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_can_see_appointment(p_appointment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scheduling_appointments a
    WHERE a.id = p_appointment
      AND (
        (app_current_role() = 'tunisia_doctor' AND a.doctor_id = app_current_user_id())
        OR (app_current_role() = 'libya_doctor' AND app_created_patient(a.patient_id))
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- The role itself. Last, so nothing above can still reference it.
-- ---------------------------------------------------------------------------
DELETE FROM identity_users WHERE role = 'patient';

ALTER TABLE identity_users DROP CONSTRAINT IF EXISTS identity_users_role_check;
ALTER TABLE identity_users ADD CONSTRAINT identity_users_role_check
  CHECK (role IN ('libya_doctor','tunisia_doctor','admin','applicant','assistant'));

COMMIT;
```

- [ ] **Step 2: Write the down migration**

Create `apps/api/migrations/0021_remove_patient_accounts.down.sql`. It restores the structures for local rollback; it cannot restore deleted rows, and says so.

```sql
-- Local rollback only. Deleted patient accounts and consent rows are NOT
-- restored — this recreates structure, not data.

BEGIN;

ALTER TABLE identity_users DROP CONSTRAINT IF EXISTS identity_users_role_check;
ALTER TABLE identity_users ADD CONSTRAINT identity_users_role_check
  CHECK (role IN ('libya_doctor','tunisia_doctor','patient','admin','applicant','assistant'));

ALTER TABLE patients_patients ADD COLUMN claimed_by_user uuid REFERENCES identity_users(id);
CREATE INDEX patients_patients_claimed_by_idx ON patients_patients (claimed_by_user);

CREATE OR REPLACE FUNCTION app_claimed_patient(p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM patients_patients p
    WHERE p.id = p_patient AND p.claimed_by_user = app_current_user_id()
  );
$$;
GRANT EXECUTE ON FUNCTION app_claimed_patient(uuid) TO mir_app;

CREATE TABLE patients_claim_tokens (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  patient_id   uuid NOT NULL REFERENCES patients_patients(id),
  token_hash   text NOT NULL,
  phone_e164   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  issued_by    uuid NOT NULL REFERENCES identity_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_claim_tokens_hash_idx ON patients_claim_tokens (token_hash);
CREATE INDEX patients_claim_tokens_patient_idx ON patients_claim_tokens (patient_id);
ALTER TABLE patients_claim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients_claim_tokens FORCE  ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON patients_claim_tokens TO mir_app;

CREATE POLICY patients_claimed ON patients_patients FOR SELECT
  USING (app_current_role() = 'patient' AND claimed_by_user = app_current_user_id());

DROP POLICY IF EXISTS consent_referring_doctor_insert ON consent_records;
DROP POLICY IF EXISTS consent_referring_doctor_revoke ON consent_records;

CREATE POLICY consent_patient_select ON consent_records FOR SELECT
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id));
CREATE POLICY consent_patient_insert ON consent_records FOR INSERT
  WITH CHECK (app_current_role() = 'patient' AND app_claimed_patient(patient_id));
CREATE POLICY consent_patient_revoke ON consent_records FOR UPDATE
  USING (app_current_role() = 'patient' AND app_claimed_patient(patient_id))
  WITH CHECK (app_claimed_patient(patient_id));

DROP INDEX IF EXISTS consent_records_attested_by_idx;
ALTER TABLE consent_records
  DROP CONSTRAINT IF EXISTS consent_document_sha256_is_hex,
  DROP COLUMN attested_by,
  DROP COLUMN document_object_key,
  DROP COLUMN document_sha256;

COMMIT;
```

- [ ] **Step 3: Update the RLS harness for the new schema**

In `apps/api/src/shared/db/testing/rls-harness.ts`:

Change `createPatient` to drop the claim parameter:

```typescript
export async function createPatient(owner: Pool, createdByDoctor: string): Promise<string> {
  const n = uniq();
  const res = await owner.query<{ id: string }>(
    `INSERT INTO patients_patients
       (phone_e164, full_name, date_of_birth, sex, created_by_doctor)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`+2189${n.replace(/\D/g, '').slice(-9)}`, `Patient ${n}`, '1985-06-15', 'M', createdByDoctor],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createPatient returned no row');
  return row.id;
}
```

Change `grantConsent` to require the attesting doctor:

```typescript
export async function grantConsent(
  owner: Pool,
  patientId: string,
  grantedTo: string,
  attestedBy: string,
): Promise<string> {
  const res = await owner.query<{ id: string }>(
    `INSERT INTO consent_records
       (patient_id, scope, granted_to, terms_version, terms_locale, evidence_hash,
        attested_by, document_object_key, document_sha256)
     VALUES ($1, 'cross_border_transfer', $2, 'v1', 'ar', $3, $4, $5, $6) RETURNING id`,
    [patientId, grantedTo, 'a'.repeat(64), attestedBy, `consent/${patientId}.pdf`, 'b'.repeat(64)],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('grantConsent returned no row');
  return row.id;
}
```

Remove `patients_claim_tokens` from the `truncateAll` list if it is named there.

- [ ] **Step 4: Write the failing RLS tests**

Append to `apps/api/src/shared/db/rls.test.ts`, inside the top-level `describe`:

```typescript
describe('patient accounts are gone', () => {
  it('the role CHECK constraint refuses patient', async () => {
    await expect(
      h.owner.query(
        `INSERT INTO identity_users (keycloak_sub, role, phone_e164, full_name, status)
         VALUES ('sub-patient-check', 'patient', '+218911111111', 'Nobody', 'active')`,
      ),
    ).rejects.toThrow(/identity_users_role_check/);
  });

  it('no policy anywhere names the patient role', async () => {
    const res = await h.owner.query<{ policyname: string; tablename: string }>(
      `SELECT policyname, tablename FROM pg_policies
       WHERE schemaname = 'public'
         AND (qual LIKE '%''patient''%' OR with_check LIKE '%''patient''%')`,
    );
    // A policy naming a role the CHECK constraint forbids is dead code that
    // still evaluates — the shape of a fail-open bug.
    expect(res.rows).toEqual([]);
  });

  it('the claim machinery no longer exists', async () => {
    const tables = await h.owner.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename = 'patients_claim_tokens'`,
    );
    expect(tables.rows).toEqual([]);

    const fns = await h.owner.query<{ proname: string }>(
      `SELECT proname FROM pg_proc
       WHERE proname IN ('patients_claim_with_token', 'app_claimed_patient')`,
    );
    expect(fns.rows).toEqual([]);

    const cols = await h.owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'patients_patients' AND column_name = 'claimed_by_user'`,
    );
    expect(cols.rows).toEqual([]);
  });
});

describe('consent as a doctor attestation', () => {
  it('the referring doctor may attest for a patient they created', async () => {
    const libya = await createUser(h.owner, 'libya_doctor');
    const tunisia = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, libya);

    const inserted = await asUser(h.app, { userId: libya, role: 'libya_doctor' }, async (c) => {
      const res = await c.query<{ id: string }>(
        `INSERT INTO consent_records
           (patient_id, scope, granted_to, terms_version, terms_locale, evidence_hash,
            attested_by, document_object_key, document_sha256)
         VALUES ($1, 'cross_border_transfer', $2, 'v1', 'ar', $3, $4, $5, $6)
         RETURNING id`,
        [patient, tunisia, 'a'.repeat(64), libya, 'consent/x.pdf', 'b'.repeat(64)],
      );
      return res.rows.length;
    });
    expect(inserted).toBe(1);
  });

  it('a doctor cannot attest in another doctor\'s name', async () => {
    const libya = await createUser(h.owner, 'libya_doctor');
    const other = await createUser(h.owner, 'libya_doctor');
    const tunisia = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, libya);

    await expect(
      asUser(h.app, { userId: libya, role: 'libya_doctor' }, (c) =>
        c.query(
          `INSERT INTO consent_records
             (patient_id, scope, granted_to, terms_version, terms_locale, evidence_hash,
              attested_by, document_object_key, document_sha256)
           VALUES ($1, 'cross_border_transfer', $2, 'v1', 'ar', $3, $4, $5, $6)`,
          [patient, tunisia, 'a'.repeat(64), other, 'consent/x.pdf', 'b'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a doctor cannot attest for a patient they did not create', async () => {
    const libya = await createUser(h.owner, 'libya_doctor');
    const stranger = await createUser(h.owner, 'libya_doctor');
    const tunisia = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, stranger);

    await expect(
      asUser(h.app, { userId: libya, role: 'libya_doctor' }, (c) =>
        c.query(
          `INSERT INTO consent_records
             (patient_id, scope, granted_to, terms_version, terms_locale, evidence_hash,
              attested_by, document_object_key, document_sha256)
           VALUES ($1, 'cross_border_transfer', $2, 'v1', 'ar', $3, $4, $5, $6)`,
          [patient, tunisia, 'a'.repeat(64), libya, 'consent/x.pdf', 'b'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('the receiving doctor still reaches imaging only with an appointment AND consent', async () => {
    const libya = await createUser(h.owner, 'libya_doctor');
    const tunisia = await createUser(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, libya);
    const study = await createStudy(h.owner, patient, libya);
    const appt = await createAppointment(h.owner, patient, tunisia, 'confirmed');
    await linkStudy(h.owner, appt, study);

    const before = await asUser(h.app, { userId: tunisia, role: 'tunisia_doctor' }, (c) =>
      c.query(`SELECT id FROM imaging_studies WHERE id = $1`, [study]),
    );
    expect(before.rows).toEqual([]);

    await grantConsent(h.owner, patient, tunisia, libya);

    const after = await asUser(h.app, { userId: tunisia, role: 'tunisia_doctor' }, (c) =>
      c.query(`SELECT id FROM imaging_studies WHERE id = $1`, [study]),
    );
    expect(after.rows.length).toBe(1);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm --filter @mir/api test -- rls`
Expected: FAIL — the migration has not been applied to the test template yet, so `attested_by` does not exist and the patient role still inserts.

- [ ] **Step 6: Run the migration and re-run**

Run: `pnpm --filter @mir/api test -- rls`

The harness builds its template database by running every migration in order, so no separate migrate step is needed for tests. If the suite reports the template is cached, run `pnpm db:clean` first.

Expected: PASS.

- [ ] **Step 7: Apply to the local database**

Run: `pnpm --filter @mir/api migrate:up`
Expected: `0021_remove_patient_accounts` applied.

- [ ] **Step 8: Commit**

```bash
git add apps/api/migrations/0021_remove_patient_accounts.up.sql \
        apps/api/migrations/0021_remove_patient_accounts.down.sql \
        apps/api/src/shared/db/testing/rls-harness.ts \
        apps/api/src/shared/db/rls.test.ts
git commit -m "feat(db): drop patient accounts, make consent a doctor attestation

app_has_consent_for() keeps its exact signature and semantics, so the
imaging policies the P3.2 gate tests are untouched. Only the writer of a
consent row changes."
```

---

## Task 3: Strip the patient role from API guards and branches

**Files:**
- Modify: `apps/api/src/modules/imaging/internal/dicomweb.controller.ts:42,74,107,122,176,204,256`
- Modify: `apps/api/src/modules/imaging/internal/studies.controller.ts:33`
- Modify: `apps/api/src/modules/patients/internal/patients.controller.ts:79,94-118`
- Modify: `apps/api/src/modules/scheduling/internal/scheduling.controller.ts:179,185,232,240,253,277`
- Modify: `apps/api/src/modules/consent/internal/consent.controller.ts:49,69,90,98`
- Modify: `apps/api/src/modules/identity/internal/profile.controller.ts:24,30,36,48`
- Modify: `apps/api/src/modules/identity/internal/identity.controller.ts:38`
- Modify: `apps/api/src/modules/identity/internal/identity.service.ts:50-71`
- Modify: `apps/api/src/modules/organisations/internal/organisations.controller.ts:120`
- Modify: `apps/api/src/modules/notifications/internal/notifications.subscriber.ts:32`
- Modify: `apps/api/src/modules/audit/internal/audit.service.ts:197`
- Modify: `apps/api/src/modules/patients/internal/patients.service.ts` (claim methods)

**Interfaces:**
- Consumes: Task 1's narrowed `Role`, Task 2's schema.
- Produces: an API with no reference to `'patient'` as a role. `IdentityService`'s session shape loses `patientId`.

- [ ] **Step 1: Let the compiler find the call sites**

Run: `pnpm --filter @mir/api typecheck`
Expected: FAIL, with one error per `RequiresRole('patient', ...)` and per patient branch. This list is the task's worklist — work through it rather than grepping.

- [ ] **Step 2: Remove `'patient'` from every `RequiresRole` list**

Mechanical. In each file listed above, delete the `'patient',` argument. Where `'patient'` was the ONLY role, the endpoint goes entirely:

- `patients.controller.ts` — delete `POST /patients/:id/claim-token` (line 94-102) and `POST /patients/claim` (line 112-118), and the `issueClaimToken` / `claimWithToken` methods in `patients.service.ts` that back them.
- `consent.controller.ts` — `POST /consent` (line 90) and `DELETE /consent/:id` (line 98) keep their paths but change role to `'libya_doctor'`; the body shape changes in Task 4.

- [ ] **Step 3: Remove the patient branches in `identity.service.ts`**

Replace lines 50-71 with:

```typescript
      return {
        userId: user.id,
        role: ctx.role,
        displayName: user.full_name,
        // Every remaining role requires a second factor (SECOND_FACTOR_ROLES),
        // and the guard already refuses a clinical role whose token lacks the
        // AMR claim (P4.3). Reaching this point means MFA was satisfied.
        // Reported for the UI's benefit, never relied on for access.
        mfaEnrolled: true,
      };
```

Delete the `patientId` local and its query, and remove `patientId` from the returned session type wherever it is declared.

- [ ] **Step 4: Remove the patient-actor branches**

In `notifications.subscriber.ts:32`, delete `if (event.actorRole === 'patient') return;`. In `audit.service.ts:197`, delete the branch returning `'patient'`.

- [ ] **Step 5: Run typecheck and the full API suite**

Run: `pnpm --filter @mir/api typecheck && pnpm --filter @mir/api test`
Expected: PASS. `route-access-audit.test.ts` must still pass — it proves no endpoint lost its access declaration during the edit.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "refactor(api): remove patient guards, branches, and the claim endpoints"
```

---

## Task 4: Consent attestation service and endpoint

**Files:**
- Modify: `apps/api/src/modules/consent/internal/consent.service.ts:198-270`
- Modify: `apps/api/src/modules/consent/internal/consent.controller.ts:85-105`
- Modify: `packages/contracts/src/case.ts` (or wherever `grantConsentSchema` lives — find with `grep -rn "grantConsent" packages/contracts/src`)
- Test: `apps/api/src/modules/consent/consent.test.ts`

**Interfaces:**
- Consumes: Task 2's `consent_records` columns.
- Produces: `ConsentService.attest(input: AttestConsentInput): Promise<{ consentId: string; evidenceHash: string }>` where `AttestConsentInput = { patientId: string; grantedTo: string; termsVersion: string; termsLocale: Locale; termsBody: string; documentObjectKey: string; documentSha256: string }`. Task 9's accrual and Task 11's web form both use this shape.

- [ ] **Step 1: Add the contract schema**

In the contracts file that holds the consent input schema, add:

```typescript
/**
 * What the referring doctor submits to record consent.
 *
 * There is no patient session, so this is an ATTESTATION: the doctor asserts
 * they hold the signed form and supplies it. `documentSha256` is the hash of
 * the uploaded bytes and is NOT `evidenceHash`, which stays the hash of the
 * rendered terms — a dispute needs to tell "these were the terms" from "this
 * is what they signed".
 */
export const attestConsentSchema = z.object({
  patientId: z.string().uuid(),
  grantedTo: z.string().uuid(),
  termsVersion: z.string().min(1).max(32),
  termsLocale: localeSchema,
  documentObjectKey: z.string().min(1).max(512),
  documentSha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase sha-256 hex digest'),
  /** The doctor confirms they hold the signed form. Refused if false. */
  attested: z.literal(true),
});
export type AttestConsentInput = z.infer<typeof attestConsentSchema>;
```

`attested: z.literal(true)` rather than `z.boolean()`: an attestation that can arrive `false` is a field the caller can forget, and the schema should make "submitted without attesting" unrepresentable.

- [ ] **Step 2: Write the failing service test**

In `apps/api/src/modules/consent/consent.test.ts`, replace the `grant` tests with:

```typescript
it('records an attestation with both hashes and the attesting doctor', async () => {
  const libya = await createUser(h.owner, 'libya_doctor');
  const tunisia = await createUser(h.owner, 'tunisia_doctor');
  const patient = await createPatient(h.owner, libya);

  const result = await runWithContext(ctx(libya, 'libya_doctor'), () =>
    consent.attest({
      patientId: patient,
      grantedTo: tunisia,
      termsVersion: 'v1',
      termsLocale: 'ar',
      documentObjectKey: `consent/${patient}.pdf`,
      documentSha256: 'c'.repeat(64),
      attested: true,
    }),
  );

  expect(result.evidenceHash).toBe(hashConsentText(V1_AR));

  const row = await h.owner.query<{
    attested_by: string;
    document_sha256: string;
    evidence_hash: string;
  }>(`SELECT attested_by, document_sha256, evidence_hash FROM consent_records WHERE id = $1`, [
    result.consentId,
  ]);
  expect(row.rows[0]?.attested_by).toBe(libya);
  expect(row.rows[0]?.document_sha256).toBe('c'.repeat(64));
  // The two hashes are different things and must not be conflated.
  expect(row.rows[0]?.evidence_hash).not.toBe(row.rows[0]?.document_sha256);
});

it('refuses an attestation for a patient the doctor did not create', async () => {
  const libya = await createUser(h.owner, 'libya_doctor');
  const stranger = await createUser(h.owner, 'libya_doctor');
  const tunisia = await createUser(h.owner, 'tunisia_doctor');
  const patient = await createPatient(h.owner, stranger);

  await expect(
    runWithContext(ctx(libya, 'libya_doctor'), () =>
      consent.attest({
        patientId: patient,
        grantedTo: tunisia,
        termsVersion: 'v1',
        termsLocale: 'ar',
        documentObjectKey: 'consent/x.pdf',
        documentSha256: 'c'.repeat(64),
        attested: true,
      }),
    ),
  ).rejects.toThrow();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @mir/api test -- consent`
Expected: FAIL — `consent.attest is not a function`.

- [ ] **Step 4: Rename and extend `grant()`**

In `consent.service.ts`, rename `grant` to `attest`, take `AttestConsentInput`, and write the three new columns. `attested_by` comes from `requireContext().userId` and **never from the input** — same rule as `patients_claim_with_token` used to follow for the phone number: a caller must not be able to name someone else as the attester. Keep the existing terms lookup and `evidence_hash` computation exactly as they are.

- [ ] **Step 5: Update the controller**

In `consent.controller.ts`, the `POST /consent` handler becomes:

```typescript
  @RequiresRole('libya_doctor')
  @Post()
  @HttpCode(201)
  async attest(@Body() body: unknown): Promise<{ consentId: string; evidenceHash: string }> {
    return this.consent.attest(attestConsentSchema.parse(body));
  }
```

and `DELETE /consent/:id` changes its guard to `@RequiresRole('libya_doctor')`.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @mir/api test -- consent`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/consent packages/contracts/src
git commit -m "feat(consent): the referring doctor attests and supplies the signed form

attested_by comes from the session, never the request body — a caller
must not be able to file an attestation in someone else's name."
```

---

## Task 5: Remove the patient surface from the web app

**Files:**
- Delete: `apps/web/app/claim/`, `apps/web/app/consent/`
- Modify: `apps/web/app/page.tsx:74-95,472-485`
- Modify: `apps/web/components/shell/nav.ts:116,132`
- Modify: `apps/web/app/appointments/page.tsx:27`, `apps/web/app/appointments/new/page.tsx:39`, `apps/web/app/appointments/[id]/page.tsx:39`
- Modify: `apps/web/lib/corridor/registry.test.ts:36`

**Interfaces:**
- Consumes: Task 1's narrowed `Role`.
- Produces: a web app with no patient route and no patient role branch.

- [ ] **Step 1: Let the compiler find the call sites**

Run: `pnpm --filter @mir/web typecheck`
Expected: FAIL on each `'patient'` literal that no longer satisfies `Role`.

- [ ] **Step 2: Delete the patient routes**

```bash
git rm -r apps/web/app/claim apps/web/app/consent
```

- [ ] **Step 3: Remove the patient branches in `page.tsx`**

Delete the `role === 'patient' && user?.patientId === undefined` claim card (lines 79-85), the `{role === 'patient' && <PatientDashboard />}` line, the `PatientDashboard` component and its import, and the `case 'patient':` arm of the quick-actions switch.

- [ ] **Step 4: Fix the nav**

In `components/shell/nav.ts`, change the `/appointments` entry's `roles` from `[...SOURCE_ROLES, 'patient']` to `SOURCE_ROLES`, and delete the whole `/consent` entry (lines 129-135).

- [ ] **Step 5: Fix the RoleGates**

In the three appointment pages, drop `'patient'` from each `allow` array. In `registry.test.ts:36`, delete the `sideForRole('patient')` assertion.

- [ ] **Step 6: Typecheck, lint, and test**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web lint && pnpm --filter @mir/web test`
Expected: PASS.

- [ ] **Step 7: Re-point the booking copy**

The appointment screens were written for a patient booking their own visit and are now used by a Libyan doctor assigning a referral. In `lib/i18n/dictionary.ts`, update the copy behind `bookingTitle` and the appointment page headings in every locale so they read as an assignment ("Assign to a receiving doctor") rather than a self-booking ("Book your appointment"). The keys keep their names; only the translated values change.

This is not cosmetic. §4.4 requires the UI never misdescribe the action a user is taking, and a doctor told they are "booking your appointment" is being told something false about whose appointment it is.

- [ ] **Step 8: Check for orphaned dictionary keys**

Run: `grep -rn "claimTitle\|claimDescription\|claimSubmit\|navConsents" apps/web`
Expected: hits only in `lib/i18n/dictionary.ts`. Delete those keys from every locale in the dictionary — an unused key in a translation file is work someone will pay a translator for.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web
git commit -m "refactor(web): remove the patient portal, dashboard, and nav entries"
```

---

## Task 6: Side-scoped plan tiers in the contract

**Files:**
- Modify: `packages/contracts/src/plan.ts:27-30,55-72,140-190`
- Test: `packages/contracts/src/plan.test.ts`

**Interfaces:**
- Consumes: `endpointSideSchema` and `EndpointSide` from `./corridor`.
- Produces: `planTierSchema` with a `side` field; `PLAN_CODES = ['src_solo','src_clinic','src_network','dst_solo','dst_clinic','dst_network']`; `tiersForSide(tiers: readonly PlanTier[], side: EndpointSide): PlanTier[]`. Tasks 7 and 11 use both.

- [ ] **Step 1: Write the failing test**

Add to `packages/contracts/src/plan.test.ts`:

```typescript
import { endpointSideSchema } from './corridor';
import { PLACEHOLDER_CATALOGUE, PLAN_CODES, planTierSchema, tiersForSide } from './plan';

describe('side-scoped tiers', () => {
  it('every catalogue entry declares a side', () => {
    for (const tier of PLACEHOLDER_CATALOGUE) {
      expect(endpointSideSchema.safeParse(tier.side).success).toBe(true);
    }
  });

  it('a tier without a side does not parse', () => {
    const { side: _omitted, ...withoutSide } = PLACEHOLDER_CATALOGUE[0]!;
    expect(planTierSchema.safeParse(withoutSide).success).toBe(false);
  });

  it('tiersForSide returns only the requested side', () => {
    const source = tiersForSide(PLACEHOLDER_CATALOGUE, 'source');
    expect(source.length).toBe(3);
    expect(source.every((t) => t.side === 'source')).toBe(true);

    const destination = tiersForSide(PLACEHOLDER_CATALOGUE, 'destination');
    expect(destination.length).toBe(3);
    expect(destination.every((t) => t.side === 'destination')).toBe(true);
  });

  it('the two ladders do not share a code', () => {
    expect(new Set(PLAN_CODES).size).toBe(PLAN_CODES.length);
  });

  it('preserves sort order within a side', () => {
    const sorts = tiersForSide(PLACEHOLDER_CATALOGUE, 'source').map((t) => t.sort);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @mir/contracts test -- plan`
Expected: FAIL — `tiersForSide` is not exported.

- [ ] **Step 3: Widen the codes and the schema**

In `plan.ts`:

```typescript
import { endpointSideSchema, type EndpointSide } from './corridor';

/**
 * Two ladders, one per corridor side.
 *
 * A source organisation SUBMITS cases and a destination organisation RECEIVES
 * them. Those are different products with different meters, and a single
 * `monthlyCaseLimit` that means "submitted" on one side and "accepted" on the
 * other is one name for two things — the kind of ambiguity that survives right
 * up until someone disputes an invoice.
 *
 * Codes are namespaced rather than sided by a composite key so that
 * `billing_subscriptions.plan_code` stays a single-column foreign key.
 */
export const PLAN_CODES = [
  'src_solo',
  'src_clinic',
  'src_network',
  'dst_solo',
  'dst_clinic',
  'dst_network',
] as const;
```

Add `side: endpointSideSchema,` to `planTierSchema`, immediately after `code`.

- [ ] **Step 4: Add the helper**

```typescript
/**
 * The tiers on one side of the corridor, in display order.
 *
 * One place, so the pricing page and the billing settings screen cannot
 * disagree about which ladder an organisation is looking at.
 */
export function tiersForSide(tiers: readonly PlanTier[], side: EndpointSide): PlanTier[] {
  return tiers.filter((t) => t.side === side).sort((a, b) => a.sort - b.sort);
}
```

- [ ] **Step 5: Rewrite `PLACEHOLDER_CATALOGUE` as two ladders**

Keep the existing `TODO(pricing)` header and strengthen its first line to: `TODO(pricing): every value in this object is invented, and the TIER CONTENTS are undecided — not merely the numbers.` Then:

```typescript
export const PLACEHOLDER_CATALOGUE: readonly PlanTier[] = [
  {
    code: 'src_solo',
    side: 'source',
    labelKey: 'planSrcSoloName',
    blurbKey: 'planSrcSoloBlurb',
    priceMonthly: { amountMinor: 4900, currency: 'USD' },
    seatLimit: 1,
    monthlyCaseLimit: 10,
    entitlements: ['csvExport'],
    sort: 0,
  },
  {
    code: 'src_clinic',
    side: 'source',
    labelKey: 'planSrcClinicName',
    blurbKey: 'planSrcClinicBlurb',
    priceMonthly: { amountMinor: 19900, currency: 'USD' },
    seatLimit: 10,
    monthlyCaseLimit: 100,
    entitlements: ['csvExport', 'prioritySupport', 'auditTrailRetention'],
    sort: 1,
  },
  {
    code: 'src_network',
    side: 'source',
    labelKey: 'planSrcNetworkName',
    blurbKey: 'planSrcNetworkBlurb',
    priceMonthly: null,
    seatLimit: null,
    monthlyCaseLimit: null,
    entitlements: [
      'csvExport',
      'prioritySupport',
      'auditTrailRetention',
      'multiCorridor',
      'dedicatedOnboarding',
    ],
    sort: 2,
  },
  {
    code: 'dst_solo',
    side: 'destination',
    labelKey: 'planDstSoloName',
    blurbKey: 'planDstSoloBlurb',
    priceMonthly: { amountMinor: 4900, currency: 'USD' },
    seatLimit: 1,
    monthlyCaseLimit: 10,
    entitlements: ['csvExport'],
    sort: 0,
  },
  {
    code: 'dst_clinic',
    side: 'destination',
    labelKey: 'planDstClinicName',
    blurbKey: 'planDstClinicBlurb',
    priceMonthly: { amountMinor: 19900, currency: 'USD' },
    seatLimit: 10,
    monthlyCaseLimit: 100,
    entitlements: ['csvExport', 'prioritySupport', 'auditTrailRetention'],
    sort: 1,
  },
  {
    code: 'dst_network',
    side: 'destination',
    labelKey: 'planDstNetworkName',
    blurbKey: 'planDstNetworkBlurb',
    priceMonthly: null,
    seatLimit: null,
    monthlyCaseLimit: null,
    entitlements: [
      'csvExport',
      'prioritySupport',
      'auditTrailRetention',
      'multiCorridor',
      'dedicatedOnboarding',
    ],
    sort: 2,
  },
];
```

- [ ] **Step 6: Run to verify pass, then build**

Run: `pnpm --filter @mir/contracts test -- plan && pnpm --filter @mir/contracts build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/plan.ts packages/contracts/src/plan.test.ts
git commit -m "feat(contracts): side-scope the plan catalogue

A source org submits and a destination org receives. One monthlyCaseLimit
meaning two different things is the kind of ambiguity that survives until
someone disputes an invoice."
```

---

## Task 7: Migration 0022 — side-scoped plans and the side-match trigger

**Files:**
- Create: `apps/api/migrations/0022_side_scoped_plans.up.sql`
- Create: `apps/api/migrations/0022_side_scoped_plans.down.sql`
- Modify: `apps/api/src/modules/plans/internal/plans.service.ts:30-75`
- Test: `apps/api/src/modules/plans/plans.test.ts` (create)

**Interfaces:**
- Consumes: Task 6's `PLAN_CODES` and `tiersForSide`.
- Produces: `billing_plans.side`; `billing_public_plans()` returning a `side` column; a trigger raising SQLSTATE `23514` on a cross-side subscription. `PlansService.listTiers()` returns `PlanTier[]` including `side`.

- [ ] **Step 1: Write the up migration**

Create `apps/api/migrations/0022_side_scoped_plans.up.sql`:

```sql
-- Two catalogues, one per corridor side.
--
-- A source organisation SUBMITS cases; a destination organisation RECEIVES
-- them. `code` stays the single-column primary key — codes are namespaced
-- instead — so `billing_subscriptions.plan_code` and its foreign key are
-- untouched by this migration.
--
-- ⚠ EVERY SEEDED PRICE AND LIMIT REMAINS A PLACEHOLDER, and the tier CONTENTS
-- are undecided, not merely the numbers. Nothing here is an offer.

BEGIN;

ALTER TABLE billing_plans ADD COLUMN side text;

-- No production data. The old three codes are replaced wholesale rather than
-- renamed, because a subscription pointing at 'clinic' cannot be assigned to a
-- side without guessing which one its organisation is on.
DELETE FROM billing_subscriptions;
DELETE FROM billing_plans;

ALTER TABLE billing_plans
  ALTER COLUMN side SET NOT NULL,
  ADD CONSTRAINT billing_plans_side_check CHECK (side IN ('source','destination'));

ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_code_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_code_check
  CHECK (code IN ('src_solo','src_clinic','src_network',
                  'dst_solo','dst_clinic','dst_network'));

INSERT INTO billing_plans
  (code, side, price_minor, currency, seat_limit, monthly_case_limit, entitlements, sort)
VALUES
  ('src_solo',    'source',       4900, 'USD',    1,   10, ARRAY['csvExport'], 0),
  ('src_clinic',  'source',      19900, 'USD',   10,  100,
     ARRAY['csvExport','prioritySupport','auditTrailRetention'], 1),
  ('src_network', 'source',       NULL,  NULL, NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention','multiCorridor','dedicatedOnboarding'], 2),
  ('dst_solo',    'destination',  4900, 'USD',    1,   10, ARRAY['csvExport'], 0),
  ('dst_clinic',  'destination', 19900, 'USD',   10,  100,
     ARRAY['csvExport','prioritySupport','auditTrailRetention'], 1),
  ('dst_network', 'destination',  NULL,  NULL, NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention','multiCorridor','dedicatedOnboarding'], 2);

-- ---------------------------------------------------------------------------
-- An organisation may only subscribe to a plan on its own side.
--
-- A trigger rather than a CHECK because the rule spans two tables, and in the
-- database rather than the service because every other integrity rule in this
-- schema is. A service-only check is one forgotten call site away from a
-- Libyan clinic on a Tunisian tier, which is a billing dispute nobody can
-- settle from the data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_subscription_side_matches() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_side  text;
  v_plan_side text;
BEGIN
  SELECT side INTO v_org_side  FROM identity_organisations WHERE id   = NEW.organisation_id;
  SELECT side INTO v_plan_side FROM billing_plans          WHERE code = NEW.plan_code;

  IF v_org_side IS DISTINCT FROM v_plan_side THEN
    RAISE EXCEPTION
      'organisation is on the % side and cannot subscribe to a % plan',
      v_org_side, v_plan_side
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER billing_subscriptions_side_match
  BEFORE INSERT OR UPDATE ON billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION billing_subscription_side_matches();

-- ---------------------------------------------------------------------------
-- The public catalogue read now carries the side, so /pricing can show both
-- ladders and the settings screen can show one.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS billing_public_plans();

CREATE OR REPLACE FUNCTION billing_public_plans()
RETURNS TABLE (
  code text,
  side text,
  price_minor bigint,
  currency text,
  seat_limit integer,
  monthly_case_limit integer,
  entitlements text[],
  sort integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.code, p.side, p.price_minor, p.currency, p.seat_limit,
         p.monthly_case_limit, p.entitlements, p.sort
  FROM billing_plans p
  WHERE p.active
  ORDER BY p.side, p.sort;
$$;

GRANT EXECUTE ON FUNCTION billing_public_plans() TO mir_app;

COMMIT;
```

- [ ] **Step 2: Write the down migration**

Create `apps/api/migrations/0022_side_scoped_plans.down.sql` restoring the three original codes, the original `billing_public_plans()` without `side`, and dropping the trigger and function. Note in a header comment that subscriptions are not restored.

```sql
-- Local rollback only. Subscriptions deleted by the up migration are not restored.

BEGIN;

DROP TRIGGER IF EXISTS billing_subscriptions_side_match ON billing_subscriptions;
DROP FUNCTION IF EXISTS billing_subscription_side_matches();

DELETE FROM billing_subscriptions;
DELETE FROM billing_plans;

ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_code_check;
ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_side_check;
ALTER TABLE billing_plans DROP COLUMN side;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_code_check
  CHECK (code IN ('solo','clinic','network'));

INSERT INTO billing_plans (code, price_minor, currency, seat_limit, monthly_case_limit, entitlements, sort)
VALUES
  ('solo',      4900, 'USD',    1,   10, ARRAY['csvExport'], 0),
  ('clinic',   19900, 'USD',   10,  100, ARRAY['csvExport','prioritySupport','auditTrailRetention'], 1),
  ('network',   NULL,  NULL, NULL, NULL,
     ARRAY['csvExport','prioritySupport','auditTrailRetention','multiCorridor','dedicatedOnboarding'], 2);

DROP FUNCTION IF EXISTS billing_public_plans();
CREATE OR REPLACE FUNCTION billing_public_plans()
RETURNS TABLE (
  code text, price_minor bigint, currency text, seat_limit integer,
  monthly_case_limit integer, entitlements text[], sort integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.code, p.price_minor, p.currency, p.seat_limit, p.monthly_case_limit,
         p.entitlements, p.sort
  FROM billing_plans p WHERE p.active ORDER BY p.sort;
$$;
GRANT EXECUTE ON FUNCTION billing_public_plans() TO mir_app;

COMMIT;
```

- [ ] **Step 3: Write the failing test**

Create `apps/api/src/modules/plans/plans.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tiersForSide } from '@mir/contracts';
import {
  createPractice,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';

let h: Harness;

beforeAll(async () => {
  h = await setupTestDatabase();
}, 120_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

describe('side-scoped plans', () => {
  it('the public catalogue carries a side for every tier', async () => {
    const res = await h.app.query<{ code: string; side: string }>(
      `SELECT code, side FROM billing_public_plans()`,
    );
    expect(res.rows.length).toBe(6);
    expect(res.rows.filter((r) => r.side === 'source').length).toBe(3);
    expect(res.rows.filter((r) => r.side === 'destination').length).toBe(3);
  });

  it('an organisation may subscribe to a plan on its own side', async () => {
    const { orgId } = await createPractice(h.owner, 'libya_doctor'); // source
    await h.owner.query(
      `INSERT INTO billing_subscriptions (organisation_id, plan_code, period_end)
       VALUES ($1, 'src_clinic', now() + interval '30 days')`,
      [orgId],
    );
    const res = await h.owner.query(`SELECT 1 FROM billing_subscriptions WHERE organisation_id = $1`, [orgId]);
    expect(res.rows.length).toBe(1);
  });

  it('an organisation cannot subscribe to a plan on the other side', async () => {
    const { orgId } = await createPractice(h.owner, 'libya_doctor'); // source
    await expect(
      h.owner.query(
        `INSERT INTO billing_subscriptions (organisation_id, plan_code, period_end)
         VALUES ($1, 'dst_clinic', now() + interval '30 days')`,
        [orgId],
      ),
    ).rejects.toThrow(/cannot subscribe to a destination plan/);
  });

  it('the trigger also refuses a cross-side UPDATE', async () => {
    const { orgId } = await createPractice(h.owner, 'tunisia_doctor'); // destination
    await h.owner.query(
      `INSERT INTO billing_subscriptions (organisation_id, plan_code, period_end)
       VALUES ($1, 'dst_solo', now() + interval '30 days')`,
      [orgId],
    );
    await expect(
      h.owner.query(`UPDATE billing_subscriptions SET plan_code = 'src_solo' WHERE organisation_id = $1`, [orgId]),
    ).rejects.toThrow(/cannot subscribe to a source plan/);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm db:clean && pnpm --filter @mir/api test -- plans`
Expected: FAIL — `column "side" does not exist`.

- [ ] **Step 5: Update `PlansService` to read the new column**

In `plans.service.ts`, add `side: string;` to `DbPlan`. In `toTier`, parse it and include it:

```typescript
  const side = endpointSideSchema.safeParse(row.side);
  if (!side.success) return null;
```

and add `side: side.data,` to the returned object. Update `labelKeys` so the dictionary key matches the namespaced code:

```typescript
/** Dictionary keys, derived from the code — copy never lives in the database (§4.2). */
function labelKeys(code: PlanCode): { labelKey: string; blurbKey: string } {
  // 'src_clinic' -> 'SrcClinic'
  const camel = code
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return { labelKey: `plan${camel}Name`, blurbKey: `plan${camel}Blurb` };
}
```

Add `side` to every `SELECT` in the service that reads `billing_plans`.

- [ ] **Step 6: Document the deliberate non-enforcement**

Add to the `PlansService` class doc comment in `plans.service.ts`:

```typescript
 * NOTHING HERE ENFORCES A LIMIT, AND THAT IS A DECISION.
 *
 * `seat_limit` and `monthly_case_limit` are ops-editable data and the settings
 * screen renders them as meters, but no guard refuses an invitation or a case
 * submission on either. The commercial terms — what each tier actually
 * includes — are not settled, and gating on invented limits would refuse real
 * clinical work on a number nobody agreed to.
 *
 * When the terms are settled, enforcement attaches here and in
 * OrganisationsService.invite, using `withinLimit` from the contract. That is
 * a service change, not a migration: the limits are already in the database.
 *
 * This comment exists so the absence of a check reads as intent rather than
 * as something a reviewer forgot.
```

- [ ] **Step 7: Run to verify pass**

Run: `pnpm --filter @mir/api test -- plans`
Expected: PASS.

- [ ] **Step 8: Apply locally and commit**

```bash
pnpm --filter @mir/api migrate:up
git add apps/api/migrations/0022_side_scoped_plans.up.sql \
        apps/api/migrations/0022_side_scoped_plans.down.sql \
        apps/api/src/modules/plans
git commit -m "feat(db): side-scope the plan catalogue with a database-enforced side match

A service-only check is one forgotten call site away from a Libyan clinic
on a Tunisian tier."
```

---

## Task 8: Ledger entry kinds in the contract

**Files:**
- Modify: `packages/contracts/src/ledger.ts:85-90`
- Test: `packages/contracts/src/ledger.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LEDGER_ENTRY_KINDS = ['coordination_fee','saas_subscription'] as const` and `ledgerEntryKindSchema`. Task 9's migration CHECK constraint and Task 10's service both reference this set.

- [ ] **Step 1: Write the failing test**

Add to `packages/contracts/src/ledger.test.ts`:

```typescript
describe('ledger entry kinds', () => {
  it('exposes the closed set the database CHECK mirrors', () => {
    expect(LEDGER_ENTRY_KINDS).toEqual(['coordination_fee', 'saas_subscription']);
  });

  it('rejects a kind outside the set', () => {
    expect(ledgerEntryKindSchema.safeParse('overage').success).toBe(false);
  });

  it('summariseLedger still produces no total across kinds', () => {
    const summary = summariseLedger([]);
    expect(summary).not.toHaveProperty('total');
    expect(Object.keys(summary.outstanding).sort()).toEqual([
      'coordination_fee',
      'saas_subscription',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @mir/contracts test -- ledger`
Expected: FAIL — `LEDGER_ENTRY_KINDS` is not exported.

- [ ] **Step 3: Add the exports**

In `ledger.ts`, above `ledgerEntrySchema`:

```typescript
/**
 * The closed set of entry kinds, mirrored by the `billing_ledger_entries`
 * CHECK constraint (migration 0023).
 *
 * The two kinds share a table but must never share a total: §5.7 P0 forbids
 * merging coordination fees with subscription charges into one "amount owed".
 * `LedgerSummary` has no total field, and nothing here should learn how to
 * make one.
 */
export const LEDGER_ENTRY_KINDS = ['coordination_fee', 'saas_subscription'] as const;
export const ledgerEntryKindSchema = z.enum(LEDGER_ENTRY_KINDS);
export type LedgerEntryKind = z.infer<typeof ledgerEntryKindSchema>;
```

- [ ] **Step 4: Run to verify pass, then build**

Run: `pnpm --filter @mir/contracts test -- ledger && pnpm --filter @mir/contracts build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/ledger.ts packages/contracts/src/ledger.test.ts
git commit -m "feat(contracts): export the closed ledger entry kind set"
```

---

## Task 9: Migration 0023 — fee schedule, ledger entries, and the appointment status machine

**Files:**
- Create: `apps/api/migrations/0023_ledger_and_fees.up.sql`
- Create: `apps/api/migrations/0023_ledger_and_fees.down.sql`
- Test: `apps/api/src/modules/ledger/ledger.test.ts` (created in Task 10)

**Interfaces:**
- Consumes: Task 8's `LEDGER_ENTRY_KINDS`; Task 2's schema.
- Produces: `billing_fee_schedule (corridor_id, side, amount_minor, currency, active)`; `billing_ledger_entries (id, organisation_id, kind, appointment_id, amount_minor, currency, status, occurred_at)`; `scheduling_appointments.status IN ('pending','confirmed','declined','cancelled','completed')` defaulting to `'pending'`. Task 10's service depends on all three.

- [ ] **Step 1: Write the up migration**

Create `apps/api/migrations/0023_ledger_and_fees.up.sql`:

```sql
-- The ledger's first real persistence, and the end of the patient's card.
--
-- ⚠ NOTHING HERE TAKES MONEY. Blocking item L7 is unresolved: whether a Libyan
-- payer can lawfully and practically pay a Tunisian-facing platform, and in
-- which jurisdiction the receiving entity must be incorporated. Migrations 0007
-- and 0011 make the same commitment. `status` is modelled so that wiring a rail
-- later is a service change rather than a migration against live entries.
--
-- THE TWO KINDS SHARE A TABLE AND MUST NEVER SHARE A TOTAL. §5.7 P0 forbids
-- merging coordination fees with subscription charges into one ambiguous
-- "amount owed". There is no total column here, and no view or endpoint may
-- produce one. Storing both kinds in one table is a storage decision, not
-- permission to sum them.

BEGIN;

-- ---------------------------------------------------------------------------
-- What each side owes per referral, per corridor.
--
-- A table rather than a constant: ops changes rates, and a rate change must not
-- be a deploy — the same reasoning that made the plan catalogue a table. A
-- 60/40 split is two rows, not a branch in code.
--
-- `corridor_id` is opaque text with no foreign key, matching
-- identity_organisations: corridors are application configuration
-- (lib/corridor/registry.ts), and a foreign key would move that into a
-- migration (§4.3).
-- ---------------------------------------------------------------------------
CREATE TABLE billing_fee_schedule (
  corridor_id   text NOT NULL,
  side          text NOT NULL CHECK (side IN ('source','destination')),
  amount_minor  bigint NOT NULL CHECK (amount_minor >= 0),
  currency      text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  active        boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corridor_id, side)
);

-- ⚠ PLACEHOLDER RATES, like every other figure in this system.
INSERT INTO billing_fee_schedule (corridor_id, side, amount_minor, currency) VALUES
  ('ly-tn', 'source',      3000, 'USD'),
  ('ly-tn', 'destination', 2000, 'USD');

-- ---------------------------------------------------------------------------
-- What an organisation owes.
--
-- `appointment_id` and not `case_id`: `Case` is a contract-level concept with
-- no table (packages/contracts/src/case.ts), and the durable row both accrual
-- moments already turn on is the appointment — it carries the assignment, the
-- patient, its linked studies, and the status the accept/decline flow drives.
-- ---------------------------------------------------------------------------
CREATE TABLE billing_ledger_entries (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  organisation_id  uuid NOT NULL REFERENCES identity_organisations(id),
  kind             text NOT NULL CHECK (kind IN ('coordination_fee','saas_subscription')),
  appointment_id   uuid REFERENCES scheduling_appointments(id),
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
  currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','overdue')),
  occurred_at      timestamptz NOT NULL DEFAULT now(),

  -- A subscription charge has no referral; a coordination fee must have one.
  CONSTRAINT ledger_fee_has_appointment CHECK (
    (kind = 'coordination_fee' AND appointment_id IS NOT NULL)
    OR (kind = 'saas_subscription' AND appointment_id IS NULL)
  )
);

CREATE INDEX billing_ledger_entries_org_idx ON billing_ledger_entries (organisation_id, occurred_at DESC);

-- One fee per organisation per referral. A partial unique index makes
-- double-accrual UNREPRESENTABLE rather than merely unlikely — a retried
-- request must not bill a clinic twice for one referral.
CREATE UNIQUE INDEX billing_ledger_one_fee_per_org_per_appointment
  ON billing_ledger_entries (appointment_id, organisation_id)
  WHERE kind = 'coordination_fee';

ALTER TABLE billing_fee_schedule     ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_fee_schedule     FORCE  ROW LEVEL SECURITY;
ALTER TABLE billing_ledger_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledger_entries   FORCE  ROW LEVEL SECURITY;

-- The rate card is readable by any authenticated caller: a clinic is entitled
-- to know what a referral costs it before making one.
CREATE POLICY fee_schedule_readable ON billing_fee_schedule FOR SELECT
  USING (app_current_role() IS NOT NULL);

CREATE POLICY ledger_entries_member ON billing_ledger_entries FOR SELECT
  USING (app_member_of(organisation_id));

CREATE POLICY ledger_entries_ops ON billing_ledger_entries FOR SELECT
  USING (app_current_role() = 'admin');

-- Accrual runs in a system context, which supplies an explicit 'admin' role
-- rather than querying with no identity at all — the same pattern
-- BillingService.handleWebhook used for Stripe callbacks.
CREATE POLICY ledger_entries_system_insert ON billing_ledger_entries FOR INSERT
  WITH CHECK (app_current_role() = 'admin');

CREATE POLICY ledger_entries_system_update ON billing_ledger_entries FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

GRANT SELECT ON billing_fee_schedule TO mir_app;
GRANT SELECT, INSERT, UPDATE ON billing_ledger_entries TO mir_app;

-- ---------------------------------------------------------------------------
-- The patient's card is gone.
--
-- billing_payments is keyed to patients_patients and gated on
-- app_current_role() = 'patient'. There is no patient, so there is no payer and
-- no rail. payment-rail.ts is kept in the codebase as an unwired seam: org-side
-- collection will need one when L7 resolves, and the interface is the part
-- worth preserving.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS billing_webhook_events;
DROP TABLE IF EXISTS billing_payments;

-- ---------------------------------------------------------------------------
-- The appointment status machine.
--
-- 'pending_payment' and 'authorised' are artefacts of DECISION D2 — "authorise
-- at booking, capture on the doctor's acceptance" — against the patient's card.
-- With no card, an appointment can never enter either, and leaving them in the
-- CHECK would leave two unreachable states every reader has to rule out.
--
-- 'declined' is distinct from 'cancelled' and must stay distinct: declined is
-- the receiving doctor refusing, cancelled is the referring side withdrawing.
-- They mean different things to the referring clinic and they accrue
-- differently.
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_appointments DROP CONSTRAINT IF EXISTS scheduling_appointments_status_check;

UPDATE scheduling_appointments
   SET status = 'pending'
 WHERE status IN ('pending_payment', 'authorised');

ALTER TABLE scheduling_appointments
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD CONSTRAINT scheduling_appointments_status_check
    CHECK (status IN ('pending','confirmed','declined','cancelled','completed'));

-- A declined slot must be bookable again, so the double-booking exclusion has
-- to ignore it as well as 'cancelled'. The constraint is dropped and recreated
-- because its WHERE clause cannot be altered in place.
ALTER TABLE scheduling_appointments
  DROP CONSTRAINT IF EXISTS scheduling_appointments_doctor_id_tstzrange_excl;

ALTER TABLE scheduling_appointments
  ADD CONSTRAINT scheduling_appointments_doctor_id_tstzrange_excl
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'declined'));

COMMIT;
```

**Note for the implementer:** the exclusion constraint's generated name may differ. Find it first with:

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'scheduling_appointments'::regclass AND contype = 'x';
```

and use the name it returns in the `DROP CONSTRAINT` above.

- [ ] **Step 2: Write the down migration**

Create `apps/api/migrations/0023_ledger_and_fees.down.sql` that drops the two new tables, restores `billing_payments` and `billing_webhook_events` exactly as `0007_billing.up.sql` defines them (copy the `CREATE TABLE`, index, and policy statements verbatim, minus the two `payments_patient*` policies that `0021` already dropped), and restores the old status CHECK and default. Header comment: local rollback only; deleted payment rows are not restored.

- [ ] **Step 3: Update the harness's status union**

`createAppointment` in `apps/api/src/shared/db/testing/rls-harness.ts:374-378` types `status` as `'pending_payment' | 'authorised' | 'confirmed' | 'cancelled' | 'completed'`. Two of those states no longer exist. Change it to:

```typescript
export async function createAppointment(
  owner: Pool,
  patientId: string,
  doctorId: string,
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed' = 'confirmed',
  startsAt: Date = new Date(Date.now() + 86_400_000),
): Promise<string> {
```

The body is unchanged. Task 10's tests pass `'pending'` and will not typecheck until this is done.

- [ ] **Step 4: Remove the payment paths from BillingService**

`billing.service.ts` queries `billing_payments` at lines 101, 113, 141, 201, 223, 241, 312, 363, 389 and `billing_webhook_events` at 288 and 415. Those tables no longer exist, so this is not optional cleanup — the module will fail at runtime and `billing.test.ts` will fail at once.

Delete `authoriseAppointment`, `statusForAppointment`, `captureForAppointment`, and `handleWebhook` from `billing.service.ts`, together with the Stripe wiring that calls into `payment-rail.ts`. Delete the corresponding handlers from `billing.controller.ts` (`POST /appointments/:id/payment`, `GET /appointments/:id/payment`, the capture handler, and the webhook handler). Delete `billing.test.ts`'s payment suites.

Keep `payment-rail.ts` in the tree, unimported, with this header added:

```typescript
/**
 * UNWIRED ON PURPOSE.
 *
 * The patient's card was the only payer, and migration 0023 removed it with
 * the patient role. Organisation-side collection will need a rail when
 * blocking item L7 resolves — whether a Libyan payer can lawfully pay a
 * Tunisian-facing platform, and where the receiving entity must be
 * incorporated. The INTERFACE is the part worth keeping; the Stripe
 * authorise/capture flow that used it is gone.
 *
 * `pnpm scan:unwired` will report this file. That is correct and expected:
 * it is a review aid, not a gate, and this entry is the answer to the
 * question it asks.
 */
```

If `BillingModule` ends up with no controller and no provider, delete the module and remove it from `app.module.ts` rather than leaving an empty shell.

- [ ] **Step 5: Run the migration against the test template**

Run: `pnpm db:clean && pnpm --filter @mir/api test`
Expected: PASS. The existing RLS suite must survive the status-machine change; update any test asserting on `'pending_payment'` or `'authorised'` to `'pending'`.

- [ ] **Step 6: Apply locally**

Run: `pnpm --filter @mir/api migrate:up`
Expected: `0023_ledger_and_fees` applied.

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations/0023_ledger_and_fees.up.sql \
        apps/api/migrations/0023_ledger_and_fees.down.sql \
        apps/api/src
git commit -m "feat(db): ledger persistence, split coordination fees, drop the patient card

The two entry kinds share a table and must never share a total. The
appointment status machine loses pending_payment and authorised, which
only ever meant something against the patient's card."
```

---

## Task 10: The ledger module — accrual and reads

**Files:**
- Create: `apps/api/src/modules/ledger/ledger.module.ts`
- Create: `apps/api/src/modules/ledger/index.ts`
- Create: `apps/api/src/modules/ledger/internal/ledger.service.ts`
- Create: `apps/api/src/modules/ledger/internal/ledger.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modules/scheduling/internal/scheduling.service.ts`
- Test: `apps/api/src/modules/ledger/ledger.test.ts`

**Interfaces:**
- Consumes: Task 8's `LEDGER_ENTRY_KINDS`; Task 9's tables.
- Produces:
  - `LedgerService.accrueCoordinationFee(appointmentId: string, side: EndpointSide): Promise<string | null>` — returns the new entry id, or `null` when no active rate exists.
  - `LedgerService.listForOrganisation(organisationId: string): Promise<LedgerEntry[]>`
  - `GET /ledger` → `{ entries: LedgerEntry[] }`, guarded `@RequiresRole('libya_doctor','tunisia_doctor','admin')`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/ledger/ledger.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createAppointment,
  createPatient,
  createPractice,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { LedgerService } from './internal/ledger.service';

let h: Harness;
let db: DatabaseService;
let ledger: LedgerService;

const sys = (userId: string): RequestContext => ({
  userId,
  role: 'admin',
  triageBeforePayment: false,
  ipAddress: '41.208.1.5',
  userAgent: 'test',
  requestId: 'req-ledger-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);
  ledger = new LedgerService(db);
}, 120_000);

afterAll(async () => {
  await h?.close();
  await db?.onModuleDestroy();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

describe('coordination fee accrual', () => {
  it('accrues one source entry and one destination entry at the corridor rates', async () => {
    const src = await createPractice(h.owner, 'libya_doctor');
    const dst = await createPractice(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, src.doctorId);
    const appt = await createAppointment(h.owner, patient, dst.doctorId, 'pending');

    await runWithContext(sys(src.doctorId), async () => {
      await ledger.accrueCoordinationFee(appt, 'source');
      await ledger.accrueCoordinationFee(appt, 'destination');
    });

    const rows = await h.owner.query<{ organisation_id: string; amount_minor: string }>(
      `SELECT organisation_id, amount_minor FROM billing_ledger_entries
       WHERE appointment_id = $1 ORDER BY amount_minor DESC`,
      [appt],
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows[0]?.organisation_id).toBe(src.orgId);
    expect(rows.rows[0]?.amount_minor).toBe('3000');
    expect(rows.rows[1]?.organisation_id).toBe(dst.orgId);
    expect(rows.rows[1]?.amount_minor).toBe('2000');
  });

  it('does not double-accrue when the same side is accrued twice', async () => {
    const src = await createPractice(h.owner, 'libya_doctor');
    const dst = await createPractice(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, src.doctorId);
    const appt = await createAppointment(h.owner, patient, dst.doctorId, 'pending');

    await runWithContext(sys(src.doctorId), async () => {
      await ledger.accrueCoordinationFee(appt, 'source');
      await ledger.accrueCoordinationFee(appt, 'source');
    });

    const rows = await h.owner.query(
      `SELECT id FROM billing_ledger_entries WHERE appointment_id = $1`,
      [appt],
    );
    expect(rows.rows.length).toBe(1);
  });

  it('accrues nothing and does not throw when the corridor has no active rate', async () => {
    await h.owner.query(`UPDATE billing_fee_schedule SET active = false`);

    const src = await createPractice(h.owner, 'libya_doctor');
    const dst = await createPractice(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, src.doctorId);
    const appt = await createAppointment(h.owner, patient, dst.doctorId, 'pending');

    const id = await runWithContext(sys(src.doctorId), () =>
      ledger.accrueCoordinationFee(appt, 'source'),
    );

    // A missing rate must not invent a charge, and must not block a referral.
    expect(id).toBeNull();
    const rows = await h.owner.query(
      `SELECT id FROM billing_ledger_entries WHERE appointment_id = $1`,
      [appt],
    );
    expect(rows.rows).toEqual([]);
  });

  it('an organisation reads its own entries and no other organisation\'s', async () => {
    const src = await createPractice(h.owner, 'libya_doctor');
    const dst = await createPractice(h.owner, 'tunisia_doctor');
    const patient = await createPatient(h.owner, src.doctorId);
    const appt = await createAppointment(h.owner, patient, dst.doctorId, 'pending');

    await runWithContext(sys(src.doctorId), async () => {
      await ledger.accrueCoordinationFee(appt, 'source');
      await ledger.accrueCoordinationFee(appt, 'destination');
    });

    const mine = await runWithContext(
      { ...sys(src.doctorId), role: 'libya_doctor' },
      () => ledger.listForOrganisation(src.orgId),
    );
    expect(mine.length).toBe(1);

    const theirs = await runWithContext(
      { ...sys(src.doctorId), role: 'libya_doctor' },
      () => ledger.listForOrganisation(dst.orgId),
    );
    expect(theirs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @mir/api test -- ledger`
Expected: FAIL — cannot resolve `./internal/ledger.service`.

- [ ] **Step 3: Write the service**

Create `apps/api/src/modules/ledger/internal/ledger.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import {
  currencySchema,
  ledgerEntryKindSchema,
  type EndpointSide,
  type LedgerEntry,
} from '@mir/contracts';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';

/**
 * The provider ledger — brief §5.7.
 *
 * NOTHING HERE TAKES MONEY. Blocking item L7 is unresolved. An entry records
 * what is OWED; there is no rail, no provider id, and no card.
 *
 * NOTHING HERE PRODUCES A TOTAL. §5.7 P0 forbids merging coordination fees with
 * subscription charges into one ambiguous "amount owed". This service returns
 * entries; `summariseLedger` in the contract totals them per kind and per
 * currency, and there is deliberately no method here that sums across `kind`.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Accrue one side's coordination fee for a referral.
   *
   * Returns the new entry's id, or `null` when the corridor has no active rate
   * for that side. A missing rate must not invent a charge and must not block a
   * referral — a clinical hand-off does not wait on a billing configuration.
   *
   * `ON CONFLICT DO NOTHING` leans on the partial unique index rather than
   * checking first: a read-then-write would still race, and billing a clinic
   * twice for one referral is exactly the kind of thing that must be impossible
   * rather than unlikely.
   */
  async accrueCoordinationFee(appointmentId: string, side: EndpointSide): Promise<string | null> {
    return this.db.tx(async (tx) => {
      const org = await tx.query<{ id: string; corridor_id: string }>(
        `SELECT o.id, o.corridor_id
           FROM scheduling_appointments a
           JOIN patients_patients p ON p.id = a.patient_id
           JOIN identity_memberships m
             ON m.user_id = CASE WHEN $2 = 'source' THEN p.created_by_doctor ELSE a.doctor_id END
           JOIN identity_organisations o
             ON o.id = m.organisation_id AND o.side = $2
          WHERE a.id = $1
          LIMIT 1`,
        [appointmentId, side],
      );
      const organisation = org.rows[0];
      if (organisation === undefined) return null;

      const rate = await tx.query<{ amount_minor: string; currency: string }>(
        `SELECT amount_minor, currency FROM billing_fee_schedule
          WHERE corridor_id = $1 AND side = $2 AND active`,
        [organisation.corridor_id, side],
      );
      const row = rate.rows[0];
      if (row === undefined) return null;

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO billing_ledger_entries
           (organisation_id, kind, appointment_id, amount_minor, currency)
         VALUES ($1, 'coordination_fee', $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [organisation.id, appointmentId, row.amount_minor, row.currency],
      );
      return inserted.rows[0]?.id ?? null;
    });
  }

  /** The organisation's entries, newest first. RLS decides what comes back. */
  async listForOrganisation(organisationId: string): Promise<LedgerEntry[]> {
    requireContext();
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        kind: string;
        amount_minor: string;
        currency: string;
        status: string;
        occurred_at: Date;
      }>(
        `SELECT id, kind, amount_minor, currency, status, occurred_at
           FROM billing_ledger_entries
          WHERE organisation_id = $1
          ORDER BY occurred_at DESC`,
        [organisationId],
      );

      return res.rows.flatMap((r) => {
        const kind = ledgerEntryKindSchema.safeParse(r.kind);
        const currency = currencySchema.safeParse(r.currency);
        if (!kind.success || !currency.success) return [];
        return [
          {
            id: r.id,
            kind: kind.data,
            amount: { amountMinor: Number(r.amount_minor), currency: currency.data },
            status: r.status,
            occurredAt: r.occurred_at.toISOString(),
          } as LedgerEntry,
        ];
      });
    });
  }
}
```

**Implementer note:** the object literal above must match `ledgerEntrySchema`'s actual field names in `packages/contracts/src/ledger.ts:65-83`. Read that file and adjust the property names to match exactly rather than assuming; the `as LedgerEntry` cast will otherwise hide a mismatch.

- [ ] **Step 4: Write the controller and module**

`apps/api/src/modules/ledger/internal/ledger.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { LedgerEntry } from '@mir/contracts';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { LedgerService } from './ledger.service';

const querySchema = z.object({ organisationId: z.string().uuid() });

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * There is no endpoint that totals across entry kinds, and there must not be
   * one (§5.7 P0). The screen groups by kind; the API returns rows.
   */
  @RequiresRole('libya_doctor', 'tunisia_doctor', 'admin')
  @Get()
  async list(@Query() query: unknown): Promise<{ entries: LedgerEntry[] }> {
    const { organisationId } = querySchema.parse(query);
    return { entries: await this.ledger.listForOrganisation(organisationId) };
  }
}
```

`apps/api/src/modules/ledger/ledger.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { LedgerController } from './internal/ledger.controller';
import { LedgerService } from './internal/ledger.service';

@Module({
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
```

`apps/api/src/modules/ledger/index.ts`:

```typescript
export { LedgerModule } from './ledger.module';
export { LedgerService } from './internal/ledger.service';
```

Follow the existing module convention exactly — check `apps/api/src/modules/plans/index.ts` and match it, because `.dependency-cruiser.cjs` enforces that nothing imports across an `internal/` boundary.

- [ ] **Step 5: Register the module and wire the accrual**

Add `LedgerModule` to `app.module.ts`'s imports. In `scheduling.service.ts`:

- After a successful `book(...)`, call `await this.ledger.accrueCoordinationFee(appointment.id, 'source')`.
- In the accept path (where status becomes `'confirmed'`), call `await this.ledger.accrueCoordinationFee(appointmentId, 'destination')`.
- Do **not** accrue in the decline path.

Inject `LedgerService` into `SchedulingService`'s constructor and add `LedgerModule` to `SchedulingModule`'s imports.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @mir/api test -- ledger`
Expected: PASS.

- [ ] **Step 7: Run the boundary check**

Run: `pnpm boundaries && pnpm boundaries:verify`
Expected: PASS — no cross-module `internal/` import.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ledger apps/api/src/app.module.ts apps/api/src/modules/scheduling
git commit -m "feat(ledger): persist split coordination fees on assign and accept

A missing rate accrues nothing and blocks nothing: a clinical hand-off
does not wait on a billing configuration."
```

---

## Task 11: Web — two pricing ladders, the real ledger, and the consent step

**Files:**
- Modify: `apps/web/app/pricing/page.tsx`
- Modify: `apps/web/app/ledger/page.tsx:16` (drop `casesApi` from `lib/api/mock`)
- Modify: `apps/web/app/settings/billing/page.tsx`
- Modify: `apps/web/app/cases/new/page.tsx`
- Modify: `apps/web/lib/i18n/dictionary.ts`
- Modify: `apps/web/lib/api/endpoints.ts`

**Interfaces:**
- Consumes: Task 6's `tiersForSide`; Task 10's `GET /ledger`.
- Produces: no new exports.

- [ ] **Step 1: Add the dictionary keys**

In `apps/web/lib/i18n/dictionary.ts`, replace the three `planSolo*`/`planClinic*`/`planNetwork*` key pairs with the six from Task 6 (`planSrcSoloName`, `planSrcSoloBlurb`, `planSrcClinicName`, …, `planDstNetworkBlurb`) in every locale. Add:

- `pricingSideSource`, `pricingSideDestination` — the two tab labels.
- `consentAttestLabel` — the doctor's attestation checkbox.
- `consentDocumentLabel` — the signed-form upload field.

Keep the existing `TODO(pricing)` marker on the plan keys.

- [ ] **Step 2: Two tabs on the pricing page**

In `app/pricing/page.tsx`, add a `useState<EndpointSide>('source')`, render two tab buttons from `pricingSideSource`/`pricingSideDestination`, and pass `tiersForSide(tiers, side)` to the existing tier grid instead of `tiers`. The placeholder notice at the top stays exactly where it is.

- [ ] **Step 3: One ladder in billing settings**

In `app/settings/billing/page.tsx`, derive the side from the current provider (`useCurrentProvider()` already exposes it) and render `tiersForSide(tiers, provider.side)`. An organisation must never be shown a tier it cannot subscribe to — the trigger from Task 7 would refuse it, and an affordance for an action the user cannot take violates §4.4.

- [ ] **Step 4: Real ledger data**

In `app/ledger/page.tsx`, replace the `casesApi` import and its call with the real endpoint added to `lib/api/endpoints.ts`:

```typescript
  ledger: {
    list: (organisationId: string): Promise<{ entries: LedgerEntry[] }> =>
      request(`/ledger?organisationId=${encodeURIComponent(organisationId)}`),
  },
```

Match the existing `request` helper's signature in that file. The page's two-table structure and its absence of a grand total do not change.

- [ ] **Step 5: The consent step in case submission**

In `app/cases/new/page.tsx`, add before the submit action:

- a file input for the signed consent form, labelled `consentDocumentLabel`;
- a checkbox labelled `consentAttestLabel`.

Submit is disabled until both are present. On submit, upload the document through the existing upload path, then `POST /consent` with the shape from Task 4 before creating the case. If the consent call fails, do not create the case.

- [ ] **Step 6: Typecheck, lint, test**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web lint && pnpm --filter @mir/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): two pricing ladders, real ledger data, doctor consent step"
```

---

## Task 12: Rename the triage flag away from payment

**Files:**
- Modify: `apps/api/migrations/0024_rename_triage_flag.{up,down}.sql` (create)
- Modify: `apps/api/src/shared/config/config.schema.ts`
- Modify: `apps/api/src/shared/auth/auth.guard.ts:89`
- Modify: `apps/api/src/shared/context/request-context.ts:32,118`
- Modify: `apps/api/src/shared/db/database.service.ts:87-88`
- Modify: `apps/api/src/shared/db/testing/rls-harness.ts:246-252,280-284`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Task 9's status machine.
- Produces: `app_triage_before_confirmation()`; `RequestContext.triageBeforeConfirmation`; config key `SCHEDULING_TRIAGE_BEFORE_CONFIRMATION`.

**Beyond the spec's migration list.** The spec names `0021`–`0023`. This fourth migration was found while planning Task 9 and follows directly from it: removing payment leaves an access predicate named after payment.

**Why this task exists:** `app_triage_before_payment()` gates the receiving doctor's imaging access on `a.status IN ('confirmed','completed')` (`0002_rls.up.sql:180`). There is no payment any more. A predicate named after a concept the system no longer has is how the next reader forms a wrong model of the access rules — and this one guards imaging.

- [ ] **Step 1: Write the migration**

`apps/api/migrations/0024_rename_triage_flag.up.sql`:

```sql
-- DECISION D3's flag, renamed to say what it now gates.
--
-- There is no payment (0023 dropped the patient's card), so "triage before
-- payment" names a moment that cannot occur. The gate it actually applies is
-- the receiving doctor's confirmation, which is what 0002_rls.up.sql:180
-- has always tested. A predicate named after a concept the system does not
-- have is how the next reader forms a wrong model of an access rule.

BEGIN;

CREATE OR REPLACE FUNCTION app_triage_before_confirmation() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.triage_before_confirmation', true), '')::boolean, false);
$$;

GRANT EXECUTE ON FUNCTION app_triage_before_confirmation() TO mir_app;

CREATE OR REPLACE FUNCTION app_can_see_study_for_appointment(p_study uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM scheduling_appointment_studies sas
      JOIN scheduling_appointments a ON a.id = sas.appointment_id
     WHERE sas.study_id = p_study
       AND a.doctor_id = app_current_user_id()
       AND (app_triage_before_confirmation() OR a.status IN ('confirmed', 'completed'))
  );
$$;

DROP FUNCTION IF EXISTS app_triage_before_payment();

COMMIT;
```

**Implementer note:** `0002_rls.up.sql:170-186` defines the function that contains the `app_triage_before_payment()` call. Read it first and reproduce it verbatim in the block above, changing only the predicate name — the body shown here is illustrative and its name may differ.

- [ ] **Step 2: Write the down migration**

Mirror image: recreate `app_triage_before_payment()` reading `app.triage_before_payment`, restore the original function body, drop the new predicate.

- [ ] **Step 3: Rename through the TypeScript**

Rename `triageBeforePayment` → `triageBeforeConfirmation` in `request-context.ts`, `database.service.ts` (including the `set_config` key, which becomes `app.triage_before_confirmation`), `auth.guard.ts`, `rls-harness.ts`, and every call site the compiler flags. Rename `SCHEDULING_TRIAGE_BEFORE_PAYMENT` → `SCHEDULING_TRIAGE_BEFORE_CONFIRMATION` in `config.schema.ts` and `.env.example`.

- [ ] **Step 4: Verify**

Run: `pnpm db:clean && pnpm --filter @mir/api typecheck && pnpm --filter @mir/api test`
Expected: PASS.

Run: `grep -rn "triage_before_payment\|triageBeforePayment\|TRIAGE_BEFORE_PAYMENT" apps packages --include=*.ts --include=*.sql --include=*.mjs | grep -v "0002_rls\|0024_rename"`
Expected: no output. Hits in `0002_rls.up.sql` and `0024_rename_triage_flag.down.sql` are the historical record and stay.

- [ ] **Step 5: Commit**

```bash
git add apps packages .env.example
git commit -m "refactor: rename the triage flag from payment to confirmation

There is no payment. A predicate named after a concept the system does
not have is how the next reader forms a wrong model of an access rule."
```

---

## Task 13: Full verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Clean the test databases**

Run: `pnpm db:clean`

- [ ] **Step 2: Run the full pipeline**

Run: `pnpm verify`

This runs, in order: `check:synthetic`, `typecheck`, `lint`, `boundaries`, `boundaries:verify`, `test`, `build`, `check:bundle`. Expected: PASS at every stage.

- [ ] **Step 3: Confirm the patient role is gone everywhere**

Run:

```bash
grep -rn "'patient'" apps/api/src apps/web/app apps/web/lib apps/web/components packages/contracts/src \
  --include=*.ts --include=*.tsx | grep -v "\.test\.ts"
```

Expected: no output. Any hit is either a missed call site or a deliberate historical comment — if the latter, it belongs in a migration file, not in application code.

Run:

```bash
grep -rln "'patient'" apps/api/migrations/*.up.sql
```

Expected: only `0001_init.up.sql`, `0002_rls.up.sql`, `0004_claim_tokens.up.sql`, `0007_billing.up.sql`, and the `.down.sql` files — the historical record, which is correct. `0021` onward must not name it except in comments.

- [ ] **Step 4: Confirm no total spans both ledger kinds**

Run:

```bash
grep -rn "SUM(amount_minor)\|sum(amount_minor)" apps/api/src apps/api/migrations
```

Expected: no output, or only sums that are grouped by `kind`. A sum across kinds violates §5.7 P0.

- [ ] **Step 5: Check the gate accounting**

Run: `pnpm verify:gates`
Expected: the same open gates as before this work, plus no new ones. If a gate that was closed is now open, fix it before finishing.

- [ ] **Step 6: Run the migrations down and up once**

Run: `pnpm --filter @mir/api migrate:down` four times, then `pnpm --filter @mir/api migrate:up`.
Expected: clean in both directions. A down migration that fails is a down migration nobody can use in an incident.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "chore: full verification pass"
```
