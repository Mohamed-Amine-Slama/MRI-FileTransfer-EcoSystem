# Platform Corrections — Plan 1: Foundations & Quick Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local world that seeds and signs in; `/` goes to login; only clinic/lab (Libya) and doctor (Tunisia) accounts; the case screens read the real API so a clinic can create, quote and pay a real case and a doctor can open it; the viewer stops hanging.

**Architecture:** The case screens already sit behind one seam — `casesApi` from `lib/api/mock`, whose own comment says "when the backend lands, add the live client and select on `isMockMode()`. The screens import `casesApi` and will not need to change." This plan adds that live client (`lib/api/live/live-cases.ts`) over the real endpoints, with a `supports` flag set so screens hide the things with no backend (messages, per-file access trail, in-app notifications, ops status override). The mock stays as the vitest fixture it is.

**Tech Stack:** Next.js 15 App Router (client pages), NestJS API + PostgreSQL with RLS, vitest (API tests against a real Postgres via `rls-harness`), Playwright, Keycloak (ROPC dev login).

**Spec:** `docs/superpowers/specs/2026-09-21-platform-corrections-design.md` (§0, §1, §2, §6 hang fix, §9)

## Global Constraints

- **Never use a physical-direction Tailwind utility.** `ps-*/pe-*`, `ms-*/me-*`, `start-*/end-*`, `text-start`, `border-s`. ESLint enforces it.
- **Copy is dictionary keys.** Every new string is added to all three locales in `apps/web/lib/i18n/dictionary.ts` (ar, fr, en blocks). The dictionary test fails on a key missing from any locale.
- **A doctor-facing payload never carries the patient's name, phone or email** (requirements §7).
- **Nothing under `apps/web/components/corridor/`, `apps/web/lib/site/`, or `apps/web/app/[locale]/CorridorRoute*` is deleted or edited.**
- **Never leave a temporary hack in a tracked file** — the owner commits the working tree mid-session. Scratch env lives in the session scratchpad.
- **Running API DB tests rewrites `mir_app`'s password cluster-wide.** `.env` already uses the harness default; if the local API starts failing auth afterwards, re-run the `ALTER ROLE` line from the runbook.
- Commands: web — `cd apps/web && pnpm test | pnpm lint | pnpm typecheck`; api — `cd apps/api && pnpm test -- <file> | pnpm typecheck`; contracts — `cd packages/contracts && pnpm test && pnpm build` (web and api consume the BUILT contracts; rebuild after every contracts change).

## Corrections to the spec, applied by this plan

