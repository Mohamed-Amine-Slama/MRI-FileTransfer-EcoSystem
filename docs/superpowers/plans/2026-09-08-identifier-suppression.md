# Identifier Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it true that a Tunisian doctor never receives a patient identifier — at the database, the application and the imaging layers — by removing the doctor's grant on the patient table and serving imaging from a de-identified twin.

**Architecture:** Two independent movements. The database side removes the doctor's `SELECT` on `patients_patients` entirely and replaces it with a security-definer projection returning age and sex; because RLS filters rows inside a `LEFT JOIN`, this makes the existing case query return a null name with no application change. The imaging side builds an anonymised twin study in Orthanc at ingest, gates doctor visibility on `imaging_studies.status = 'ready'`, and points every destination-side DICOMweb route at twin UIDs.

**Tech Stack:** NestJS, PostgreSQL 16 (RLS + security-definer functions), raw SQL migrations, Orthanc (DICOMweb + anonymisation), BullMQ on Redis, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-identifier-suppression-design.md`

## Global Constraints

- All timestamps `timestamptz` in UTC. All IDs UUIDv7.
- Every RLS assertion runs on the `mir_app` pool via `asUser`, never the owner pool — an assertion made as owner passes regardless of policy.
- Security-definer functions carry `SET search_path = public, pg_temp` and are `STABLE`.
- Migrations come in `NNNN_name.up.sql` / `NNNN_name.down.sql` pairs. Next free number is **0028**.
- Errors never distinguish "does not exist" from "not yours": return 404, never 403.
- Every endpoint declares its role with `@RequiresRole`; a missing declaration fails the route-access audit test.
- No module imports another module's `internal/`.
- Age cap is `90`. A patient of 91 or older reports `90`.
- Quarantine modalities, verbatim: `US`, `XC`, `OT`, `SC`.
- Twin reap window: config key `IMAGING_TWIN_RETENTION_DAYS`, default `90`.
- Run tests with `pnpm --filter @mir/api test`. RLS tests need Postgres on `127.0.0.1:5433`.

## Prerequisite

The local Postgres accepts TCP but terminates every connection, so the RLS suite currently reports "0 run". Before Task 1: restart Docker Desktop, `docker compose up -d postgres`, then `pnpm db:clean`. Verify with `pnpm --filter @mir/api test rls` — it must report 23 passing, not 23 skipped. **Do not start Task 1 against a skipping suite: every test in Phase A would appear to pass without executing.**

## A note on existing local data

Task 4 adds `twin_study_uid` as a nullable column, and Task 8 resolves the
doctor's requests through it. Studies already sitting in a long-lived local dev
database will have `status = 'ready'` and a NULL twin, so a doctor will see them
listed and then get a 404 opening one. That is not a bug to chase: run
`pnpm db:clean` and re-seed. No production data exists and ADR-7 keeps real data
out of every other environment, so there is nothing to migrate.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/migrations/0028_patient_projection.{up,down}.sql` | Drop the doctor's patient grant; add `cases_patient_brief` |
| `apps/api/migrations/0029_study_release_gate.{up,down}.sql` | Twin columns; `status='ready'` gate on doctor study access |
| `apps/api/src/shared/db/testing/rls-harness.ts` | Fixture options for DOB, status, modality |
| `apps/api/src/shared/db/rls.test.ts` | Database-layer assertions for both migrations |
| `apps/api/src/modules/cases/internal/cases.service.ts` | Read the projection into `CaseSummary` |
| `apps/api/src/modules/imaging/internal/burned-in.ts` | Burned-in annotation decision, pure function |
| `apps/api/src/modules/imaging/internal/ingestion.service.ts` | Apply the quarantine decision at ingest |
| `apps/api/src/shared/jobs/` | BullMQ queue, worker registration, module |
| `apps/api/src/modules/imaging/internal/twin.service.ts` | Build and reap twins via Orthanc |
| `apps/api/src/modules/imaging/internal/study-access.service.ts` | Resolve twin UIDs for the destination side |
| `packages/dicom-utils/src/index.ts` | Expose `BurnedInAnnotation` and modality on the parsed header |

---

# Phase A — The database side

Closes leaks 1 and 2. Shippable and valuable on its own.

### Task 1: Remove the doctor's grant on the patient table

**Files:**
- Create: `apps/api/migrations/0028_patient_projection.up.sql`
- Create: `apps/api/migrations/0028_patient_projection.down.sql`
- Modify: `apps/api/src/shared/db/testing/rls-harness.ts` (add DOB override to `createPatient`)
- Test: `apps/api/src/shared/db/rls.test.ts`

**Interfaces:**
- Consumes: `app_current_role()`, `app_current_user_id()`, `app_has_case_with(uuid)`, `app_has_consent_for(uuid)` — all existing.
- Produces: `cases_patient_brief(p_case uuid) RETURNS TABLE (age_years int, sex text)`. Returns zero rows when the caller is not the case's doctor, or consent is missing or revoked.

- [ ] **Step 1: Add a DOB override to the patient fixture**

In `rls-harness.ts`, replace the `createPatient` function with:

```typescript
export async function createPatient(
  owner: Pool,
  createdByDoctor: string,
  overrides: { dateOfBirth?: string; sex?: 'M' | 'F' | 'O' } = {},
): Promise<string> {
  const n = uniq();
  const res = await owner.query<{ id: string }>(
    `INSERT INTO patients_patients
       (phone_e164, full_name, date_of_birth, sex, created_by_doctor)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      `+2189${n.replace(/\D/g, '').slice(-9)}`,
      `Patient ${n}`,
      overrides.dateOfBirth ?? '1985-06-15',
      overrides.sex ?? 'M',
      createdByDoctor,
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createPatient returned no row');
  return row.id;
}
```

The default is unchanged, so every existing caller keeps its current behaviour.

- [ ] **Step 2: Write the failing tests**

Append inside the `describe('additional isolation')` block in `rls.test.ts`:

```typescript
    it('a receiving doctor has no read on the patient table at all', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      // Everything that used to grant the row is present: an accepted case and
      // a valid consent. The grant is gone anyway.
      const rows = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT id FROM patients_patients')).rowCount,
      );
      expect(rows).toBe(0);

      // The control: the lab that created the patient still sees them.
      const lab = await asUser(h.app, { userId: libyaDoctor, role: 'libya_doctor' }, async (c) =>
        (await c.query('SELECT id FROM patients_patients')).rowCount,
      );
      expect(lab).toBe(1);
      expect(kase).toBeDefined();
    });

    it('the case query returns a null patient name to the doctor and a name to the lab', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      // The UNMODIFIED production join. The whole claim of this task is that
      // the database produces a null here without any application help.
      const sql = `SELECT p.full_name AS patient_name
                   FROM cases_cases a
                   LEFT JOIN patients_patients p ON p.id = a.patient_id
                   WHERE a.id = $1`;

      const asDoctor = await asUser(
        h.app,
        { userId: tunisDoctor, role: 'tunisia_doctor' },
        async (c) => (await c.query<{ patient_name: string | null }>(sql, [kase])).rows[0],
      );
      expect(asDoctor?.patient_name).toBeNull();

      const asLab = await asUser(
        h.app,
        { userId: libyaDoctor, role: 'libya_doctor' },
        async (c) => (await c.query<{ patient_name: string | null }>(sql, [kase])).rows[0],
      );
      expect(asLab?.patient_name).not.toBeNull();
    });

    it('cases_patient_brief gives the doctor age and sex, and nobody else anything', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const stranger = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor, {
        dateOfBirth: '1990-01-01',
        sex: 'F',
      });
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      const mine = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query<{ age_years: number; sex: string }>(
          'SELECT age_years, sex FROM cases_patient_brief($1)',
          [kase],
        )).rows,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0]?.sex).toBe('F');
      expect(mine[0]?.age_years).toBeGreaterThan(30);

      const theirs = await asUser(h.app, { userId: stranger, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT age_years FROM cases_patient_brief($1)', [kase])).rowCount,
      );
      expect(theirs).toBe(0);
    });

    it('cases_patient_brief returns nothing without consent, and nothing once revoked', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');

      const before = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT age_years FROM cases_patient_brief($1)', [kase])).rowCount,
      );
      expect(before).toBe(0);

      const consent = await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);
      const during = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT age_years FROM cases_patient_brief($1)', [kase])).rowCount,
      );
      expect(during).toBe(1);

      await revokeConsent(h.owner, consent);
      const after = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT age_years FROM cases_patient_brief($1)', [kase])).rowCount,
      );
      expect(after).toBe(0);
    });

    it('age is capped at 90 for a patient older than that', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor, { dateOfBirth: '1920-03-02' });
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      const rows = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query<{ age_years: number }>(
          'SELECT age_years FROM cases_patient_brief($1)',
          [kase],
        )).rows,
      );
      // Not 105. Safe Harbor treats ages over 89 as identifying.
      expect(rows[0]?.age_years).toBe(90);
    });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @mir/api test rls`
Expected: the five new tests FAIL. The first two fail on a non-null name and a row count of 1; the other three fail with `function cases_patient_brief(uuid) does not exist`.

If they report as *skipped*, stop — the database is not up. See Prerequisite.

- [ ] **Step 4: Write the migration**

Create `apps/api/migrations/0028_patient_projection.up.sql`:

```sql
-- Sub-project 2, leaks 1 and 2 — spec 2026-09-08-identifier-suppression-design.
--
-- RLS is ROW-level and has no column granularity, so "the receiving doctor may
-- see this patient" has always meant "may see every column of this patient":
-- name, phone, date of birth, national id. The application layer choosing not
-- to select a column is not an access control.
--
-- So the grant goes away entirely rather than narrowing. What the doctor is
-- actually entitled to — how old the patient is and their sex, both of which
-- change how imaging is read — arrives through a definer function instead.
--
-- CONSEQUENCE WORTH KNOWING: `CASE_COLUMNS` in cases.service.ts reaches the
-- name through LEFT JOIN patients_patients. RLS filters rows inside a join
-- exactly as it does in a top-level select, so dropping this policy makes that
-- query return NULL for a doctor with no TypeScript edited. A future
-- `SELECT p.full_name` written by someone who never read this file returns
-- nothing rather than a name. That is the point.

DROP POLICY IF EXISTS patients_receiving_doctor ON patients_patients;

-- Age, not date of birth. A DOB is an identifier; an age is a clinical fact.
-- Computed against the CASE's created_at rather than a study date: a case may
-- link zero studies or several, and an age that depends on which study you
-- picked is not a stable number.
--
-- Capped at 90. Ages above 89 are individually identifying in small
-- populations, which is why Safe Harbor draws the line there.
CREATE FUNCTION cases_patient_brief(p_case uuid)
RETURNS TABLE (age_years int, sex text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    LEAST(
      90,
      EXTRACT(YEAR FROM age(c.created_at::date, p.date_of_birth))::int
    ) AS age_years,
    p.sex
  FROM cases_cases c
  JOIN patients_patients p ON p.id = c.patient_id
  WHERE c.id = p_case
    AND app_current_role() = 'tunisia_doctor'
    AND c.doctor_id = app_current_user_id()
    AND app_has_consent_for(c.patient_id);
$$;

COMMENT ON FUNCTION cases_patient_brief(uuid) IS
  'Everything a receiving doctor is entitled to know about a patient. '
  'Definer-rights because the doctor holds no grant on patients_patients.';

GRANT EXECUTE ON FUNCTION cases_patient_brief(uuid) TO mir_app;
```

Create `apps/api/migrations/0028_patient_projection.down.sql`:

```sql
DROP FUNCTION IF EXISTS cases_patient_brief(uuid);

-- Restores the grant exactly as migration 0025 left it.
CREATE POLICY patients_receiving_doctor ON patients_patients FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_has_case_with(id)
    AND app_has_consent_for(id)
  );
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @mir/api test rls`
Expected: PASS, including all 23 pre-existing RLS tests. If test 4 ("Tunisian doctor with an appointment AND valid consent sees exactly one study") fails, the study policy was caught by the drop — it should not have been; re-read the migration.

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations/0028_patient_projection.up.sql \
        apps/api/migrations/0028_patient_projection.down.sql \
        apps/api/src/shared/db/rls.test.ts \
        apps/api/src/shared/db/testing/rls-harness.ts
git commit -m "feat(patients): the receiving doctor loses their read on the patient row"
```

---

### Task 2: Carry age and sex into the case payload

**Files:**
- Modify: `apps/api/src/modules/cases/internal/cases.service.ts`
- Modify: `packages/contracts/src/case.ts`
- Test: `apps/api/src/modules/cases/cases-lifecycle.test.ts`

**Interfaces:**
- Consumes: `cases_patient_brief(uuid)` from Task 1.
- Produces: `CaseSummary.patientAgeYears: number | null` and `CaseSummary.patientSex: 'M' | 'F' | 'O' | null`, both null for the lab side (which reads the patient record directly) and populated for the doctor.

- [ ] **Step 1: Write the failing test**

Add to `cases-lifecycle.test.ts`:

Add inside the existing `describe('the receiving doctor answers')` block, which
already provides `paidCase()`, `runWithContext` and `ctx`:

```typescript
  it('a doctor reading their case gets age and sex, and never a name', async () => {
    const { referrer, tunis, caseId } = await paidCase();
    // paidCase() creates the patient but no consent; the projection needs one.
    const { rows } = await h.owner.query<{ patient_id: string }>(
      'SELECT patient_id FROM cases_cases WHERE id = $1',
      [caseId],
    );
    const patientId = rows[0]?.patient_id;
    if (patientId === undefined) throw new Error('no patient on the fixture case');
    await grantConsent(h.owner, patientId, tunis, referrer);
    await runWithContext(ctx(tunis, 'tunisia_doctor'), () => cases.accept(caseId));

    const summary = await runWithContext(ctx(tunis, 'tunisia_doctor'), () =>
      cases.getCase(caseId),
    );

    expect(summary.patientName).toBeNull();
    expect(summary.patientAgeYears).toBeGreaterThan(0);
    expect(summary.patientSex).not.toBeNull();
  });
```

`grantConsent` is already imported by this file's neighbours; add it to the
import from `../../shared/db/testing/rls-harness` if it is not.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mir/api test cases-lifecycle`
Expected: FAIL — `patientAgeYears` is not a property of `CaseSummary`.

- [ ] **Step 3: Extend the contract**

In `packages/contracts/src/case.ts`, add to the case summary schema alongside `patientName`:

```typescript
  /**
   * The receiving doctor's view of the patient. Null for the lab, which holds
   * the identity and reads the record directly.
   *
   * Age rather than date of birth, capped at 90 — see migration 0028.
   */
  patientAgeYears: z.number().int().min(0).max(90).nullable(),
  patientSex: z.enum(['M', 'F', 'O']).nullable(),
```

- [ ] **Step 4: Read the projection in the service**

In `cases.service.ts`, extend the `CaseSummary` interface:

```typescript
  patientAgeYears: number | null;
  patientSex: string | null;
```

In `toSummary`, default both to null:

```typescript
    patientAgeYears: row.patient_age_years ?? null,
    patientSex: row.patient_sex ?? null,
```

Add the columns to `CaseRow` as `patient_age_years?: number | null` and
`patient_sex?: string | null`, then in `getCase` — for the non-assistant branch
only — join the projection:

```sql
LEFT JOIN LATERAL cases_patient_brief(a.id) b ON true
```

and add `b.age_years AS patient_age_years, b.sex AS patient_sex` to the selected
columns. `LEFT JOIN LATERAL ... ON true` is deliberate: the function returns no
rows for the lab side, and an inner join would drop the whole case.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @mir/api test cases`
Expected: PASS, all 40 pre-existing case tests included.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/cases/internal/cases.service.ts \
        packages/contracts/src/case.ts \
        apps/api/src/modules/cases/cases-lifecycle.test.ts