1. **§9 does not rewrite nine screens against `api.*`.** It implements the live `CasesApi` behind the existing seam, which is what the code was built for. Screens change only where they must: hiding unsupported panels, the study link, and the missing consult actions (point 3).
2. **No `GET /cases/:id/studies` is added.** `GET /studies?caseId=` already exists (`imaging/internal/studies.controller.ts`) and returns `studyInstanceUid`.
3. **Found while reading: no screen submits, quotes or pays a real case.** `api.cases.submit` and `api.cases.pay` have no callers and nothing links to `/cases/[ref]/pick-doctor`. The new-case form, the case page's next-step button, and the pay step are therefore part of §9 here.
4. **`/notifications` has no backend at all** (the notifications module only sends email/SMS). It is removed from navigation and its page says notifications arrive by email; it is not rewired.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/dev-bootstrap.mjs` | **Modify.** DB half rewritten to the current schema; `patient` account removed. |
| `scripts/dev-seed-imaging.mjs` | **Create.** Uploads `test-data/dicom/03-mr-series` through the real upload API as the clinic and links it to the seeded accepted/answered cases. |
| `apps/web/app/page.tsx` | **Modify.** Signed-out → `/login`; no `Corridor` import. |
| `apps/web/app/[locale]/page.tsx` | **Modify.** Redirects to `/login`; metadata export removed. |
| `apps/web/e2e/public-surface.spec.ts`, `smoke.spec.ts`, `corridor.spec.ts` | **Modify.** Assert the redirect; corridor suite skipped with a pointer. |
| `packages/contracts/src/provider.ts` (+ test) | **Modify.** `providerKindsForSide`, `isKindAllowedOnSide`. |
| `packages/contracts/src/case.ts` (+ test) | **Modify.** `CONSULT_SPECIALTIES`. |
| `apps/api/src/modules/organisations/internal/organisations.controller.ts` | **Modify.** Reject a kind outside its side. |
| `apps/web/app/signup/provider/page.tsx` | **Modify.** Offer only the side's kinds. |
| `apps/api/src/modules/cases/internal/cases.service.ts`, `cases.controller.ts` | **Modify.** DTO gains `caseRef`, `createdAt`, `updatedAt`, `quotedAt`, `patientAgeYears`, `patientSex`; admin may read cases. |
| `apps/web/lib/api/endpoints.ts` | **Modify.** `CaseRecord` gains the same fields; `api.imaging.studiesForCase`; `api.ledger`. |
| `apps/web/lib/api/live/adapt.ts` (+ test) | **Create.** Pure `CaseRecord → Case`, `Organisation → Provider`, derived timeline. |
| `apps/web/lib/api/live/live-cases.ts` | **Create.** The live `CasesApi`. |
| `apps/web/lib/api/cases.ts` | **Modify.** `supports` on the interface. |
| `apps/web/lib/api/mock/index.ts`, `mock/mock-cases.ts` | **Modify.** Select live vs mock; mock declares `supports` all true. |
| `apps/web/lib/provider/current-provider.ts` | **Modify.** Live: own organisation from `organisations.mine`. |
| `apps/web/app/cases/[ref]/page.tsx` | **Modify.** Studies by UID, next-step actions, unsupported panels hidden. |
| `apps/web/app/cases/new/page.tsx` | **Modify.** Specialty + studies; after submit, go to pick-doctor. |
| `apps/web/app/cases/[ref]/pick-doctor/page.tsx` | **Modify.** Pay step on the quoted state. |
| nav source (found by grep in Task 8) | **Modify.** Drop the notifications entry. |
| `apps/web/app/notifications/page.tsx` | **Modify.** Email notice instead of the mock list. |
| `apps/web/app/viewer/[studyUid]/page.tsx` | **Modify.** Hang fix + timeout fallback. |
| `apps/web/lib/viewer/with-timeout.ts` (+ test) | **Create.** Promise timeout helper. |

---

### Task 1: A seed that matches the schema

**Files:**
- Modify: `scripts/dev-bootstrap.mjs` (ACCOUNTS, PATIENTS, `ensureRoles`, `buildSeedSql`, `main` summary line)
- Create: `scripts/dev-seed-imaging.mjs`

**Interfaces:**
- Produces: seeded accounts (unchanged usernames/passwords minus `dev-patient`); organisations `Sample Referring Clinic` (source, clinic, approved), `Sample Pending Laboratory` (source, laboratory, pending), `Receiving Practice — Karim` / `— Nadia` / `— Sami` (destination, doctor, approved); verified doctor profiles with lowercase specialties; cases whose `reason` is `seed:submitted`, `seed:quoted`, `seed:paid`, `seed:accepted`, `seed:answered` (the imaging seed and later tests find them by reason).

- [ ] **Step 1: Drop the patient account and the claim column from the data**

In `ACCOUNTS`, delete the `dev-patient@example.test` entry. In `ensureRoles` remove `'patient'` from the role list. In `PATIENTS`, delete every `claim` property. In `buildSeedSql`, delete `const patientUser = …`.

- [ ] **Step 2: Replace the stale body of `buildSeedSql`**

Keep: the stale-row parking loop, the `identity_users` + `identity_user_preferences` loop. In the re-pointing block, delete the `scheduling_*`, `claimed_by_user` and `consent_records SET granted_to` statements and add `UPDATE cases_cases SET doctor_id = ${to} WHERE doctor_id IN ${from};`. Replace everything from the first `identity_doctor_profiles` insert down to `lines.push('COMMIT;')` with:

```js
  // --- organisations: one clinic (source), one practice per doctor (destination)
  const clinic = 'Sample Referring Clinic';
  const pendingLab = 'Sample Pending Laboratory';
  const doctors = [
    { user: receiver, name: 'Receiving Practice — Karim', specialty: 'radiology', accepting: true, lic: 'DEV-TN-0002' },
    { user: radiologist, name: 'Receiving Practice — Nadia', specialty: 'radiology', accepting: false, lic: 'DEV-TN-0007' },
    { user: cardiologist, name: 'Receiving Practice — Sami', specialty: 'cardiology', accepting: false, lic: 'DEV-TN-0008' },
  ];
  const orgRef = (name) => `(SELECT id FROM identity_organisations WHERE legal_name = ${q(name)})`;

  lines.push(
    `INSERT INTO identity_organisations
       (kind, legal_name, corridor_id, side, verification_status, decided_at, decided_by, seat_count, credentials)
     SELECT 'clinic', ${q(clinic)}, 'ly-tn', 'source', 'approved', now(), ${q(ops)}::uuid, 5,
            '{"licenceNumber":"DEV-LY-0001"}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM identity_organisations WHERE legal_name = ${q(clinic)});`,
    `INSERT INTO identity_organisations
       (kind, legal_name, corridor_id, side, verification_status, seat_count, credentials)
     SELECT 'laboratory', ${q(pendingLab)}, 'ly-tn', 'source', 'pending', 2,
            '{"licenceNumber":"DEV-LY-9999"}'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM identity_organisations WHERE legal_name = ${q(pendingLab)});`,
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     SELECT ${orgRef(clinic)}, ${q(doctor)}::uuid, 'owner' ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     SELECT ${orgRef(clinic)}, ${q(assistant)}::uuid, 'assistant' ON CONFLICT DO NOTHING;`,
    `INSERT INTO identity_memberships (organisation_id, user_id, seat_role)
     SELECT ${orgRef(pendingLab)}, ${q(applicant)}::uuid, 'owner' ON CONFLICT DO NOTHING;`,
  );

  for (const d of doctors) {
    lines.push(
      `INSERT INTO identity_organisations
         (kind, legal_name, corridor_id, side, verification_status, decided_at, decided_by, seat_count, credentials)
       SELECT 'doctor', ${q(d.name)}, 'ly-tn', 'destination', 'approved', now(), ${q(ops)}::uuid, 1,
              ${q(JSON.stringify({ cnomNumber: d.lic }))}::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM identity_organisations WHERE legal_name = ${q(d.name)});`,
      `INSERT INTO identity_memberships (organisation_id, user_id, seat_role, specialty)
       SELECT ${orgRef(d.name)}, ${q(d.user)}::uuid, 'owner', ${q(d.specialty)}
       ON CONFLICT (organisation_id, user_id) DO UPDATE SET specialty = EXCLUDED.specialty;`,
      // Verified, lowercase specialty key: the directory, the quote check and
      // the headcount all filter on verified_at and compare specialty exactly.
      `INSERT INTO identity_doctor_profiles
         (user_id, country, license_number, specialty, clinic_name, verified_at, verified_by, accepting_cases)
       VALUES (${q(d.user)}::uuid, 'TN', ${q(d.lic)}, ${q(d.specialty)}, ${q(d.name)}, now(), ${q(ops)}::uuid, ${q(d.accepting)})
       ON CONFLICT (user_id) DO UPDATE
         SET specialty = EXCLUDED.specialty, clinic_name = EXCLUDED.clinic_name,
             verified_at = COALESCE(identity_doctor_profiles.verified_at, EXCLUDED.verified_at),
             verified_by = COALESCE(identity_doctor_profiles.verified_by, EXCLUDED.verified_by);`,
    );
  }

  // --- patients (synthetic, ADR-7), created by the clinic's doctor
  for (const p of PATIENTS) {
    lines.push(
      `INSERT INTO patients_patients (phone_e164, full_name, date_of_birth, sex, created_by_doctor)
       SELECT ${q(p.phone)}, ${q(p.name)}, ${q(p.dob)}::date, ${q(p.sex)}, ${q(doctor)}::uuid
       WHERE NOT EXISTS (SELECT 1 FROM patients_patients WHERE phone_e164 = ${q(p.phone)});`,
    );
  }

  // --- consent terms + an attested consent per patient for Karim
  const termsAr = 'أوافق على نقل صوري الطبية إلى الطبيب المستقبل في تونس.';
  const termsFr = "J'accepte le transfert de mes images médicales au médecin destinataire en Tunisie.";
  const termsEn = 'I agree to the transfer of my medical images to the receiving doctor in Tunisia.';
  lines.push(
    `INSERT INTO consent_terms (version, locale, scope, body, content_hash, published_at)
     VALUES
       ('v1', 'ar', 'cross_border_transfer', ${q(termsAr)}, ${q(sha(termsAr))}, now()),
       ('v1', 'fr', 'cross_border_transfer', ${q(termsFr)}, ${q(sha(termsFr))}, now()),
       ('v1', 'en', 'cross_border_transfer', ${q(termsEn)}, ${q(sha(termsEn))}, now())
     ON CONFLICT (version, locale, scope) DO NOTHING;`,
  );
  for (const p of PATIENTS) {
    const patientRef = `(SELECT id FROM patients_patients WHERE phone_e164 = ${q(p.phone)} LIMIT 1)`;
    lines.push(
      `INSERT INTO consent_records
         (patient_id, scope, granted_to, terms_version, terms_locale, evidence_hash,
          attested_by, document_object_key, document_sha256)
       SELECT ${patientRef}, 'cross_border_transfer', ${q(receiver)}::uuid, 'v1', 'en',
              ${q(sha(`dev-seed:${p.phone}`))}, ${q(doctor)}::uuid,
              ${q(`dev-seed/consent/${p.phone}.pdf`)}, ${q(sha(`dev-seed-doc:${p.phone}`))}
       WHERE NOT EXISTS (
         SELECT 1 FROM consent_records
          WHERE patient_id = ${patientRef} AND granted_to = ${q(receiver)}::uuid
            AND scope = 'cross_border_transfer' AND revoked_at IS NULL);`,
    );
  }

  // --- one case per status, keyed by reason so re-runs are no-ops
  const caseRows = [
    { reason: 'seed:submitted', phone: PATIENTS[0].phone, status: 'submitted' },
    { reason: 'seed:quoted',    phone: PATIENTS[1].phone, status: 'quoted' },
    { reason: 'seed:paid',      phone: PATIENTS[2].phone, status: 'paid' },
    { reason: 'seed:accepted',  phone: PATIENTS[0].phone, status: 'accepted' },
    { reason: 'seed:answered',  phone: PATIENTS[0].phone, status: 'answered' },
  ];
  for (const c of caseRows) {
    const patientRef = `(SELECT id FROM patients_patients WHERE phone_e164 = ${q(c.phone)} LIMIT 1)`;
    const priced = c.status !== 'submitted';
    const taken = c.status === 'accepted' || c.status === 'answered';
    lines.push(
      `INSERT INTO cases_cases
         (patient_id, organisation_id, specialty, status, reason, created_by, doctor_id,
          quoted_amount_minor, quoted_currency, quoted_at, quote_expires_at,
          accepted_at, answer_due_at, answered_at)
       SELECT ${patientRef}, ${orgRef(clinic)}, 'radiology', ${q(c.status)}, ${q(c.reason)}, ${q(doctor)}::uuid,
              ${priced ? `${q(receiver)}::uuid` : 'NULL'},
              ${priced ? '10000' : 'NULL'}, ${priced ? `'USD'` : 'NULL'},
              ${priced ? 'now()' : 'NULL'}, ${priced ? `now() + interval '1 day'` : 'NULL'},
              ${taken ? 'now()' : 'NULL'},
              ${taken ? `now() + interval '72 hours'` : 'NULL'},
              ${c.status === 'answered' ? 'now()' : 'NULL'}
       WHERE NOT EXISTS (SELECT 1 FROM cases_cases WHERE reason = ${q(c.reason)});`,
    );
  }

  // --- subscription + audit rows so the billing and admin tiles are not empty
  lines.push(
    `INSERT INTO billing_subscriptions (organisation_id, plan_code, status, seats, period_start, period_end)
     SELECT ${orgRef(clinic)}, 'src_clinic', 'active', 5, date_trunc('month', now()),
            date_trunc('month', now()) + interval '1 month'
     ON CONFLICT (organisation_id) DO NOTHING;`,
    `INSERT INTO audit_events (actor_id, actor_role, action, subject_type, metadata, occurred_at)
     SELECT ${q(doctor)}::uuid, 'libya_doctor', a.action, 'patient',
            jsonb_build_object('granted', a.granted), now() - (a.n || ' hours')::interval
     FROM (VALUES ('patient.create', true, 1), ('study.view', true, 2),
                  ('study.view', false, 3), ('patient.search', true, 4)) AS a(action, granted, n)
     WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE actor_id = ${q(doctor)}::uuid);`,
  );
```

Add at module level (next to `q`):

```js
function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}
```