git commit -m "feat(cases): the doctor's case carries an age and a sex, not a name"
```

---

### Task 3: Show age and sex on the doctor's screens

**Files:**
- Modify: `apps/web/app/doctor/page.tsx`
- Modify: `apps/web/lib/i18n/dictionary.ts`
- Test: `apps/web/app/doctor/page.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `CaseSummary.patientAgeYears`, `CaseSummary.patientSex` from Task 2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the dictionary entries**

In `dictionary.ts`, add to all three locale objects (`ar`, `fr`, `en`). Keys must match `/^[a-z][A-Za-z0-9]*$/`:

```typescript
  casePatientAgeSex: 'العمر والجنس',   // ar
  casePatientAgeSex: 'Âge et sexe',     // fr
  casePatientAgeSex: 'Age and sex',     // en
```

Add a second key for the value format:

```typescript
  casePatientAgeYears: '{age} سنة',   // ar
  casePatientAgeYears: '{age} ans',   // fr
  casePatientAgeYears: '{age} years', // en
```

- [ ] **Step 2: Write the failing test**

```typescript
it('shows the age and sex and never a patient name', () => {
  render(<DoctorCaseSummary summary={{ ...acceptedCase, patientAgeYears: 62, patientSex: 'F' }} />);
  expect(screen.getByText(/62/)).toBeInTheDocument();
  expect(screen.queryByText(/Patient /)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @mir/web test doctor`
Expected: FAIL — the age is not rendered.

- [ ] **Step 4: Render it**