Before running, check `consent_terms`' columns (`docker exec mir-postgres psql -U postgres -d mir -c '\d consent_terms'`) and whether its `locale` check allows `'en'`; if it does not, drop the `en` row and use `'ar'` in the consent insert. Update the summary line in `main` to `'  seeded     users, organisations, doctor profiles, patients, consent, cases, subscription, audit'` and add after it: `console.log('\nNext: node scripts/dev-seed-imaging.mjs  (needs the API running)');`

- [ ] **Step 3: Run it and verify**

Run (stack up per the runbook): `node scripts/dev-bootstrap.mjs`
Expected: no `psql:` error lines; ends with the account table (7 accounts, no `dev-patient`). Then
`docker exec mir-postgres psql -U postgres -d mir -Atc "select status, count(*) from cases_cases group by 1 order by 1"`
Expected: `accepted|1`, `answered|1`, `paid|1`, `quoted|1`, `submitted|1`. Run the bootstrap again: still exactly one of each.

- [ ] **Step 4: Write `scripts/dev-seed-imaging.mjs`**

Before writing, open `apps/api/src/modules/imaging/internal/upload.service.ts` and confirm (a) the property name of the file id on `FileUploadState` (assumed `fileId`), (b) whether the session needs a finalise call after the last file for `imaging_studies.status` to leave `uploading`. Adjust the script to match.

```js
#!/usr/bin/env node
/**
 * Puts one real MR series into the local world, THROUGH THE API.
 *
 * Not SQL: an upload writes the original to storage, stores it in Orthanc,
 * records instances, and builds the de-identified twin the receiving doctor
 * reads. Faking those rows would give a viewer that 404s on every frame.
 *
 * Runs as the referring clinic's doctor (ROPC — dev realm only), uploads
 * test-data/dicom/03-mr-series for the patient on the `seed:accepted` case,
 * then links the study to the `seed:accepted` and `seed:answered` cases.
 * Idempotent: skips the upload when that patient already has a study.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env['API_URL'] ?? 'http://127.0.0.1:3100';
const KC = process.env['KC_SERVER'] ?? 'http://localhost:8081';
const SERIES = join(REPO, 'test-data', 'dicom', '03-mr-series');
const CHUNK = 1024 * 1024;

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'mir-postgres', 'psql', '-U', 'postgres', '-d', 'mir', '-Atc', query],
    { encoding: 'utf8' },
  ).trim();
}

async function token() {
  const res = await fetch(`${KC}/realms/mir/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'mir-web',
      username: 'dev-doctor@example.test',
      password: 'dev-doctor-pass-1234',
      scope: 'openid',
    }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function call(bearer, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${bearer}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

async function main() {
  const patientId = sql(`select patient_id from cases_cases where reason = 'seed:accepted'`);
  if (patientId === '') throw new Error('run scripts/dev-bootstrap.mjs first');

  let studyId = sql(
    `select id from imaging_studies where patient_id = '${patientId}' and status <> 'uploading' limit 1`,
  );
  if (studyId === '') {
    const bearer = await token();
    const files = readdirSync(SERIES).filter((f) => f.endsWith('.dcm')).sort();
    const { sessionId } = await call(bearer, '/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patientId, expectedFileCount: files.length }),
    });
    for (const name of files) {
      const bytes = readFileSync(join(SERIES, name));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const state = await call(bearer, `/uploads/${sessionId}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientFileId: name, fileName: name, sizeBytes: bytes.length, sha256 }),
      });
      for (let i = 0, off = 0; off < bytes.length; i += 1, off += CHUNK) {
        await call(bearer, `/uploads/files/${state.fileId}/chunks/${i}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes.subarray(off, off + CHUNK),
        });
      }
      await call(bearer, `/uploads/files/${state.fileId}/complete`, { method: 'POST' });
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    studyId = sql(
      `select id from imaging_studies where patient_id = '${patientId}' order by created_at desc limit 1`,
    );
  }

  for (const reason of ['seed:accepted', 'seed:answered']) {
    sql(`insert into cases_case_studies (case_id, study_id)
         select id, '${studyId}' from cases_cases where reason = '${reason}'
         on conflict do nothing`);
  }

  const uid = sql(`select study_instance_uid from imaging_studies where id = '${studyId}'`);
  console.log(`study ${studyId}\n  uid ${uid}\n  linked to seed:accepted, seed:answered`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 5: Run it and verify the doctor can read the study**

Run: `node scripts/dev-seed-imaging.mjs`
Expected: 24 dots, then the study id and uid. Then fetch a token for `dev-receiver@example.test` with the same ROPC request and run
`curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:3100/dicom-web/studies/<uid>/instances | head -c 300`
Expected: `{"instances":[{"sopInstanceUid":…` (24 entries). A 404 while the twin builds: wait 10 s and retry. A 403/404 that persists: the consent or case link is wrong — fix the seed; never loosen the access check.

- [ ] **Step 6: Commit**

```bash
git add scripts/dev-bootstrap.mjs scripts/dev-seed-imaging.mjs
git commit -m "fix(dev): seed the current schema and a real MR series"
```

---

### Task 2: `/` goes to login; the landing is unrouted, not deleted

**Files:**
- Modify: `apps/web/app/page.tsx` (imports; the `status !== 'authenticated'` block)
- Modify: `apps/web/app/[locale]/page.tsx`
- Modify: `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/public-surface.spec.ts`, `apps/web/e2e/corridor.spec.ts`

- [ ] **Step 1: Write the failing e2e assertions**

In `public-surface.spec.ts`, replace the first test and add one:

```ts
  test('an anonymous visitor at / is sent to sign-in (landing hidden, 2026-09-21)', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the locale landing routes also go to sign-in', async ({ page }) => {
    for (const locale of ['ar', 'fr', 'en']) {
      await page.goto(`/${locale}`);
      await page.waitForURL('**/login');
    }
  });
```

Delete the tests that assert landing content (`carries the pricing route through…`, `states the reference-only limit…`, `scopes the marketing treatment…`); keep `the calendar surface is gone`; point `has exactly one main landmark`, the RTL test and the horizontal-scroll test at `/login` and `/pricing`. In `smoke.spec.ts`, `the front door renders` becomes `await page.goto('/'); await page.waitForURL('**/login'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();` (drop the `MIR` link assertion). At the top of `corridor.spec.ts`, after the imports:

```ts
// The landing is unrouted for now (spec 2026-09-21 §1); its files are kept.
// Re-enable this suite when `/` and `/[locale]` render <Corridor> again.
test.skip(true, 'landing page hidden — docs/superpowers/specs/2026-09-21-platform-corrections-design.md §1');
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/web && pnpm build && pnpm exec playwright test e2e/public-surface.spec.ts e2e/smoke.spec.ts --project=chromium`
Expected: the redirect tests FAIL (the landing renders).

- [ ] **Step 3: Implement the root redirect**

In `apps/web/app/page.tsx`: remove the `Corridor` import (and `useLocale` if now unused); add `import { useRouter } from 'next/navigation';` and `Spinner` to the `../components/ui` import. Read `lib/session/session.ts` for the exact signed-out status literal. Replace the `if (status !== 'authenticated') { … <Corridor …/> }` block and its comment with (using that literal in place of `'anonymous'`):

```tsx
  const router = useRouter();
  /*
   * `/` is the sign-in door while the landing page is hidden (spec
   * 2026-09-21 §1). The landing's files are kept; restoring it is reverting
   * this block and `app/[locale]/page.tsx`.
   *
   * The loading state is a spinner, NOT the landing: mounting the WebGL helix
   * and its GSAP timelines for every signed-in user during session resolution
   * was measurable jank on every dashboard load.
   */
  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }
```

- [ ] **Step 4: Implement the locale redirect**

Replace `apps/web/app/[locale]/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';
import { UI_LOCALES, type UiLocale } from '@mir/contracts';

/**
 * The landing page is hidden for now (spec 2026-09-21 §1). `/ar`, `/fr`, `/en`
 * redirect to sign-in. The previous version of this file — per-locale
 * metadata, OG cards, and <CorridorRoute> — is in git history at 50d72e5;
 * restoring the landing is restoring that file. CorridorRoute.tsx is kept.
 *
 * `dynamicParams = false` stays: without it this segment would match every
 * unknown one-segment path and turn a 404 into a redirect.
 */
export const dynamicParams = false;

export function generateStaticParams(): { locale: UiLocale }[] {
  return UI_LOCALES.map((locale) => ({ locale }));
}

export default function LocaleLanding(): never {
  redirect('/login');
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec playwright test e2e/public-surface.spec.ts e2e/smoke.spec.ts --project=chromium`
Expected: PASS. After `pnpm build`, run `git status`; if `next-env.d.ts` or `tsconfig.json` changed, `git checkout` them.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/page.tsx "apps/web/app/[locale]/page.tsx" apps/web/e2e/
git commit -m "feat(web): send / to sign-in and hide the landing page (files kept)"
```

---

### Task 3: Only clinics/labs in Libya, only doctors in Tunisia

**Files:**
- Modify: `packages/contracts/src/provider.ts`, `packages/contracts/src/provider.test.ts`
- Modify: `apps/api/src/modules/organisations/internal/organisations.controller.ts` (`createSchema`)
- Create: `apps/api/src/modules/organisations/create-kind.test.ts`
- Modify: `apps/web/app/signup/provider/page.tsx`
- Modify: `apps/web/lib/i18n/dictionary.ts`

**Interfaces:**
- Produces: `providerKindsForSide(side: EndpointSide): readonly ProviderKind[]`, `isKindAllowedOnSide(kind: ProviderKind, side: EndpointSide): boolean`.

- [ ] **Step 1: Failing contract test** — append to `packages/contracts/src/provider.test.ts` (merge the import into the existing one):

```ts
import { isKindAllowedOnSide, providerKindsForSide } from './provider';

describe('kinds per side (spec 2026-09-21 §2)', () => {
  it('lets only clinics and laboratories refer', () => {
    expect(providerKindsForSide('source')).toEqual(['clinic', 'laboratory']);
  });
  it('lets only doctors receive', () => {
    expect(providerKindsForSide('destination')).toEqual(['doctor']);
  });
  it('refuses a Libyan doctor, a Tunisian clinic, and hospitals', () => {
    expect(isKindAllowedOnSide('doctor', 'source')).toBe(false);
    expect(isKindAllowedOnSide('clinic', 'destination')).toBe(false);
    expect(isKindAllowedOnSide('hospital', 'source')).toBe(false);
    expect(isKindAllowedOnSide('hospital', 'destination')).toBe(false);
  });
});
```

Run: `cd packages/contracts && pnpm test -- provider` → FAIL (not exported).

- [ ] **Step 2: Implement** — in `provider.ts`, change the corridor import to `import { endpointSideSchema, type EndpointSide } from './corridor';` and add after `canProvisionClinicians`:

```ts
/**
 * Which kinds may register on which side — requirements §2 and spec
 * 2026-09-21 §2. Libya refers through clinics and laboratories; Tunisia
 * answers through individual doctors. Libyan doctors, Tunisian clinics, and
 * hospitals on either side cannot register.
 *
 * `PROVIDER_KINDS` keeps `hospital` and `doctor` so historical rows still
 * parse; this is the gate on NEW registrations.
 */
const KINDS_BY_SIDE: Record<EndpointSide, readonly ProviderKind[]> = {
  source: ['clinic', 'laboratory'],
  destination: ['doctor'],
};

export function providerKindsForSide(side: EndpointSide): readonly ProviderKind[] {
  return KINDS_BY_SIDE[side];
}

export function isKindAllowedOnSide(kind: ProviderKind, side: EndpointSide): boolean {
  return KINDS_BY_SIDE[side].includes(kind);
}
```

Confirm `packages/contracts/src/index.ts` re-exports `./provider`. Run `pnpm test && pnpm build` → PASS.

- [ ] **Step 3: API rejects a kind outside its side** — read `organisations.controller.ts` (constructor parameters, how `create` parses) and `apps/api/src/shared/errors/` (how a ZodError maps). Add to `createSchema`:

```ts
  .refine((v) => isKindAllowedOnSide(v.kind, v.side), {
    message: 'That kind of organisation cannot register on this side',
    path: ['kind'],
  })
```

If a thrown ZodError does not become a 400, switch `create` to `safeParse` and `throw new BadRequestException(parsed.error.issues[0]?.message)`. Create `create-kind.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OrganisationsController } from './internal/organisations.controller';

describe('POST /organisations kind gate (spec 2026-09-21 §2)', () => {
  // Only `create` is exercised; the service stub echoes a truthy value.
  const controller = new OrganisationsController({ create: async () => ({ id: 'x' }) } as never);
  const body = (kind: string, side: string) => ({
    kind, side, legalName: 'X', corridorId: 'ly-tn', credentials: {}, seatCount: 1,
  });

  it('refuses a Tunisian clinic', async () => {
    await expect(controller.create(body('clinic', 'destination'))).rejects.toThrow();
  });
  it('refuses a Libyan doctor', async () => {
    await expect(controller.create(body('doctor', 'source'))).rejects.toThrow();
  });
  it('accepts a Libyan laboratory and a Tunisian doctor', async () => {
    await expect(controller.create(body('laboratory', 'source'))).resolves.toBeDefined();
    await expect(controller.create(body('doctor', 'destination'))).resolves.toBeDefined();
  });
});
```

Adjust the constructor call to the real parameter list (`{} as never` for extra dependencies). Run: `cd apps/api && pnpm test -- create-kind` → PASS.

- [ ] **Step 4: Sign-up offers only the side's kinds** — in `signup/provider/page.tsx`: import `providerKindsForSide` (remove `PROVIDER_KINDS` if unused); in the side `onChange`, after `setSide(parsed.data)`, add `setKind(providerKindsForSide(parsed.data)[0] ?? 'clinic');`; the kind `<Select>` maps over `providerKindsForSide(side)`.

- [ ] **Step 5: Copy** — `grep -n -i "libyan doctor\|médecin libyen\|طبيب ليبي" apps/web/lib/i18n/dictionary.ts` and change each such role/side label to "Libyan clinic" / "Clinique libyenne" / "عيادة ليبية" (values only, never keys). Run `cd apps/web && pnpm test && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src apps/api/src/modules/organisations apps/web/app/signup/provider/page.tsx apps/web/lib/i18n/dictionary.ts
git commit -m "feat: only clinics/labs refer and only doctors receive"
```

---

### Task 4: The case DTO carries what the screens need; ops may read cases

**Files:**
- Modify: `apps/api/src/modules/cases/internal/cases.service.ts` (`CASE_COLUMNS`, `CaseRow`, `CaseSummary`, `toSummary`, `listCases`)
- Modify: `apps/api/src/modules/cases/internal/cases.controller.ts` (`CaseDto`, `toDto`, `@RequiresRole` on `list` and `get`)
- Test: `apps/api/src/modules/cases/cases-lifecycle.test.ts`
- Modify: `apps/web/lib/api/endpoints.ts`

**Interfaces:**
- Produces on `CaseDto`/`CaseRecord`: `caseRef: string`, `createdAt: string`, `updatedAt: string` (latest of created/quoted/accepted/answered/terminal), `quotedAt: string | null`, `patientAgeYears: number | null`, `patientSex: 'M' | 'F' | 'O' | null`. `api.imaging.studiesForCase(caseId)`, `api.ledger.forOrganisation(organisationId)`.

- [ ] **Step 1: Failing tests** — append to `cases-lifecycle.test.ts` (`createUser`/`seedDoctor`/`grantConsent` are already imported; check their signatures in `shared/db/testing/rls-harness.ts` and copy the quote-test setup lines already in this file for the receiver):

```ts
describe('what a case read carries (spec 2026-09-21 §9)', () => {
  it('has its reference and its instants', async () => {
    const { doctor, patient } = await lab();
    const item = await runWithContext(ctx(doctor, 'libya_doctor'), () =>
      cases.submit({ patientId: patient, specialty: 'radiology' }),
    );
    expect(item.caseRef).toMatch(/^MIR-\d{4}-\d{4,}$/);
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.updatedAt.getTime()).toBeGreaterThanOrEqual(item.createdAt.getTime());
  });

  it('is readable by ops, without the patient name', async () => {
    const { doctor, patient } = await lab();
    const item = await runWithContext(ctx(doctor, 'libya_doctor'), () =>
      cases.submit({ patientId: patient, specialty: 'radiology' }),
    );
    const ops = await createUser(h.owner, 'admin');
    const all = await runWithContext(ctx(ops, 'admin'), () => cases.listCases());
    expect(all.map((c) => c.id)).toContain(item.id);
    expect(all.find((c) => c.id === item.id)?.patientName).toBeNull();
  });
});
```

Run: `cd apps/api && pnpm test -- cases-lifecycle` → FAIL (`caseRef` undefined).

- [ ] **Step 2: Implement** —
  - `CASE_COLUMNS` gains `a.case_ref, a.created_at, a.quoted_at, GREATEST(a.created_at, a.quoted_at, a.accepted_at, a.answered_at, a.terminal_at) AS updated_at`.
  - `listCases` (non-assistant branch) adds `LEFT JOIN LATERAL cases_patient_brief(a.id) b ON true` and selects `b.age_years AS patient_age_years, b.sex AS patient_sex` exactly like `getCase`.
  - The two assistant-agenda SELECTs add `NULL::text AS case_ref, NULL::timestamptz AS created_at, NULL::timestamptz AS quoted_at, NULL::timestamptz AS updated_at` — unless `scheduling_assistant_agenda`'s RETURNS TABLE (migration 0025) already has `case_ref`, in which case select it.
  - `CaseRow` gains `case_ref: string | null; created_at: Date | null; quoted_at: Date | null; updated_at: Date | null`; `CaseSummary` gains `caseRef: string; createdAt: Date; quotedAt: Date | null; updatedAt: Date; patientAgeYears: number | null; patientSex: string | null`; `toSummary` maps them (`created_at ?? new Date(0)`, `updated_at ?? created_at ?? new Date(0)`, `case_ref ?? ''`).
  - Controller: `CaseDto` + `toDto` gain the six fields (ISO strings for dates, `null` passthrough); `'admin'` added to `@RequiresRole` on `list` and `get` only.

Run → PASS.

- [ ] **Step 3: Confidentiality check** — add to the same describe, building the quoted case with the same setup the existing quote tests use:

```ts
  it('never gives the receiving doctor the patient name or phone', async () => {
    const { doctor, patient } = await lab();
    const [receiver] = await seedAcceptingDoctors(h.owner, 'radiology', 1);
    await grantConsent(h.owner, patient, receiver!, doctor);
    const item = await runWithContext(ctx(doctor, 'libya_doctor'), () =>
      cases.submit({ patientId: patient, specialty: 'radiology' }),
    );
    await runWithContext(ctx(doctor, 'libya_doctor'), () => cases.quote(item.id, receiver!));
    const seen = await runWithContext(ctx(receiver!, 'tunisia_doctor'), () => cases.getCase(item.id));
    expect(seen.patientName).toBeNull();
    expect(seen.patientPhone).toBeUndefined();
  });