Add the age and sex beside the case reference in `doctor/page.tsx`, using `useT()` for both keys. Do not add a patient-name element; the existing comment at line 125 explains why the reference is the only handle and stays accurate.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @mir/web test doctor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/doctor/page.tsx apps/web/lib/i18n/dictionary.ts apps/web/app/doctor/page.test.tsx
git commit -m "feat(web): the doctor's case shows an age and a sex"
```

---

# Phase B — The release gate

### Task 4: Gate doctor study access on `status = 'ready'`

**Files:**
- Create: `apps/api/migrations/0029_study_release_gate.up.sql`
- Create: `apps/api/migrations/0029_study_release_gate.down.sql`
- Modify: `apps/api/src/shared/db/testing/rls-harness.ts` (status and modality overrides on `createStudy`)
- Test: `apps/api/src/shared/db/rls.test.ts`

**Interfaces:**
- Produces: columns `imaging_studies.twin_study_uid text`, `imaging_studies.twin_orthanc_id text`, `imaging_instances.twin_sop_uid text`, `imaging_instances.twin_series_uid text`. All nullable — a study with no twin yet is the normal state during processing.

- [ ] **Step 1: Add status and modality overrides to the study fixture**

Replace `createStudy` in `rls-harness.ts`:

```typescript
export async function createStudy(
  owner: Pool,
  patientId: string,
  uploadedBy: string,
  overrides: { status?: string; modality?: string; twinStudyUid?: string } = {},
): Promise<string> {
  const n = uniq();
  const res = await owner.query<{ id: string }>(
    `INSERT INTO imaging_studies
       (patient_id, uploaded_by, study_instance_uid, modality, status, twin_study_uid)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      patientId,
      uploadedBy,
      `1.3.6.1.4.1.99999.1.${n.replace(/\D/g, '')}`,
      overrides.modality ?? 'CT',
      overrides.status ?? 'ready',
      overrides.twinStudyUid ?? `1.3.6.1.4.1.99999.2.${n.replace(/\D/g, '')}`,
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createStudy returned no row');
  return row.id;
}
```

The default stays `ready` with a twin present, so every existing test keeps passing.

- [ ] **Step 2: Write the failing tests**

```typescript
    it('a study still processing is invisible to the doctor and visible to the lab', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const study = await createStudy(h.owner, patient, libyaDoctor, { status: 'processing' });
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await linkStudy(h.owner, kase, study);
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      const doctor = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_studies')).rowCount,
      );
      expect(doctor).toBe(0);

      const lab = await asUser(h.app, { userId: libyaDoctor, role: 'libya_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_studies')).rowCount,
      );
      expect(lab).toBe(1);
    });

    it('a quarantined study is invisible to the doctor however complete the case is', async () => {
      const libyaDoctor = await createUser(h.owner, 'libya_doctor');
      const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
      const patient = await createPatient(h.owner, libyaDoctor);
      const study = await createStudy(h.owner, patient, libyaDoctor, { status: 'quarantined' });
      const kase = await createCase(h.owner, patient, tunisDoctor, 'accepted');
      await linkStudy(h.owner, kase, study);
      await grantConsent(h.owner, patient, tunisDoctor, libyaDoctor);

      const rows = await asUser(h.app, { userId: tunisDoctor, role: 'tunisia_doctor' }, async (c) =>
        (await c.query('SELECT id FROM imaging_studies')).rowCount,
      );
      expect(rows).toBe(0);
    });
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @mir/api test rls`
Expected: both FAIL with a row count of 1 — the doctor currently sees a study regardless of its status.

- [ ] **Step 4: Write the migration**

`apps/api/migrations/0029_study_release_gate.up.sql`:

```sql
-- Sub-project 2 — the release gate and the twin's identity columns.
--
-- Under approach A the doctor reads ONLY the de-identified twin. A missing twin
-- is therefore not degraded service the way a missing thumbnail is: it is a
-- case the doctor cannot open. The database must refuse it independently of
-- whether the proxy resolved the right copy — that is the defence in depth the
-- twin is being paid for.
--
-- `status` already permitted 'quarantined' from migration 0001 and nothing has
-- ever set it. This is the migration that gives the state a meaning.

ALTER TABLE imaging_studies
  ADD COLUMN twin_study_uid  text,
  ADD COLUMN twin_orthanc_id text;

ALTER TABLE imaging_instances
  ADD COLUMN twin_sop_uid    text,
  ADD COLUMN twin_series_uid text;

-- A twin UID must be unique where present: two studies resolving to one twin
-- would serve one patient's imaging under another patient's case.
CREATE UNIQUE INDEX imaging_studies_twin_uid_idx
  ON imaging_studies (twin_study_uid) WHERE twin_study_uid IS NOT NULL;

COMMENT ON COLUMN imaging_studies.twin_study_uid IS
  'StudyInstanceUID of the anonymised copy. Fresh UID, not the original: '
  'reusing it would make Orthanc dedupe the twin into the original.';

DROP POLICY IF EXISTS studies_receiving_doctor ON imaging_studies;
CREATE POLICY studies_receiving_doctor ON imaging_studies FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND status = 'ready'
    AND app_study_linked_to_my_case(id)
    AND app_has_consent_for(patient_id)
  );
```

`apps/api/migrations/0029_study_release_gate.down.sql`:

```sql
DROP POLICY IF EXISTS studies_receiving_doctor ON imaging_studies;
CREATE POLICY studies_receiving_doctor ON imaging_studies FOR SELECT
  USING (
    app_current_role() = 'tunisia_doctor'
    AND app_study_linked_to_my_case(id)
    AND app_has_consent_for(patient_id)
  );

DROP INDEX IF EXISTS imaging_studies_twin_uid_idx;
ALTER TABLE imaging_instances DROP COLUMN IF EXISTS twin_series_uid;
ALTER TABLE imaging_instances DROP COLUMN IF EXISTS twin_sop_uid;
ALTER TABLE imaging_studies  DROP COLUMN IF EXISTS twin_orthanc_id;
ALTER TABLE imaging_studies  DROP COLUMN IF EXISTS twin_study_uid;
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @mir/api test rls`
Expected: PASS, all previous RLS tests included.

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations/0029_study_release_gate.up.sql \
        apps/api/migrations/0029_study_release_gate.down.sql \
        apps/api/src/shared/db/rls.test.ts \
        apps/api/src/shared/db/testing/rls-harness.ts
git commit -m "feat(imaging): a study reaches the doctor only once it is released"
```

---

### Task 5: Decide burned-in quarantine at ingest

**Files:**
- Create: `apps/api/src/modules/imaging/internal/burned-in.ts`
- Create: `apps/api/src/modules/imaging/internal/burned-in.test.ts`
- Modify: `packages/dicom-utils/src/index.ts`
- Modify: `apps/api/src/modules/imaging/internal/ingestion.service.ts`

**Interfaces:**
- Consumes: `readHeader(bytes)` from `@mir/dicom-utils`, extended here with `burnedInAnnotation: string | undefined` (tag `x00280301`) and the existing `modality`.
- Produces: `decideRelease(header): 'processing' | 'quarantined'`.

- [ ] **Step 1: Expose the tag on the parsed header**

In `packages/dicom-utils/src/index.ts`, add to the tag map beside `patientId: 'x00100020'`:

```typescript
  burnedInAnnotation: 'x00280301',
```

and add `burnedInAnnotation: string | undefined;` to the `DicomHeader` interface, reading it in `readHeader` the same way the neighbouring string tags are read.

- [ ] **Step 2: Write the failing tests**

`burned-in.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { decideRelease } from './burned-in';

describe('burned-in annotation gate', () => {
  it('quarantines when the tag says YES', () => {
    expect(decideRelease({ modality: 'CT', burnedInAnnotation: 'YES' })).toBe('quarantined');
  });

  it('quarantines a risky modality when the tag is absent', () => {
    for (const modality of ['US', 'XC', 'OT', 'SC']) {
      expect(decideRelease({ modality, burnedInAnnotation: undefined })).toBe('quarantined');
    }
  });

  it('releases a CT with no tag — a scanner effectively never burns text in', () => {
    expect(decideRelease({ modality: 'CT', burnedInAnnotation: undefined })).toBe('processing');
  });

  it('releases a risky modality that explicitly says NO', () => {
    expect(decideRelease({ modality: 'US', burnedInAnnotation: 'NO' })).toBe('processing');
  });

  it('is not fooled by case or padding', () => {
    expect(decideRelease({ modality: 'ct', burnedInAnnotation: ' yes ' })).toBe('quarantined');
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @mir/api test burned-in`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`burned-in.ts`:

```typescript
/**
 * Burned-in identifier gate — spec 2026-09-08, decision S3.
 *
 * Identifiers are not only in the header. A scanned film, an ultrasound
 * capture or a screenshot can carry the patient's name in the PIXELS, where
 * tag stripping does nothing at all.
 *
 * WHY THE TAG AND NOT OCR. OCR on ingest was considered and rejected: it costs
 * real money and latency on studies already measured in hundreds of megabytes
 * over a constrained link, adds an ML dependency to a zero-tolerance path, and
 * false-positives on anatomical labels — which would refuse legitimate
 * clinical work. This gate is deterministic and testable instead, and it fails
 * CLOSED on the modalities where burned-in text actually happens.
 */

/** Where burned-in text actually occurs: secondary capture and ultrasound. */
const RISKY_MODALITIES = new Set(['US', 'XC', 'OT', 'SC']);

export function decideRelease(header: {
  modality: string;
  burnedInAnnotation: string | undefined;
}): 'processing' | 'quarantined' {
  const declared = header.burnedInAnnotation?.trim().toUpperCase();

  if (declared === 'YES') return 'quarantined';
  if (declared === 'NO') return 'processing';

  // Absent. Trust it on a scanner modality; refuse it on the ones where the
  // tag being missing is itself the common case AND the risk is real.
  return RISKY_MODALITIES.has(header.modality.trim().toUpperCase())
    ? 'quarantined'
    : 'processing';
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @mir/api test burned-in`
Expected: PASS, 5 tests.

- [ ] **Step 6: Apply it at ingest**

In `ingestion.service.ts`, in `ensureStudy`, set the new study's status from `decideRelease(header)` rather than letting it default. In `maybeCompleteStudy`, a study whose status is `quarantined` must **not** advance to `ready` — leave the status alone and skip the twin enqueue added in Task 7.

- [ ] **Step 7: Run the imaging tests**

Run: `pnpm --filter @mir/api test imaging`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/imaging/internal/burned-in.ts \
        apps/api/src/modules/imaging/internal/burned-in.test.ts \
        apps/api/src/modules/imaging/internal/ingestion.service.ts \
        packages/dicom-utils/src/index.ts
git commit -m "feat(imaging): quarantine studies that may carry burned-in identifiers"
```

---

# Phase C — The twin

### Task 6: Stand up BullMQ

**Files:**
- Create: `apps/api/src/shared/jobs/jobs.module.ts`
- Create: `apps/api/src/shared/jobs/queue.tokens.ts`
- Create: `apps/api/src/shared/jobs/jobs.module.test.ts`
- Modify: `apps/api/package.json` (add `bullmq`)

**Interfaces:**
- Consumes: `AppConfig.REDIS_URL` — already present in `config.schema.ts`, no config change needed.
- Produces: DI token `IMAGING_QUEUE`, and `registerWorker(name, handler)` for later tasks. Job payload type `BuildTwinJob = { studyId: string }`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @mir/api add bullmq
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { IMAGING_QUEUE, buildTwinJobName } from './queue.tokens';

describe('job queue wiring', () => {
  it('names the twin job stably — a rename silently orphans queued jobs', () => {
    expect(buildTwinJobName).toBe('imaging.buildTwin');
    expect(IMAGING_QUEUE.toString()).toContain('IMAGING_QUEUE');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @mir/api test jobs`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the tokens and module**

`queue.tokens.ts`:

```typescript
/** Kept in its own file so consumers import the token without pulling in bullmq. */
export const IMAGING_QUEUE = Symbol('IMAGING_QUEUE');

/**
 * Job names are persisted in Redis. Renaming one orphans everything already
 * queued under the old name, which fails silently — the jobs simply never run.
 */
export const buildTwinJobName = 'imaging.buildTwin';
export const reapTwinsJobName = 'imaging.reapTwins';

export interface BuildTwinJob {
  studyId: string;
}
```

`jobs.module.ts`: a NestJS module providing a `Queue` bound to `IMAGING_QUEUE`, constructed from `AppConfig.REDIS_URL`, with `defaultJobOptions` of `{ attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000 }`. Export the token.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @mir/api test jobs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/shared/jobs/ apps/api/package.json pnpm-lock.yaml
git commit -m "feat(jobs): a BullMQ queue, which the stack has specified since P0"
```

---

### Task 7: Build the twin

**Files:**
- Create: `apps/api/src/modules/imaging/internal/twin.service.ts`
- Create: `apps/api/src/modules/imaging/internal/twin.service.test.ts`
- Modify: `apps/api/src/modules/imaging/internal/orthanc.client.ts` (add `anonymise`)
- Modify: `apps/api/src/modules/imaging/internal/orthanc.http-client.ts`
- Modify: `apps/api/src/modules/imaging/internal/ingestion.service.ts` (enqueue)

**Interfaces:**
- Consumes: `BuildTwinJob` and `IMAGING_QUEUE` from Task 6; `imaging_studies.twin_*` columns from Task 4.
- Produces: `TwinService.build(studyId): Promise<void>` — sets `twin_study_uid`, `twin_orthanc_id`, per-instance twin UIDs, then `status = 'ready'`.

- [ ] **Step 1: Confirm Orthanc's anonymisation contract**

**This step is a spike and its finding changes the implementation.** Against the dev Orthanc:

```bash
curl -u "$ORTHANC_USERNAME:$ORTHANC_PASSWORD" -X POST \
  "$ORTHANC_URL/studies/<orthanc-study-id>/anonymize" \
  -H 'content-type: application/json' \
  -d '{"Keep":["StudyDate","PatientSex"],"Replace":{"PatientAge":"062Y"},"KeepPrivateTags":false}'
```

Record whether the response is a new persisted resource (expected — Orthanc's study-level anonymise creates one) or raw bytes. If it persists, the twin's Orthanc id comes from the response and no separate STOW is needed. Write the finding as a comment at the top of `twin.service.ts` before continuing.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { anonymisationRequest } from './twin.service';

describe('anonymisation request', () => {
  it('keeps what the read needs and replaces the age', () => {
    const req = anonymisationRequest({ ageYears: 62, sex: 'F' });
    expect(req.Keep).toContain('StudyDate');
    expect(req.Keep).toContain('PatientSex');
    expect(req.Replace['PatientAge']).toBe('062Y');
    expect(req.KeepPrivateTags).toBe(false);
  });

  it('caps the DICOM age string at 090Y', () => {
    expect(anonymisationRequest({ ageYears: 104, sex: 'M' }).Replace['PatientAge']).toBe('090Y');
  });

  it('never keeps a patient identifier', () => {
    const req = anonymisationRequest({ ageYears: 40, sex: 'M' });
    for (const tag of ['PatientName', 'PatientID', 'PatientBirthDate', 'OtherPatientIDs']) {
      expect(req.Keep).not.toContain(tag);
      expect(req.Replace).not.toHaveProperty(tag);
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @mir/api test twin`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `anonymisationRequest` and `TwinService.build`**

```typescript
/**
 * The tag policy — spec 2026-09-08, Part 2.
 *
 * PS3.15 Annex E basic confidentiality profile, applied BY ORTHANC rather than
 * hand-rolled: ADR-3 says do not hand-roll DICOM manipulation, and a tag
 * rewriter is exactly that.
 *
 * Three deliberate deviations, all recorded in the spec:
 *  - PatientAge is SET, not stripped. It is how the doctor learns the age at
 *    all, and an age is a clinical fact where a birth date is an identifier.
 *  - PatientSex is kept. It changes how imaging is read.
 *  - StudyDate is kept, which the basic profile strips. How recent a scan is
 *    changes how it is read, and the patient is already pseudonymous behind a
 *    fresh UID. This one is flagged for counsel alongside L9.
 */
export function anonymisationRequest(brief: { ageYears: number; sex: string }): {
  Keep: string[];
  Replace: Record<string, string>;
  KeepPrivateTags: boolean;
} {
  const capped = Math.min(90, Math.max(0, brief.ageYears));
  return {
    Keep: ['StudyDate', 'PatientSex', 'Modality', 'BodyPartExamined'],
    Replace: { PatientAge: `${String(capped).padStart(3, '0')}Y` },
    KeepPrivateTags: false,
  };
}
```

`build(studyId)` then: load the study and its patient brief as owner, call `orthanc.anonymise(orthancStudyId, anonymisationRequest(...))`, persist the returned twin UIDs onto the study and its instances, and set `status = 'ready'` in the same transaction. A study already `quarantined` returns early without building.

- [ ] **Step 5: Enqueue from ingest**

In `ingestion.service.ts`'s `maybeCompleteStudy`, where the study currently becomes complete, enqueue `buildTwinJobName` with `{ studyId }` **after** the transaction commits, and set `status = 'processing'` rather than `ready`. Quarantined studies enqueue nothing.

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm --filter @mir/api test imaging`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/imaging/internal/twin.service.ts \
        apps/api/src/modules/imaging/internal/twin.service.test.ts \
        apps/api/src/modules/imaging/internal/orthanc.client.ts \
        apps/api/src/modules/imaging/internal/orthanc.http-client.ts \
        apps/api/src/modules/imaging/internal/ingestion.service.ts
git commit -m "feat(imaging): build a de-identified twin of every study"
```

---

### Task 8: Serve the twin to the destination side

**Files:**
- Modify: `apps/api/src/modules/imaging/internal/study-access.service.ts`
- Modify: `apps/api/src/modules/imaging/internal/dicomweb.controller.ts`
- Test: `apps/api/src/modules/imaging/internal/study-access.service.test.ts`

**Interfaces:**
- Consumes: twin columns from Task 4, populated by Task 7.
- Produces: `authoriseStudyAccess` returns an added `orthancStudyUid: string` — the twin's UID for `tunisia_doctor`, the original's for `libya_doctor`. Every Orthanc call in the controller uses that field instead of the caller's path parameter.

- [ ] **Step 1: Write the failing tests**

```typescript
it('resolves a doctor to the twin UID', async () => {
  const res = await service.authoriseStudyAccess(twinUid, 'metadata');
  expect(res.orthancStudyUid).toBe(twinUid);
});

it('gives a doctor 404 for the ORIGINAL uid — it is an identifier in itself', async () => {
  await expect(service.authoriseStudyAccess(originalUid, 'metadata')).rejects.toThrow(NotFoundException);
});

it('resolves the lab to the original UID', async () => {
  const res = await labService.authoriseStudyAccess(originalUid, 'metadata');
  expect(res.orthancStudyUid).toBe(originalUid);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mir/api test study-access`
Expected: FAIL — `orthancStudyUid` is not returned.

- [ ] **Step 3: Implement the resolution**

Look the study up by `twin_study_uid` when the role is `tunisia_doctor` and by `study_instance_uid` when it is `libya_doctor`. A doctor presenting an original UID matches nothing and gets the existing 404 path — which is correct and not a special case: an original UID is a linkable identifier and the doctor should never hold one.

- [ ] **Step 4: Use it in every controller handler**

Replace each `studyUid` passed to `this.orthanc.*` in `dicomweb.controller.ts` with the resolved `orthancStudyUid`. There are four call sites: `studyMetadata`, `instance`, `instanceMetadata` and `frames`.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @mir/api test imaging`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/imaging/internal/study-access.service.ts \
        apps/api/src/modules/imaging/internal/study-access.service.test.ts \
        apps/api/src/modules/imaging/internal/dicomweb.controller.ts
git commit -m "feat(imaging): the destination side reads twin UIDs and never the original"
```

---

### Task 9: Reap twins after the retention window

**Files:**
- Modify: `apps/api/src/modules/imaging/internal/twin.service.ts`
- Modify: `apps/api/src/shared/config/config.schema.ts`
- Test: `apps/api/src/modules/imaging/internal/twin.service.test.ts`

**Interfaces:**
- Consumes: `reapTwinsJobName` from Task 6.
- Produces: `TwinService.reap(now: Date): Promise<number>` returning how many twins were deleted.

- [ ] **Step 1: Add the config key**

In `config.schema.ts`, beside `CASES_ANSWER_WINDOW_HOURS`:

```typescript
  /**
   * How long a twin outlives its case. The ORIGINAL is the record and the twin
   * is reproducible from it, so this bounds storage to the working set rather
   * than the archive. Placeholder until blocking item L5 answers retention.
   */
  IMAGING_TWIN_RETENTION_DAYS: intFromEnv('IMAGING_TWIN_RETENTION_DAYS', 1, 3650).prefault('90'),
```

- [ ] **Step 2: Write the failing test**

```typescript
it('reaps a twin whose case closed beyond the window, and leaves a recent one', async () => {
  const old = await closedCase({ closedDaysAgo: 120 });
  const recent = await closedCase({ closedDaysAgo: 10 });

  const deleted = await service.reap(new Date());

  expect(deleted).toBe(1);
  expect(await twinUidOf(old)).toBeNull();
  expect(await twinUidOf(recent)).not.toBeNull();
});

it('never reaps a twin whose case is still open', async () => {
  const open = await acceptedCase({ acceptedDaysAgo: 400 });
  expect(await service.reap(new Date())).toBe(0);
  expect(await twinUidOf(open)).not.toBeNull();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @mir/api test twin`
Expected: FAIL — `reap` is not a function.

- [ ] **Step 4: Implement `reap`**

Select studies whose every linked case is terminal (`closed`, `cancelled`, `declined`, `expired`) and whose most recent terminal transition is older than the window, delete the twin from Orthanc, then null the twin columns. A study linked to any non-terminal case is skipped — one open case keeps the twin alive.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @mir/api test twin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/imaging/internal/twin.service.ts \
        apps/api/src/modules/imaging/internal/twin.service.test.ts \
        apps/api/src/shared/config/config.schema.ts
git commit -m "feat(imaging): reap twins once their case has been closed a while"
```

---

# Phase D — Surfacing quarantine

### Task 10: Tell the lab and ops about a quarantined study

**Files:**
- Modify: `apps/web/app/cases/[ref]/page.tsx`
- Modify: `apps/web/app/admin/cases/page.tsx`
- Modify: `apps/web/lib/i18n/dictionary.ts`

**Interfaces:**
- Consumes: `imaging_studies.status` as already exposed on the study DTO.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the dictionary entries**

Three locales, matching `/^[a-z][A-Za-z0-9]*$/`:

In the `ar` object:

```typescript
  studyQuarantinedTitle: 'الدراسة قيد المراجعة',
  studyQuarantinedBody: 'قد تحتوي الصور على اسم المريض داخل الصورة نفسها. أعد التصدير من الجهاز بدون تعليقات مكتوبة، ثم ارفعها من جديد.',
```

In the `fr` object:

```typescript
  studyQuarantinedTitle: 'Examen en attente de vérification',
  studyQuarantinedBody: "Les images peuvent contenir le nom du patient incrusté dans l'image. Réexportez l'examen depuis la console sans annotations, puis téléversez-le à nouveau.",
```

In the `en` object:

```typescript
  studyQuarantinedTitle: 'Study held for review',
  studyQuarantinedBody: 'The images may carry the patient\'s name burned into the picture itself. Re-export the study from the console without annotations, then upload it again.',
```

Each body says what the lab should **do**, not merely that the study is held — a
notice that reports a state without an action generates a support call.

- [ ] **Step 2: Write the failing test**

```typescript
it('tells the lab what to do about a quarantined study', () => {
  render(<CaseStudies studies={[{ ...study, status: 'quarantined' }]} />);
  expect(screen.getByTestId('study-quarantined')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @mir/web test cases`
Expected: FAIL.

- [ ] **Step 4: Render the notice**

An `Alert` with `tone="warning"` and `data-testid="study-quarantined"` on the lab's case page, and a status column value on the ops pipeline.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @mir/web test cases`
Expected: PASS.

- [ ] **Step 6: Full verification**

```bash
pnpm db:clean && pnpm verify
```

Expected: typecheck, lint, boundaries, boundaries:verify, and the full test suite green — including all 23 original RLS tests plus the 7 added here.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/cases/ apps/web/app/admin/cases/page.tsx apps/web/lib/i18n/dictionary.ts
git commit -m "feat(web): a quarantined study says what the lab should do about it"
```

---

## Documentation to update on completion

- `platform-requirements.md` §7.1 and §7.2 move from **Partial**/**Not built** to **Built**; §12 marks sub-project 2 done.
- `docs/decisions.md` gains a revision recording S1–S5.
- `BUILD_SPEC.md` §1.1: the doctor's capability line should say they view *de-identified* linked studies.