```

(Match `seedAcceptingDoctors`/`grantConsent` argument order to the harness.) Run → PASS.

- [ ] **Step 4: Mirror in the web client** — in `endpoints.ts`: `CaseRecord` gains `caseRef: string; createdAt: string; updatedAt: string; quotedAt: string | null;`. Add to `api.imaging`: `studiesForCase: (caseId: string) => apiFetch<{ studies: StudySummary[] }>(\`/studies?caseId=${encodeURIComponent(caseId)}\`)` (reuse the type `studiesForPatient` returns). Add a group `ledger: { forOrganisation: (organisationId: string) => apiFetch<{ entries: LedgerEntry[] }>(\`/ledger?organisationId=${encodeURIComponent(organisationId)}\`) }` (import `LedgerEntry` from `@mir/contracts`). Run `cd apps/web && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/cases apps/web/lib/api/endpoints.ts
git commit -m "feat(cases): case reads carry ref, instants and brief; ops may read"
```

---

### Task 5: The live `CasesApi`

**Files:**
- Modify: `apps/web/lib/api/cases.ts`
- Modify: `apps/web/lib/api/mock/mock-cases.ts`, `apps/web/lib/api/mock/index.ts`
- Create: `apps/web/lib/api/live/adapt.ts`, `apps/web/lib/api/live/adapt.test.ts`, `apps/web/lib/api/live/live-cases.ts`
- Modify: `apps/web/lib/provider/current-provider.ts`

**Interfaces:**
- Consumes: Task 4's `CaseRecord` fields, `api.imaging.studiesForCase`, `api.ledger.forOrganisation`, `api.organisations.mine/queue/decide/create`.
- Produces: `CasesApiSupports { messaging; fileAccessTrail; notifications; statusOverride }` on `CasesApi.supports`; `toCase(r: CaseRecord, corridorId: string): Case`; `toProvider(o: Organisation): Provider`; `timelineFor(r: CaseRecord): CaseEvent[]`; `findCaseRecord(refOrId: string): Promise<CaseRecord | null>`; `liveCasesApi: CasesApi`; `casesApi` = live unless mock mode.

- [ ] **Step 1: Failing adapter tests** — `apps/web/lib/api/live/adapt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { caseSchema } from '@mir/contracts';
import type { CaseRecord } from '../endpoints';
import { timelineFor, toCase } from './adapt';

const record: CaseRecord = {
  id: '0190a8f2-0000-7000-8000-000000000001',
  caseRef: 'MIR-2026-0001',
  patientId: '0190a8f2-0000-7000-8000-000000000002',
  patientName: null,
  patientAgeYears: 41,
  patientSex: 'F',
  doctorId: '0190a8f2-0000-7000-8000-000000000003',
  doctorName: 'Dr Karim Receiving',
  organisationId: '0190a8f2-0000-7000-8000-000000000004',
  specialty: 'radiology',
  status: 'accepted',
  reason: 'Headache, rule out mass',
  notes: null,
  quotedAmountMinor: 10000,
  quotedCurrency: 'USD',
  quotedAt: '2026-09-21T10:10:00.000Z',
  quoteExpiresAt: '2026-09-21T10:40:00.000Z',
  acceptedAt: '2026-09-21T11:00:00.000Z',
  answeredAt: null,
  answerDueAt: '2026-09-24T11:00:00.000Z',
  createdAt: '2026-09-21T10:00:00.000Z',
  updatedAt: '2026-09-21T11:00:00.000Z',
  studyIds: ['0190a8f2-0000-7000-8000-000000000005'],
};

describe('toCase', () => {
  it('produces a valid contract Case', () => {
    expect(() => caseSchema.parse(toCase(record, 'ly-tn'))).not.toThrow();
  });
  it('carries the reference, the specialty and the reason in intake', () => {
    const c = toCase(record, 'ly-tn');
    expect(c.ref).toBe('MIR-2026-0001');
    expect(c.intake).toMatchObject({ specialty: 'radiology', referralReason: 'Headache, rule out mass' });
  });
  it('never puts a patient name into intake', () => {
    const c = toCase({ ...record, patientName: 'Sample Patient' }, 'ly-tn');
    expect(JSON.stringify(c.intake)).not.toContain('Sample Patient');
  });
});

describe('timelineFor', () => {
  it('lists the steps that have happened, oldest first', () => {
    expect(timelineFor(record).map((e) => e.to)).toEqual(['submitted', 'quoted', 'accepted']);
    expect(timelineFor(record)[1]?.occurredAt).toBe('2026-09-21T10:10:00.000Z');
  });
});
```

Run: `cd apps/web && pnpm test -- adapt` → FAIL (module missing).

- [ ] **Step 2: Implement `adapt.ts`** — read `Organisation` in `endpoints.ts` and `providerSchema` in `packages/contracts/src/provider.ts` first, and make `toProvider` a field-for-field mapping between them (the field names below are the expected ones; correct any that differ and remove the cast once they line up):

```ts
import type { Case, CaseEvent, CaseStatus, Provider } from '@mir/contracts';
import type { CaseRecord, Organisation } from '../endpoints';

/**
 * The real API speaks `CaseRecord` (one row of `cases_cases`); the case screens
 * were built against the contract `Case`. These adapters are the whole
 * translation, and they are pure so they can be tested without a network.
 *
 * `intake` carries only the clinical request. The patient's name is never
 * copied into it: a screen that rendered `intake` generically would otherwise
 * print it to a doctor (requirements §7).
 */
export function toCase(r: CaseRecord, corridorId: string): Case {
  return {
    ref: r.caseRef,
    corridorId,
    status: r.status,
    submittedByProviderId: r.organisationId,
    ...(r.doctorId === null ? {} : { matchedProviderId: r.doctorId }),
    patientId: r.patientId,
    patientAgeYears: r.patientAgeYears ?? null,
    patientSex: (r.patientSex as Case['patientSex']) ?? null,
    studyIds: r.studyIds,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    intake: {
      specialty: r.specialty,
      ...(r.reason === null ? {} : { referralReason: r.reason }),
      ...(r.notes === null ? {} : { notes: r.notes }),
    },
  };
}

export function toProvider(o: Organisation): Provider {
  return {
    id: o.id,
    kind: o.kind,
    legalName: o.legalName,
    corridorId: o.corridorId,
    side: o.side,
    seatCount: o.seatCount,
    verification: {
      status: o.verificationStatus,
      submittedAt: o.submittedAt,
      ...(o.decidedAt === null ? {} : { decidedAt: o.decidedAt }),
      ...(o.reasonKey === null ? {} : { reasonKey: o.reasonKey }),
      credentials: o.credentials,
    },
  } as Provider;
}

/**
 * A timeline derived from the case's own instants. There is no event table
 * behind the real API; these are the transitions the row timestamps.
 */
export function timelineFor(r: CaseRecord): CaseEvent[] {
  const steps: { to: CaseStatus; at: string | null }[] = [
    { to: 'submitted', at: r.createdAt },
    { to: 'quoted', at: r.quotedAt },
    { to: 'accepted', at: r.acceptedAt },
    { to: 'answered', at: r.answeredAt },
  ];
  let from: CaseStatus | null = null;
  const events: CaseEvent[] = [];
  for (const s of steps) {
    if (s.at === null) continue;
    events.push({
      id: `${r.id}:${s.to}`,
      caseRef: r.caseRef,
      occurredAt: s.at,
      actorDisplayName: s.to === 'accepted' || s.to === 'answered' ? (r.doctorName ?? '—') : '—',
      actorSide: s.to === 'accepted' || s.to === 'answered' ? 'destination' : 'source',
      from,
      to: s.to,
    });
    from = s.to;
  }
  return events;
}
```

Run: `pnpm test -- adapt` → PASS.

- [ ] **Step 3: `supports` on the interface** — in `lib/api/cases.ts` add, and make `readonly supports: CasesApiSupports;` the first member of `CasesApi`:

```ts
/**
 * What this implementation can actually do. The live API has no messaging,
 * per-file access trail, in-app notifications, or ops status override yet;
 * screens hide those panels rather than show a thread that vanishes on reload.
 */
export interface CasesApiSupports {
  messaging: boolean;
  fileAccessTrail: boolean;
  notifications: boolean;
  statusOverride: boolean;
}
```

In `mock-cases.ts` add `supports: { messaging: true, fileAccessTrail: true, notifications: true, statusOverride: true },` to the exported object.

- [ ] **Step 4: Implement `live-cases.ts`** — read the full `CasesApi` interface first; every member not listed below (e.g. draft methods) gets the same "empty result / not supported" treatment:

```ts
import type { CasesApi } from '../cases';
import { api, type CaseRecord } from '../endpoints';
import { DEFAULT_CORRIDOR_ID } from '../../corridor/registry';
import { timelineFor, toCase, toProvider } from './adapt';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route params are a case id (the doctor inbox links by id) or a reference
 * (the case list links by ref). Both resolve here; an unknown one is null,
 * exactly like a case the caller may not see.
 */
export async function findCaseRecord(refOrId: string): Promise<CaseRecord | null> {
  if (UUID.test(refOrId)) {
    try {
      return await api.cases.get(refOrId);
    } catch {
      return null;
    }
  }
  const { cases } = await api.cases.list();
  return cases.find((c) => c.caseRef === refOrId) ?? null;
}

export const liveCasesApi: CasesApi = {
  supports: { messaging: false, fileAccessTrail: false, notifications: false, statusOverride: false },

  async listCases(query) {
    const { cases } = await api.cases.list({
      ...(query.updatedFrom === undefined ? {} : { from: query.updatedFrom }),
      ...(query.updatedTo === undefined ? {} : { to: query.updatedTo }),
    });
    const search = query.search?.trim().toUpperCase();
    return cases
      .filter((c) => query.status === undefined || c.status === query.status)
      .filter((c) => search === undefined || search === '' || c.caseRef.includes(search))
      .map((c) => toCase(c, DEFAULT_CORRIDOR_ID));
  },

  async getCase(refOrId) {
    const r = await findCaseRecord(refOrId);
    return r === null ? null : toCase(r, DEFAULT_CORRIDOR_ID);
  },

  async listCaseEvents(refOrId) {
    const r = await findCaseRecord(refOrId);
    return r === null ? [] : timelineFor(r);
  },

  async listFileAccess() {
    return [];
  },

  async submitCase() {
    // The live flow submits through api.cases.submit (specialty + studies),
    // which the new-case screen calls directly. This contract shape carries
    // neither, so it is not a path to a real case.
    throw new Error('submitCase is not supported by the live API; use api.cases.submit');
  },

  async changeCaseStatus() {
    throw new Error('Status override is not supported by the live API');
  },

  async listLedger(organisationId) {
    return (await api.ledger.forOrganisation(organisationId)).entries;
  },

  async listAllLedger() {
    const { organisations } = await api.organisations.queue();
    return Promise.all(
      organisations.map(async (o) => ({
        providerId: o.id,
        entries: (await api.ledger.forOrganisation(o.id)).entries,
      })),
    );
  },

  async listMessages() {
    return [];
  },
  async sendMessage() {
    throw new Error('Messaging is not supported by the live API');
  },
  async listNotifications() {
    return [];
  },
  async markNotificationRead() {},

  async getProvider(id) {
    const { organisation } = await api.organisations.mine();
    return organisation !== null && organisation.id === id ? toProvider(organisation) : null;
  },

  async listProviders() {
    return (await api.organisations.queue()).organisations.map(toProvider);
  },

  async listVerificationQueue() {
    const { organisations } = await api.organisations.queue();
    return organisations.filter((o) => o.verificationStatus === 'pending').map(toProvider);
  },

  async registerProvider(input) {
    return toProvider(await api.organisations.create(input));
  },

  async decideVerification(id, approve, reasonKey) {
    await api.organisations.decide(id, approve, reasonKey);
    const found = (await api.organisations.queue()).organisations.find((o) => o.id === id);
    if (found === undefined) throw new Error('Organisation not found after decision');
    return toProvider(found);
  },

  async listAllCases(status) {
    const { cases } = await api.cases.list();
    return cases
      .filter((c) => status === undefined || c.status === status)
      .map((c) => toCase(c, DEFAULT_CORRIDOR_ID));
  },
};
```

Check what `GET /admin/organisations` returns (read the organisations service query). If it returns only pending organisations, add `GET /admin/organisations?status=all` (admin-only, with a test beside `create-kind.test.ts`) and call it from `listProviders` and `listAllLedger` via a new `api.organisations.all()`.

- [ ] **Step 5: Select live vs mock** — replace `lib/api/mock/index.ts`'s export:

```ts
import type { CasesApi } from '../cases';
import { isMockMode } from '../cases';
import { liveCasesApi } from '../live/live-cases';
import { mockCasesApi } from './mock-cases';

/**
 * The case layer. LIVE by default: `isMockMode()` is true only when
 * NEXT_PUBLIC_MIR_API_MODE=mock, so a missing variable can never serve
 * fixtures to a clinic. The screens import `casesApi` and do not change.
 */
export const casesApi: CasesApi = isMockMode() ? mockCasesApi : liveCasesApi;
```

- [ ] **Step 6: The current provider is the caller's own organisation** — in `current-provider.ts`: keep `PROVIDER_BY_SIDE`/`providerIdForRole` for mock mode. Hold `providerId` in state. In the effect: if `side === 'ops'` → `{ provider: null, providerId: null, loading: false }` with no request; else if `isMockMode()` → current behaviour; else `api.organisations.mine().then(({ organisation }) => { setProvider(organisation === null ? null : toProvider(organisation)); setProviderId(organisation?.id ?? null); setLoading(false); }).catch(() => { setProvider(null); setProviderId(null); setLoading(false); })`, with the existing `cancelled` guard. Effect deps: `[role]`.

- [ ] **Step 7: Run everything** — `cd apps/web && pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS. If a test imports `casesApi` from `mock/index` expecting fixtures, point it at `mockCasesApi`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/api apps/web/lib/provider
git commit -m "feat(web): live CasesApi behind the existing seam; mock only on request"
```

---

### Task 6: A clinic can create, quote and pay a real case

**Files:**
- Modify: `packages/contracts/src/case.ts`, `packages/contracts/src/case.test.ts`
- Modify: `apps/web/app/cases/new/page.tsx`
- Modify: `apps/web/app/cases/[ref]/pick-doctor/page.tsx`
- Modify: `apps/web/lib/i18n/dictionary.ts`

**Interfaces:**
- Produces: `CONSULT_SPECIALTIES`, `type ConsultSpecialty`; dictionary keys `specialtyRadiology`, `specialtyCardiology`, `specialtyNeurology`, `specialtyOncology`, `caseNewSpecialty`, `caseNewStudies`, `caseNewNoStudies`, `pickDoctorPay`, `pickDoctorQuoteLapsed` (if absent).

- [ ] **Step 1: Contract + test** — in `case.ts`:

```ts
/**
 * The specialties a case can ask for. Lowercase KEYS — the rate card, the
 * doctor profile and the directory compare them exactly, and `Radiology` vs
 * `radiology` is precisely the mismatch that hid doctors from clinics.
 */
export const CONSULT_SPECIALTIES = ['radiology', 'cardiology', 'neurology', 'oncology'] as const;
export type ConsultSpecialty = (typeof CONSULT_SPECIALTIES)[number];
```

In `case.test.ts`:

```ts
import { CONSULT_SPECIALTIES } from './case';

it('specialty keys are lowercase', () => {
  expect(CONSULT_SPECIALTIES.every((s) => s === s.toLowerCase())).toBe(true);
});
```

Run `cd packages/contracts && pnpm test && pnpm build` → PASS.

- [ ] **Step 2: New-case form submits a real case** — in `cases/new/page.tsx` (read `StudySummary` in `endpoints.ts` for its field names first):
  - add `const router = useRouter();` (`next/navigation`), `const [specialty, setSpecialty] = useState<ConsultSpecialty>('radiology');`, `const [studies, setStudies] = useState<StudySummary[]>([]);`, `const [studyIds, setStudyIds] = useState<string[]>([]);`
  - effect on `patientId`: when `''`, clear both; else `api.imaging.studiesForPatient(patientId).then(({ studies: rows }) => { setStudies(rows); setStudyIds(rows.map((s) => s.id)); }).catch(() => { setStudies([]); setStudyIds([]); })`
  - render after the patient field: a specialty `Select` (`data-testid="field-specialty"`) over `CONSULT_SPECIALTIES` with labels `specialtyRadiology`…; then a `<fieldset>` titled `t.caseNewStudies` with one checkbox per study (`data-testid="field-study"`, toggling membership in `studyIds`), or `t.caseNewNoStudies` plus a link to `/upload` when empty.
  - `submit` body becomes:

```ts
      const notes = [
        values['urgency'] ? `urgency: ${values['urgency']}` : null,
        values['preferredDate'] ? `preferred: ${values['preferredDate']}` : null,
      ]
        .filter((v): v is string => v !== null)
        .join(' · ');
      const created = await api.cases.submit({
        patientId,
        specialty,
        studyIds,
        ...(values['referralReason'] ? { reason: values['referralReason'] } : {}),
        ...(notes === '' ? {} : { notes }),
      });
      window.localStorage.removeItem(DRAFT_KEY);
      router.push(`/cases/${created.id}/pick-doctor`);
```

  - remove the `submitted` state, the success screen, and the `casesApi` import; `submit` no longer needs `providerId`.

- [ ] **Step 3: Pay on the quoted state** — in `pick-doctor/page.tsx` add `const [paying, setPaying] = useState(false);` and

```ts
  const pay = async (): Promise<void> => {
    setPaying(true);
    setError(null);
    try {
      await api.cases.pay(caseId);
      router.push(`/cases/${caseId}`);
    } catch (err) {
      // 409: the quote lapsed. Reload so the lab re-picks at a fresh price.
      setError(isConflict(err) ? t.pickDoctorQuoteLapsed : t.genericError);
      await load();
    } finally {
      setPaying(false);
    }
  };
```

and inside the quoted `<Card>`, after the `<dl>`:

```tsx
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="primary" data-testid="pay-case" disabled={paying} onClick={() => void pay()}>
              {t.pickDoctorPay}
            </Button>
          </div>
```

- [ ] **Step 4: Dictionary** — add the Interfaces keys to ar, fr and en (en: "Radiology", "Cardiology", "Neurology", "Oncology", "Specialty", "Studies to send", "This patient has no uploaded studies yet.", "Pay and send to the doctor", "This price has expired. Choose the doctor again for a fresh quote."). Run `cd apps/web && pnpm test && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/case.ts packages/contracts/src/case.test.ts apps/web/app/cases apps/web/lib/i18n/dictionary.ts
git commit -m "feat(web): clinics submit, quote and pay real cases"
```

---

### Task 7: The case page works for both sides

**Files:**
- Modify: `apps/web/app/cases/[ref]/page.tsx`
- Modify: `apps/web/lib/i18n/dictionary.ts`

**Interfaces:**
- Consumes: `casesApi.supports`, `findCaseRecord`, `api.imaging.studiesForCase`, `api.cases.accept/decline`, `isMockMode`.
- Produces: dictionary keys `caseNextPickDoctor`, `caseNextPay`, `caseOpenStudy`, `colNotes` (if absent).

- [ ] **Step 1: Studies by UID** — add `const [record, setRecord] = useState<CaseRecord | null>(null);` and `const [studies, setStudies] = useState<StudySummary[]>([]);`. In `load`, when `!isMockMode()`: `const r = await findCaseRecord(caseRef); setRecord(r); if (r !== null) setStudies((await api.imaging.studiesForCase(r.id)).studies);`. The files card renders from `studies` in live mode (each row: description or modality, study date, and `<Link href={\`/viewer/${s.studyInstanceUid}\`}>{t.caseOpenStudy}</Link>`), and from `item.studyIds` only in mock mode. `FileAccessNote` renders only when `casesApi.supports.fileAccessTrail`. The upload button renders only for `side === 'source'`.

- [ ] **Step 2: The next step is a button** — below the `next-action` alert:

```tsx
      {side === 'source' && record !== null && (item.status === 'submitted' || item.status === 'declined') && (
        <Link href={`/cases/${record.id}/pick-doctor`} className={buttonVariants()} data-testid="next-pick-doctor">
          {t.caseNextPickDoctor}
        </Link>
      )}
      {side === 'source' && record !== null && item.status === 'quoted' && (
        <Link href={`/cases/${record.id}/pick-doctor`} className={buttonVariants()} data-testid="next-pay">
          {t.caseNextPay}
        </Link>
      )}
      {side === 'destination' && record !== null && item.status === 'paid' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" data-testid="accept-case" disabled={acting} onClick={() => void act('accept')}>
            {t.inboxAccept}
          </Button>
          <Button data-testid="decline-case" disabled={acting} onClick={() => void act('decline')}>
            {t.inboxDecline}
          </Button>
        </div>
      )}
```

with `const [acting, setActing] = useState(false);` and

```ts
  const act = async (what: 'accept' | 'decline'): Promise<void> => {
    if (record === null) return;
    setActing(true);
    setError(null);
    try {
      if (what === 'accept') await api.cases.accept(record.id);
      else await api.cases.decline(record.id);
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setActing(false);
    }
  };
```

The `accepted` state keeps using the inbox's Answer button until Plan 3 replaces it with the report workspace.

- [ ] **Step 3: Hide what has no backend** — wrap the messages `<Card>` in `{casesApi.supports.messaging && (…)}` and skip the `listMessages`/`listFileAccess` calls when unsupported.

- [ ] **Step 4: Intake keys read as labels** — the intake `<dl>` renders raw keys. Map `specialty → t.caseNewSpecialty` (value through the specialty labels), `referralReason → t.fieldReferralReason`, `notes → t.colNotes`; any other key renders as-is.

- [ ] **Step 5: Dictionary + checks** — add the Interfaces keys (en: "Choose a doctor", "Review price and pay", "Open study", "Notes"). Run `cd apps/web && pnpm test && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 6: Verify in the browser** (runbook): as `dev-receiver`, `/doctor` → click the `seed:accepted` row → case page loads, shows the MR study, "Open study" → `/viewer/<uid>`. On the `seed:paid` case, Accept works and the page moves to accepted. As `dev-doctor`, `/cases` lists 5 cases, `seed:submitted` offers "Choose a doctor", which lists Karim at a price; choosing then paying lands on the case page as `paid`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/cases apps/web/lib/i18n/dictionary.ts
git commit -m "feat(web): case page reads the real case and its studies and offers the next step"
```

---

### Task 8: Notifications off the nav; ops screens without fake controls

**Files:**
- Modify: nav source (`grep -rn "'/notifications'" apps/web/components apps/web/lib`)
- Modify: `apps/web/app/notifications/page.tsx`
- Modify: `apps/web/app/admin/cases/page.tsx`
- Modify: `apps/web/lib/i18n/dictionary.ts` (`notificationsByEmail`)

- [ ] **Step 1:** Remove the notifications nav entry. In the notifications page, when `!casesApi.supports.notifications`, render only the `PageHeader` and `<Alert tone="info">{t.notificationsByEmail}</Alert>` (en: "Notifications are sent to your email address."; fr/ar translated) and make no request; keep the list for mock mode.
- [ ] **Step 2:** In `admin/cases/page.tsx`, render the status-change controls only when `casesApi.supports.statusOverride`.
- [ ] **Step 3: Click-through** — with the stack running, sign in as `dev-doctor`, `dev-receiver`, and `dev-ops` and open every sidebar link. For each page record: loads, no Chrome console error, no request left pending, data shown. Fix any page that errors before committing; list anything deferred in the commit body.
- [ ] **Step 4: Run and commit**

```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm lint
git add apps/web
git commit -m "feat(web): notifications by email; ops screens without unsupported controls"
```

---

### Task 9: The viewer stops hanging

**Files:**
- Create: `apps/web/lib/viewer/with-timeout.ts`, `apps/web/lib/viewer/with-timeout.test.ts`
- Modify: `apps/web/app/viewer/[studyUid]/page.tsx` (the step-4 effect)
- Modify: `apps/web/lib/i18n/dictionary.ts` (`viewerFullTimeout`)

**Interfaces:**
- Produces: `withTimeout<T>(promise: Promise<T>, ms: number): Promise<T>` rejecting with `Error('timeout')`.

- [ ] **Step 1: Failing test** — `with-timeout.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './with-timeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves when the promise wins', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });
  it('rejects with "timeout" when the clock wins', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 50);
    vi.advanceTimersByTime(51);
    await expect(pending).rejects.toThrow('timeout');
  });
  it('passes the original rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
});
```

Run `cd apps/web && pnpm test -- with-timeout` → FAIL.

- [ ] **Step 2: Implement**

```ts
/** Reject with Error('timeout') if `promise` has not settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
```

Run → PASS.

- [ ] **Step 3: Fix the effect** — replace the step-4 effect with one that depends on nothing it sets:

```tsx
  const upgradeStarted = useRef(false);
  const [upgradeTimedOut, setUpgradeTimedOut] = useState(false);
  const instancesRef = useRef<Instance[]>([]);
  instancesRef.current = instances;
  const currentRef = useRef(0);
  currentRef.current = current;

  // --- step 4: upgrade to full fidelity, ONCE, after the thumbnail is up ------
  //
  // It depends on nothing it sets. The previous version listed `fidelity` in
  // its own dependencies and set it to 'loading-full': the re-run cancelled the
  // first run, the second returned early, and the page sat on "Loading full
  // resolution…" forever with the Cornerstone canvas at opacity 0.
  useEffect(() => {
    if (!firstImageReady || upgradeStarted.current) return;
    upgradeStarted.current = true;
    if (!canRenderFullFidelity()) {
      setFidelity('unavailable');
      return;
    }
    let cancelled = false;
    setFidelity('loading-full');
    void (async () => {
      try {
        const { createViewer } = await import('../../../lib/viewer/cornerstone');
        const element = viewportRef.current;
        if (cancelled || element === null) return;
        const viewer = await withTimeout(createViewer({ element, studyUid }), 15_000);
        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;
        const first = instancesRef.current[currentRef.current];
        if (first !== undefined) {
          await withTimeout(viewer.showInstance(first.sopInstanceUid), 15_000);
        }
        if (!cancelled) setFidelity('full');
      } catch (err) {
        if (cancelled) return;
        setUpgradeTimedOut(err instanceof Error && err.message === 'timeout');
        setFidelity('unavailable');
      }
    })();
    return () => {
      // Strict mode runs effects twice in development; letting the second run
      // start is what keeps exactly one engine alive.
      cancelled = true;
      upgradeStarted.current = false;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [firstImageReady, studyUid]);
```

Import `withTimeout`. The navigation effect (`[current, fidelity, instances]`) stays. Under the fidelity badge, when `upgradeTimedOut`: `<p role="status" className="text-sm text-muted-foreground">{t.viewerFullTimeout}</p>` (en: "Full resolution took too long; showing the preview."; fr/ar translated). The separate unmount-only destroy effect can stay; destroying twice is already guarded in `cornerstone.ts`.

- [ ] **Step 4: Verify in the browser** — as `dev-receiver`, open `/viewer/<seeded uid>`: thumbnail, then "Loading full resolution…" → "Full resolution" within a few seconds; canvas visible; Next/Prev walk 24 slices; exactly one `<canvas>` inside `[data-testid=cornerstone-viewport]`. Same as `dev-doctor`. Put the time-to-full in the commit body.
- [ ] **Step 5: Run and commit**

```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm lint
git add apps/web/app/viewer apps/web/lib/viewer apps/web/lib/i18n/dictionary.ts
git commit -m "fix(viewer): the full-resolution upgrade no longer cancels itself"
```

---

## Runbook: the local stack for this plan

The API cannot run under `pnpm dev` (tsx drops decorator metadata). Build and run `dist/main.js` with host overrides kept OUTSIDE the repo (`$SCRATCH/api-env.sh`, which sources `.env` then sets `PORT=3100`, `DATABASE_URL`/`DATABASE_MIGRATOR_URL` → `127.0.0.1:5433`, `REDIS_URL` → `127.0.0.1:6379`, `KEYCLOAK_*` → `localhost:8081`, `ORTHANC_URL` → `127.0.0.1:8042`, `SIGNED_URL_SECRET`, `LOCAL_STORAGE_ROOT` → a scratch dir):

```bash
docker compose up -d postgres redis orthanc keycloak
. "$SCRATCH/api-env.sh"
pnpm --filter @mir/contracts build && pnpm --filter @mir/api build
(cd apps/api && node dist/shared/db/migrate-cli.js up)
docker exec mir-postgres psql -U postgres -d mir -c "ALTER ROLE mir_app LOGIN PASSWORD '$MIR_APP_DEV_PASSWORD'"
node apps/api/dist/main.js                                  # background
node scripts/dev-bootstrap.mjs && node scripts/dev-seed-imaging.mjs
(cd apps/web && API_ORIGIN=http://127.0.0.1:3100 pnpm dev)  # background → http://localhost:3001
```

Dev accounts: `dev-doctor@example.test / dev-doctor-pass-1234` (Libyan clinic), `dev-receiver@example.test / dev-receiver-pass-1234` (Tunisian doctor, accepting), `dev-radiologist@example.test / dev-radio-pass-1234`, `dev-cardio@example.test / dev-cardio-pass-1234`, `dev-ops@example.test / dev-ops-pass-1234`, `dev-applicant@example.test / dev-applicant-pass-1234`, `dev-assistant@example.test / dev-assist-pass-1234`.

---

## Execution notes (completed 2026-09-23)

All nine tasks landed on `feat/frontend-uplift`. Executing them against a real
browser surfaced four root causes the plan did not anticipate; each was fixed in
its own commit because each alone was enough to make "the MRI never opens":

| Found while | Root cause | Fix |
|---|---|---|
| Task 1 (imaging seed) | **Nothing consumed the `imaging` queue and nothing called `IngestionService.ingestFile`.** Verified uploads sat in staging forever: no study, nothing in Orthanc, no twin. | `ImagingWorker` (in-process, `IMAGING_WORKER_ENABLED`, default on); `POST /uploads/files/:id/complete` enqueues `imaging.ingestFile`. |
| Task 1 (doctor read) | **Metadata and frame proxies omitted the series.** Orthanc's WADO-RS 404s `/studies/{s}/instances/{i}`; full resolution never worked for anyone. | Routes and Cornerstone image ids carry `/series/{se}/`. |
| Task 9 (browser walk) | **The viewer never sent the bearer token.** It relied on a session cookie this stack never sets (`fetch` with `credentials`, `<img src>`, Cornerstone XHR), so every DICOMweb request 401'd. | `lib/viewer/authed-fetch.ts`; preview fetched as an authenticated blob; loader `beforeSend` returns the header (its streaming path passes `xhr = null`). |
| Task 7 (browser walk) | **`useCaseAudience` returned a new object every render**, so the case page's load effect re-ran forever — hundreds of requests a second. This is the "see details freezes the browser" report. | `useMemo`. Idle API calls on the case page went from hundreds to 0. |

Measured on the seeded MR series as the receiving doctor, before → after:
case page "not found" → 0.19 s; Open-study click ~15 s → 0.09 s; first image
never → 0.28 s; full resolution never → 1.3 s.

**Browser sweep:** 27 sidebar pages as clinic, doctor and ops — each under
100 ms, no console errors, no failed API calls, no idle API traffic.
**Suites:** API 400 passed / 2 skipped; web unit 356; Playwright 63 passed,
42 skipped (the landing suite, parked by design).

**Open, needs an owner decision — the session does not survive a reload.**
The access token lives in memory only (`lib/api/client.ts`, deliberately, so an
XSS cannot lift it from storage), and the password sign-in has no silent
refresh. Any browser refresh, pasted URL, or new tab signs the user out. A fix
that keeps the token out of script-readable storage is an httpOnly refresh
cookie set by `/auth/password-login` plus a `/auth/session` route that mints a
fresh access token on load. Not done here because it changes the security model.

**Deferred to Plan 4 (UI pass):** the clinic workspace's "tasks for you" list
includes cases that are waiting on the doctor.
