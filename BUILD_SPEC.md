# Cross-Border Medical Imaging Transfer Platform — Build Specification

**Route:** Libya → Tunisia
**Purpose:** Transfer patient MRI/CT (scanner) imaging from a referring doctor in Libya to a receiving doctor in Tunisia, and let the patient book an appointment with that Tunisian doctor.

This document is the complete build instruction set. It is written to be executed step by step. **Every step ends with a verification gate. Do not begin a step until the previous gate passes.**

---

## 0. How to use this document

- Steps are numbered `P<phase>.<step>`.
- Each step has: **Goal**, **Do**, **Verify**, **Gate**.
- **Gate** is a hard stop. If the gate fails, fix it before moving on. Do not batch multiple steps and test at the end.
- Anything marked **BLOCKING (LEGAL)** must be resolved by a human with local legal counsel. An agent must not decide these.
- Anything marked **DECISION** requires a human product decision; the agent should stop and ask.

---

## 1. Product scope

### 1.1 In scope (v1)

| Actor | Capability |
|---|---|
| Libyan lab / clinic | Register/log in, create or find a patient, upload DICOM studies, submit a case, browse the doctors accepting work, choose one and pay the price the platform quotes |
| Tunisian doctor | Register/log in, switch availability on or off, read the summary of a case sent to them, accept or decline it, and view the **de-identified** linked studies for the ones they accepted — never the patient's identity (sub-project 2, decisions S1–S5) |
| Platform admin | Manage doctor verification, view audit logs, handle support — **no routine access to patient images** |

**There is no patient account.** Migration 0021 removed it: the Libyan clinic
attests the patient's consent and holds the identity, and the patient never
logs in. **There is no calendar.** Migration 0025 removed slots, availability
windows and booking — a lab does not reserve a time, it sends a case to a
doctor who is taking work.

### 1.2 Explicitly out of scope (v1)

- Full medical records (labs, medications, diagnoses). **Imaging only.** No HL7/FHIR needed in v1.
- Diagnostic-grade image reading. The in-app viewer is **reference only**.
- Direct hospital PACS integration (v2 candidate — design for it, don't build it).
- Video consultation.

### 1.3 Non-negotiable product positioning

The platform is a **transfer and coordination service**, not a diagnostic tool. The receiving doctor performs the diagnostic read on their own validated equipment. This must appear in:
- Terms of service
- A persistent banner in the viewer UI: *"Reference viewing only — not for diagnostic use"*
- Marketing material

**Rationale:** products that let clinicians diagnose from an uncertified viewer fall into medical-device regulation. Staying on the transfer side of that line is a deliberate design constraint, not a disclaimer.

---

## 2. BLOCKING (LEGAL) prerequisites

**These must be resolved before writing production code that touches real patient data.** Development against synthetic data may proceed in parallel.

| # | Item | Who resolves |
|---|---|---|
| L1 | Lawful basis and mechanism for transferring health data out of Libya and into Tunisia | Local counsel, both jurisdictions |
| L2 | Tunisian data protection registration/authorisation (INPDP regime) — confirm what is required for processing and for cross-border receipt | Tunisian counsel |
| L3 | If hosting in the EU: confirm GDPR implications of processing non-EU patient data on EU soil, and the DPA needed with the cloud provider | Counsel |
| L4 | Required content and form of patient consent for cross-border transfer (must it be written? Arabic? witnessed?) | Counsel |
| L5 | Medical records retention period obligations in both countries | Counsel |
| L6 | Whether a Tunisian doctor reviewing images before the patient physically arrives constitutes regulated telemedicine | Tunisian medical council / counsel |
| L7 | Payment rails: whether a Libyan payer can lawfully and practically pay a Tunisian-facing platform; sanctions and currency-control screening | Financial/legal advisor + payment provider |
| L8 | Breach notification obligations and deadlines in both jurisdictions | Counsel |

**Agent instruction:** if asked to implement consent, retention, or payment flows, implement them as **configurable** (retention period as config, consent text as versioned content) so that legal answers can be applied without a rewrite.

---

## 3. Architecture decisions

These are settled. Do not revisit without an explicit human decision.

### ADR-1 — Modular monolith, not microservices
A single deployable application with strictly enforced internal module boundaries.

**Why:** the stated requirement is "add features without breaking others". That comes from clean domain boundaries, not from separate deployments. Microservices would add distributed transactions and network failure modes — new ways to lose or mis-route a scan — for a small team.

**Enforcement:** CI fails the build if one module imports another's internals. See P1.4.

**Exit path:** a module may be extracted into its own service later once its boundary is stable and it demonstrably needs independent scaling.

### ADR-2 — DICOM is the only imaging format accepted in v1
Accept `.dcm` / extensionless DICOM. Reject everything else at upload. NIfTI and other research formats are out of scope.

### ADR-3 — Orthanc as the DICOM server
Do not hand-roll DICOM storage, indexing, or DICOMweb. Orthanc is open-source, provides QIDO-RS / WADO-RS / STOW-RS, and has an object-storage plugin.

### ADR-4 — Original bytes are immutable
The uploaded DICOM file is stored byte-for-byte, versioned, and protected by object-lock. Derived artifacts (thumbnails, previews) are separate objects. **Never re-encode pixel data.**

### ADR-5 — Compression is container-level only
Gzip in transit and optionally at rest. **Never** transcode to a lossy DICOM transfer syntax. Lossy transcoding discards diagnostic information and requires specific DICOM metadata flagging; it is out of scope entirely.

### ADR-6 — Defence in depth on access control
Authorization is enforced at **two independent layers**: application-level RBAC and PostgreSQL row-level security. A bug in one must not expose data.

### ADR-7 — Real patient data never leaves production
Staging, dev, and CI use synthetic DICOM only. No exceptions, no "just this once" copies.

---

## 4. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Language/runtime | TypeScript, Node.js 20 LTS | |
| Backend framework | NestJS | Module system enforces boundaries structurally |
| Database | PostgreSQL 16 (managed) | Row-level security required |
| ORM / migrations | Prisma **or** Drizzle + raw SQL for RLS policies | RLS policies must be in versioned migrations |
| DICOM server | Orthanc + `orthanc-object-storage` plugin + DICOMweb plugin | |
| Object storage | S3 (SSE-KMS, versioning, Object Lock) | |
| Cache / queue | Redis + BullMQ | |
| Auth | Keycloak (self-hosted) | Self-hosting avoids adding a processor to the compliance chain |
| Frontend | Next.js (App Router) + React | |
| DICOM viewer | Cornerstone3D | Reference viewing only |
| Resumable upload | `tus` protocol (tus-js-client + tusd) **or** S3 multipart with presigned parts | See P7 |
| Edge | Cloudflare (WAF, TLS, CDN, rate limiting) | |
| IaC | Terraform | No console clicks in any environment |
| CI/CD | GitHub Actions | |
| Observability | OpenTelemetry, Sentry, structured JSON logs | |
| Region | `eu-south-1` (Milan) primary; fall back to `eu-west-3` (Paris) if service coverage is insufficient | Closest to Tunis |
| DR region | A second EU region for S3 replication and DB backup copies | |

---

## 5. Repository structure

```
/
├── apps/
│   ├── api/                    # NestJS modular monolith
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── identity/   # users, doctors, sessions, MFA
│   │       │   ├── patients/   # patient records, identity matching
│   │       │   ├── consent/    # consent capture and versioning
│   │       │   ├── imaging/    # uploads, studies, DICOM orchestration
│   │       │   ├── scheduling/ # availability, appointments
│   │       │   ├── billing/    # payments, invoices
│   │       │   ├── audit/      # append-only access log
│   │       │   └── notifications/
│   │       ├── shared/         # cross-cutting: config, errors, event bus
│   │       └── main.ts
│   └── web/                    # Next.js frontend
├── packages/
│   ├── contracts/              # shared DTO types between api and web
│   └── dicom-utils/            # validation, header parsing, checksums
├── infra/
│   └── terraform/
│       ├── modules/
│       └── environments/{dev,staging,prod}/
├── docs/
│   ├── adr/
│   ├── runbooks/
│   └── threat-model.md
├── test-data/                  # SYNTHETIC DICOM ONLY
└── .github/workflows/
```

### 5.1 Module boundary rules

1. A module owns its own database tables. Table names are prefixed with the module name (`imaging_studies`, `scheduling_appointments`).
2. A module **must not** import from another module's `internal/` directory or query another module's tables.
3. Cross-module communication happens only through:
   - the target module's exported service interface (`identity/identity.public.ts`), or
   - domain events on the internal event bus.
4. `shared/` may be imported by anyone. `shared/` may import nothing from `modules/`.

### 5.2 Domain events (v1)

| Event | Emitted by | Consumed by |
|---|---|---|
| `PatientCreated` | patients | audit |
| `ConsentGranted` | consent | imaging (unlocks transfer), audit |
| `StudyUploadCompleted` | imaging | notifications, audit |
| `AppointmentBooked` | scheduling | notifications, billing, audit |
| `PaymentSucceeded` | billing | scheduling (confirms booking), notifications |
| `StudyAccessed` | imaging | audit |

Adding a feature should mean **adding a subscriber**, not editing an existing module.

---

## 6. Coding conventions

- All timestamps stored as `timestamptz` in UTC.
- All IDs are UUIDv7 (time-ordered) — never sequential integers in URLs.
- No secrets in code, `.env` files committed to git, or CI logs. Use AWS Secrets Manager.
- Every API endpoint declares its required role explicitly; a missing declaration fails a lint rule (P1.5).
- Every database query that touches patient data runs under an RLS session context. There is no "admin bypass" connection used by request handlers.
- Errors returned to clients never leak internal identifiers, stack traces, or the existence of records the caller cannot see (return 404, not 403, for unauthorized reads of a specific record).

---

# PHASE 0 — Foundations and decisions

## P0.1 — Confirm human decisions

**Goal:** unblock everything downstream.

**Do:** collect answers to these. Stop and ask the human if unanswered.

- **DECISION D1:** Does the Libyan doctor create the patient record, or does the patient self-register? (Recommended: doctor creates, patient claims via phone OTP.)
- **DECISION D2:** Is payment taken at booking, or after the Tunisian doctor accepts the case? (Recommended: authorise at booking, capture on acceptance.)
- **DECISION D3:** Can the Tunisian doctor view studies *before* accepting a booking (triage)? This changes whether image access is gated on payment.
- **DECISION D4:** Interface languages for v1. (Recommended: Arabic + French, RTL support required from day one — retrofitting RTL is expensive.)
- **DECISION D5:** Primary region — Milan or Paris. Verify all required services exist in Milan first.

**Verify:** all five answered in writing in `docs/decisions.md`.

**Gate:** ✅ `docs/decisions.md` exists and contains D1–D5.

---

## P0.2 — Obtain synthetic test data

**Goal:** never need real patient data to develop.

**Do:**
1. Download public de-identified DICOM datasets (TCIA / NCI Imaging Data Commons, or the Orthanc project's sample files).
2. Place in `test-data/dicom/`. Add `test-data/` to a CI check that fails if any file contains a `PatientName` matching a real-person allowlist pattern.
3. Create at least: one small single-file study, one multi-file CT series (>100 files), one MR series, one deliberately corrupt file, one non-DICOM file renamed to `.dcm`.

**Verify:** `ls test-data/dicom/` shows all five fixtures.

**Gate:** ✅ Five fixtures present, total size documented in `test-data/README.md`.

---

# PHASE 1 — Repository, CI, and boundary enforcement

> Build the guardrails before the features. This phase is what makes "modify without breaking" true later.

## P1.1 — Monorepo scaffold

**Do:**
1. Initialise pnpm workspace with the structure in §5.
2. `apps/api`: NestJS app that boots and serves `GET /health` returning `{status:"ok"}`.
3. `apps/web`: Next.js app rendering a placeholder page.
4. TypeScript strict mode on everywhere (`strict: true`, `noUncheckedIndexedAccess: true`).

**Verify:**
```bash
pnpm install && pnpm -r build
curl localhost:3000/health   # {"status":"ok"}
```

**Gate:** ✅ Both apps build and `/health` returns 200.

---

## P1.2 — Test harness

**Do:**
1. Vitest (or Jest) configured for `apps/api` and `packages/*`.
2. Playwright configured for `apps/web`.
3. One trivial passing test in each.

**Verify:** `pnpm test` runs all suites green.

**Gate:** ✅ `pnpm test` exits 0 and reports ≥3 tests.

---

## P1.3 — CI pipeline

**Do:** GitHub Actions workflow that runs on every PR:
- install → typecheck → lint → test → build
- fails the PR on any non-zero exit

**Verify:** open a PR with a deliberate type error; CI must fail. Fix it; CI must pass.

**Gate:** ✅ Demonstrated red build then green build.

---

## P1.4 — Architecture boundary tests ⚠️ critical

**Goal:** make module violations impossible to merge.

**Do:**
1. Create the eight empty module directories under `apps/api/src/modules/`.
2. Each module gets: `index.ts` (public API only), `internal/` (everything else).
3. Add `dependency-cruiser` with rules:
   - `modules/*/internal/**` may only be imported from within the same module.
   - `shared/**` must not import from `modules/**`.
   - no circular dependencies anywhere.
4. Wire into CI.

**Verify:** write a deliberate violation — import `modules/patients/internal/foo` from `modules/imaging`. CI must fail with a clear message. Remove it; CI passes.

**Gate:** ✅ Violation demonstrably blocked by CI.

---

## P1.5 — Authorization lint rule

**Goal:** an endpoint can never ship without an explicit access decision.

**Do:**
1. Define a `@RequiresRole(...)` / `@PublicEndpoint()` decorator pair.
2. Add a custom ESLint rule (or a NestJS bootstrap-time assertion) that fails if any controller route handler has neither decorator.

**Verify:** add an undecorated route; build/CI fails. Decorate it; passes.

**Gate:** ✅ Undecorated route is blocked.

---

## P1.6 — Secrets and config

**Do:**
1. Config loaded through a validated schema (zod) — app refuses to boot on missing/invalid config.
2. `.env.example` committed; `.env` gitignored.
3. Add `gitleaks` (or similar) secret scanning to CI.

**Verify:** remove a required env var → app exits with a clear error, not a runtime crash later. Commit a fake AWS key → gitleaks blocks it.

**Gate:** ✅ Both behaviours demonstrated.

---

# PHASE 2 — Infrastructure as code

## P2.1 — Terraform skeleton and remote state

**Do:**
1. `infra/terraform/` with S3 + DynamoDB remote state backend, encrypted, versioned.
2. Three environment directories sharing modules.
3. Provider pinned to a specific version.

**Verify:** `terraform init && terraform plan` clean in `dev`.

**Gate:** ✅ Plan runs with zero errors; state stored remotely.

---

## P2.2 — Network

**Do:** VPC with public subnets (load balancer only) and private subnets (app, database, Orthanc). NAT gateway for egress. No database or Orthanc port reachable from the internet. Security groups deny by default.

**Verify:** from outside the VPC, attempt to reach the DB port — must time out. `terraform plan` shows no `0.0.0.0/0` ingress except on 443 to the load balancer.

**Gate:** ✅ Database unreachable from public internet; verified by an actual connection attempt, not by reading the config.

---

## P2.3 — KMS keys

**Do:** create separate customer-managed keys for: object storage, database, secrets, backups. Key rotation enabled. Key policies grant least privilege.

**Verify:** `aws kms describe-key` shows rotation enabled on all four.

**Gate:** ✅ Four keys exist with rotation on.

---

## P2.4 — Object storage buckets ⚠️ critical

**Do:** create three buckets:

| Bucket | Purpose | Settings |
|---|---|---|
| `*-dicom-originals` | Immutable source of record | Versioning ON, Object Lock ON (compliance mode, retention per L5), SSE-KMS, public access blocked, cross-region replication ON |
| `*-derived` | Thumbnails, previews | Versioning ON, SSE-KMS, public access blocked, lifecycle expiry allowed |
| `*-audit-logs` | Access logs | Versioning ON, Object Lock ON, SSE-KMS |

**Verify:**
1. Upload an object to originals, then attempt `aws s3 rm` — **must be rejected** by Object Lock.
2. Attempt anonymous `curl` of the object URL — must return 403.
3. Confirm replica appears in the DR region.

**Gate:** ✅ Delete rejected, anonymous access denied, replication confirmed. **This is the single most important infrastructure gate — a deletable original is a lost scan is a lawsuit.**

---

## P2.5 — Database

**Do:** managed PostgreSQL 16, multi-AZ, private subnet, encrypted with the KMS DB key, automated backups with 30-day point-in-time recovery, deletion protection ON.

**Verify:**
1. `SELECT version();` from inside the VPC succeeds.
2. Trigger a failover test; app reconnects.
3. Perform a PITR restore to a scratch instance and confirm data is intact.

**Gate:** ✅ Failover survived and PITR restore verified. Record the observed RTO in `docs/runbooks/dr.md`.

---

## P2.6 — Deploy pipeline to dev

**Do:** containerise the API, push to a registry, deploy to the dev environment behind the load balancer with TLS.

**Verify:** `curl https://api-dev.<domain>/health` returns 200 over TLS 1.3. HTTP redirects to HTTPS.

**Gate:** ✅ Health check green over TLS from the public internet.

---

# PHASE 3 — Data model and row-level security

## P3.1 — Core schema

**Do:** create migrations for the tables below. Note the deliberate absence of any patient name uniqueness constraint.

```sql
-- identity
CREATE TABLE identity_users (
  id            uuid PRIMARY KEY,
  keycloak_sub  text UNIQUE NOT NULL,
  role          text NOT NULL CHECK (role IN ('libya_doctor','tunisia_doctor','patient','admin')),
  phone_e164    text UNIQUE NOT NULL,
  full_name     text NOT NULL,
  locale        text NOT NULL DEFAULT 'ar',
  status        text NOT NULL DEFAULT 'pending_verification',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity_doctor_profiles (
  user_id        uuid PRIMARY KEY REFERENCES identity_users(id),
  country        text NOT NULL CHECK (country IN ('LY','TN')),
  license_number text NOT NULL,
  specialty      text NOT NULL,
  clinic_name    text,
  verified_at    timestamptz,
  verified_by    uuid REFERENCES identity_users(id)
);

-- patients
CREATE TABLE patients_patients (
  id                uuid PRIMARY KEY,
  phone_e164        text NOT NULL,
  full_name         text NOT NULL,
  date_of_birth     date NOT NULL,
  sex               text NOT NULL CHECK (sex IN ('M','F','O')),
  national_id       text,
  national_id_type  text,
  created_by_doctor uuid NOT NULL REFERENCES identity_users(id),
  claimed_by_user   uuid REFERENCES identity_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON patients_patients (phone_e164);

-- consent
CREATE TABLE consent_records (
  id             uuid PRIMARY KEY,
  patient_id     uuid NOT NULL REFERENCES patients_patients(id),
  scope          text NOT NULL,          -- e.g. 'cross_border_transfer'
  granted_to     uuid REFERENCES identity_users(id),  -- named receiving doctor
  terms_version  text NOT NULL,
  terms_locale   text NOT NULL,
  granted_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  evidence_hash  text NOT NULL,          -- hash of rendered terms shown to patient
  ip_address     inet,
  user_agent     text
);

-- imaging
CREATE TABLE imaging_studies (
  id                  uuid PRIMARY KEY,
  patient_id          uuid NOT NULL REFERENCES patients_patients(id),
  uploaded_by         uuid NOT NULL REFERENCES identity_users(id),
  study_instance_uid  text NOT NULL,
  modality            text NOT NULL,
  study_date          date,
  description         text,
  file_count          int NOT NULL DEFAULT 0,
  total_bytes         bigint NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'uploading',
  orthanc_study_id    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, study_instance_uid)
);

CREATE TABLE imaging_instances (
  id             uuid PRIMARY KEY,
  study_id       uuid NOT NULL REFERENCES imaging_studies(id),
  sop_uid        text NOT NULL,
  series_uid     text NOT NULL,
  storage_key    text NOT NULL,
  size_bytes     bigint NOT NULL,
  sha256         text NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, sop_uid)
);

-- scheduling
CREATE TABLE scheduling_availability (
  id          uuid PRIMARY KEY,
  doctor_id   uuid NOT NULL REFERENCES identity_users(id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  slot_minutes int NOT NULL DEFAULT 30,
  CHECK (ends_at > starts_at)
);

CREATE TABLE scheduling_appointments (
  id           uuid PRIMARY KEY,
  patient_id   uuid NOT NULL REFERENCES patients_patients(id),
  doctor_id    uuid NOT NULL REFERENCES identity_users(id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'pending_payment',
  created_at   timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled')
);

-- link table: which studies are shared with which appointment
CREATE TABLE scheduling_appointment_studies (
  appointment_id uuid NOT NULL REFERENCES scheduling_appointments(id),
  study_id       uuid NOT NULL REFERENCES imaging_studies(id),
  PRIMARY KEY (appointment_id, study_id)
);

-- audit (append-only)
CREATE TABLE audit_events (
  id           uuid PRIMARY KEY,
  actor_id     uuid,
  actor_role   text,
  action       text NOT NULL,
  subject_type text NOT NULL,
  subject_id   uuid,
  patient_id   uuid,
  ip_address   inet,
  user_agent   text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC;
```

**Note:** `scheduling_appointments` uses a PostgreSQL exclusion constraint so the database itself makes double-booking impossible. Requires `CREATE EXTENSION btree_gist;`.

**Verify:** migrations apply cleanly to an empty database and roll back cleanly.

**Gate:** ✅ `migrate up` then `migrate down` then `migrate up` succeeds.

---

## P3.2 — Row-level security ⚠️ critical

**Do:**
1. Create a non-superuser application role. The app connects as this role. It must **not** have `BYPASSRLS`.
2. Enable RLS on every table containing patient data.
3. Each request sets session context before any query:
   ```sql
   SET LOCAL app.user_id = '<uuid>';
   SET LOCAL app.user_role = '<role>';
   ```
4. Write policies. Examples:

```sql
ALTER TABLE imaging_studies ENABLE ROW LEVEL SECURITY;

-- Libyan doctor: only studies they uploaded
CREATE POLICY studies_uploader ON imaging_studies FOR SELECT
  USING (current_setting('app.user_role') = 'libya_doctor'
         AND uploaded_by = current_setting('app.user_id')::uuid);

-- Patient: only their own
CREATE POLICY studies_patient ON imaging_studies FOR SELECT
  USING (current_setting('app.user_role') = 'patient'
         AND patient_id IN (
           SELECT id FROM patients_patients
           WHERE claimed_by_user = current_setting('app.user_id')::uuid));

-- Tunisian doctor: only studies linked to an appointment with them,
-- and only where valid consent naming them exists
CREATE POLICY studies_receiving_doctor ON imaging_studies FOR SELECT
  USING (current_setting('app.user_role') = 'tunisia_doctor'
         AND EXISTS (
           SELECT 1
           FROM scheduling_appointment_studies sas
           JOIN scheduling_appointments a ON a.id = sas.appointment_id
           JOIN consent_records c ON c.patient_id = imaging_studies.patient_id
           WHERE sas.study_id = imaging_studies.id
             AND a.doctor_id = current_setting('app.user_id')::uuid
             AND a.status <> 'cancelled'
             AND c.scope = 'cross_border_transfer'
             AND c.granted_to = current_setting('app.user_id')::uuid
             AND c.revoked_at IS NULL));
```

**Verify — write these as permanent automated tests, not manual checks:**

| Test | Expected |
|---|---|
| Libyan doctor A queries studies uploaded by doctor B | 0 rows |
| Patient X queries patient Y's studies | 0 rows |
| Tunisian doctor with a booked appointment but **no consent record** | 0 rows |
| Tunisian doctor with appointment **and** valid consent | 1 row |
| Consent revoked → same query re-run | 0 rows |
| App role attempts `SET ROLE postgres` | error |
| Any user attempts `DELETE FROM audit_events` | permission denied |

**Gate:** ✅ All seven tests pass and run in CI on every commit. **This is the most important gate in the project.** Broken access control is the most common cause of serious breaches in early-stage health platforms.

---

## P3.3 — Patient identity matching

**Goal:** prevent both duplicate patients and — far worse — two different people merged into one record.

**Do:**
1. Lookup is by `phone_e164` only. Never fuzzy-match on name: Arabic/French/English transliteration across the Libya–Tunisia border makes name matching unreliable.
2. On phone match, the UI shows the existing patient's name + DOB and requires the doctor to **explicitly confirm** it is the same person.
3. **Never auto-merge.** If a doctor believes two records are the same person, that is an admin action with a full audit trail and is reversible.
4. Store the transliteration variants the doctor entered rather than normalising them away.

**Verify:**
- Creating a patient with an existing phone returns a confirmation-required response, not a silent merge.
- Two patients with identical names and different phones remain two records.

**Gate:** ✅ Both behaviours covered by automated tests.

---

# PHASE 4 — Identity, authentication, audit

## P4.1 — Keycloak deployment

**Do:** deploy Keycloak in a private subnet, backed by its own database schema. Configure one realm with four roles matching §P3.1. TLS enforced. Admin console not publicly reachable.

**Verify:** obtain a token via the OIDC flow; decode and confirm the role claim.

**Gate:** ✅ Valid JWT issued with correct role claim; admin console unreachable from the internet.

---

## P4.2 — API authentication

**Do:**
1. JWT validation middleware — verify signature, issuer, audience, expiry.
2. On every authenticated request, set the RLS session context (P3.2) inside the same transaction as the handler's queries.
3. Reject requests with no token, expired token, or wrong audience.

**Verify:**
- No token → 401.
- Tampered signature → 401.
- Expired token → 401.
- Valid token → handler runs *and* `current_setting('app.user_id')` matches the token subject.

**Gate:** ✅ All four cases tested. Confirm RLS context is set inside the transaction — a context set outside it silently does nothing.

---

## P4.3 — MFA for clinical accounts

**Do:** require TOTP for all `libya_doctor`, `tunisia_doctor`, and `admin` accounts. Patients may use SMS OTP.

**Verify:** a doctor account without MFA enrolled cannot complete login; it is forced into enrolment.

**Gate:** ✅ Doctor login without MFA is impossible.

---

## P4.4 — Audit module ⚠️ critical

**Do:**
1. `audit.record(event)` writes to `audit_events`. Append-only — no update or delete path exists in code.
2. Subscribe to all domain events from §5.2.
3. Every read of patient imaging emits a `StudyAccessed` event with actor, patient, study, IP, user agent, and timestamp.
4. Ship audit rows to the `*-audit-logs` object-lock bucket on a schedule so a database compromise cannot erase history.

**Verify:**
- Doctor opens a study → exactly one `StudyAccessed` row appears with correct actor and subject.
- Application role attempts `UPDATE audit_events` → permission denied.
- Archived audit file in the bucket cannot be deleted.

**Gate:** ✅ Access produces an immutable record that survives an attempt to tamper with it.

---

## P4.5 — Rate limiting and lockout

**Do:** rate-limit login, OTP request, and upload initiation. Progressive lockout on repeated auth failures. Alert on anomalies (e.g. one account accessing an unusual number of distinct patients in an hour).

**Verify:** scripted brute-force is throttled; alert fires in the test environment.

**Gate:** ✅ Throttling and alerting both demonstrated.

---

# PHASE 5 — Patients and consent

## P5.1 — Patients module

**Do:** CRUD under RLS. Create, search by phone, view own patients. A Libyan doctor sees only patients they created.

**Verify:** the RLS tests from P3.2 still pass through the HTTP layer, not just at the SQL layer.

**Gate:** ✅ End-to-end API tests confirm isolation between two doctor accounts.

---

## P5.2 — Patient claim flow

**Do:** patient receives an SMS with a claim link/OTP; on success `claimed_by_user` is set. Expiring, single-use tokens.

**Verify:** used token cannot be reused; expired token rejected; claiming does not grant access to any other patient.

**Gate:** ✅ All three cases tested.

---

## P5.3 — Consent module ⚠️ legally critical

**Do:**
1. Consent text is **versioned content** stored per locale (`ar`, `fr`), each version immutable once published.
2. Granting consent records: patient, scope, **named receiving doctor**, terms version, locale, timestamp, IP, user agent, and a SHA-256 hash of the exact rendered text shown.
3. Consent is revocable. Revocation is a new row state, never a delete.
4. Imaging transfer to a Tunisian doctor is **blocked** unless a valid, unrevoked consent naming that doctor exists.

**Verify:**
- Attempt to share a study with a doctor with no consent → denied at both the API layer and the RLS layer.
- Publish terms v2; existing consents still reference v1 and remain valid.
- Revoke consent → the Tunisian doctor's access to that study disappears immediately.

**Gate:** ✅ Access genuinely disappears on revocation, verified by an API call returning 404 after revocation. Consent evidence is reconstructible: given a consent row, you can produce the exact text the patient saw.

---

# PHASE 6 — DICOM validation library

## P6.1 — `packages/dicom-utils`

**Do:** implement and unit-test:

```ts
isDicom(buffer): boolean            // 'DICM' magic bytes at offset 128
readHeader(buffer): {               // via dicom-parser, tags only
  studyInstanceUID, seriesInstanceUID, sopInstanceUID,
  modality, studyDate, patientIdInFile, transferSyntaxUID
}
sha256(buffer): string
isLossyTransferSyntax(uid): boolean
```

**Rules:**
- Reject files failing the magic-byte check. Some legacy DICOM lacks the 128-byte preamble; log those separately as `rejected_no_preamble` so you can measure whether real-world clinics hit this before deciding to loosen the rule.
- Never trust `PatientName`/`PatientID` **from the file** for record linkage. The doctor's chosen patient record is authoritative. File tags are metadata only.
- Flag lossy transfer syntaxes on ingest and surface a warning in the UI — do not reject, but record it.

**Verify against the five fixtures from P0.2:**

| Fixture | Expected |
|---|---|
| Valid single DICOM | accepted, header parsed |
| 100+ file CT series | all accepted, one `studyInstanceUID` |
| MR series | accepted, modality `MR` |
| Corrupt file | rejected with a specific error |
| Renamed non-DICOM | rejected by magic-byte check |

**Gate:** ✅ All five behave as specified. Corrupt and renamed files must be rejected, not merely logged.

---

# PHASE 7 — Resumable upload ⚠️ highest practical risk

> Libyan connectivity is intermittent with limited upstream bandwidth. A study can be 200 MB–1 GB across hundreds of files. A naive single POST will fail constantly and doctors will abandon the product. This phase determines whether the product is usable.

## P7.1 — Upload session API

**Do:**
1. `POST /uploads` creates a session: `{patientId, expectedFileCount}` → returns `uploadSessionId`.
2. Server verifies the caller may upload for that patient (RLS + RBAC).
3. Session has a TTL and a resumable state record.

**Verify:** creating a session for another doctor's patient → 404.

**Gate:** ✅ Cross-doctor upload attempt blocked.

---

## P7.2 — Chunked resumable transport

**Do:** implement `tus` (recommended: `tusd` behind the API, or the tus protocol in NestJS) **or** S3 multipart with presigned part URLs. Requirements either way:
- Chunk size configurable, default 5 MB.
- A dropped connection resumes from the last completed chunk, not from zero.
- Client sends the SHA-256 it computed; server recomputes and compares on assembly.
- Server rejects on checksum mismatch and marks the file for retry.

**Verify — this must be tested under simulated failure, not on a good connection:**
1. Upload a 200 MB study; kill the network at ~40%; restore; upload resumes and completes.
2. Corrupt one chunk in transit deliberately → server rejects with checksum mismatch.
3. Total bytes actually transferred on resume is materially less than a full re-upload (assert it).

**Gate:** ✅ Interrupted upload resumes and completes with a matching checksum. **Do not proceed until you have tested with the network actually severed mid-upload.**

---

## P7.3 — Client-side persistent queue

**Do:**
1. Browser upload queue persisted in IndexedDB.
2. Queue survives page reload, browser crash, and machine restart; resumes automatically on next open.
3. Folder selection supported (`webkitdirectory`) since a study is many files, often extensionless, often inside a `DICOM/` or `IMAGES/` folder on a CD.
4. Gzip each file client-side before transfer (lossless container compression — never touches pixel data).
5. Clear per-file progress and a visible retry state.

**Verify:** start a large upload, hard-close the browser, reopen → upload resumes without user action.

**Gate:** ✅ Upload survives a browser kill and resumes unattended.

---

## P7.4 — Server-side ingestion pipeline

**Do:** on each completed file, enqueue a job that:
1. Re-validates DICOM magic bytes **server-side** (never trust the client).
2. Parses header tags.
3. Verifies the file's `StudyInstanceUID` is consistent with the session's other files; flags mismatches for review rather than silently splitting.
4. Writes the original bytes unmodified to `*-dicom-originals` at
   `patients/{patient_id}/studies/{study_uid}/series/{series_uid}/{sop_uid}.dcm`
5. Inserts `imaging_instances` row with storage key, size, checksum.
6. Pushes to Orthanc via STOW-RS.
7. Generates a thumbnail into `*-derived`.
8. On completion of all files, sets study status `ready` and emits `StudyUploadCompleted`.

**Verify:**
- Upload the 100+ file CT fixture → one study row, correct instance count, all objects present in S3, all checksums match.
- Re-upload the same study → idempotent, no duplicates (unique constraint on `(study_id, sop_uid)` holds).
- Inject a job failure mid-pipeline → job retries and eventually completes; no partial study marked `ready`.

**Gate:** ✅ Study integrity holds under retry and duplicate upload.

---

# PHASE 8 — Orthanc and DICOMweb

## P8.1 — Deploy Orthanc

**Do:** Orthanc in a private subnet with the DICOMweb plugin and the object-storage plugin pointed at a dedicated prefix. Authentication enabled. Not reachable from the internet — only from the API.

**Verify:** API can reach Orthanc; a request from outside the VPC times out.

**Gate:** ✅ Orthanc private and functional.

---

## P8.2 — DICOMweb access through the API

**Do:** the frontend never talks to Orthanc directly. The API proxies WADO-RS/QIDO-RS requests, and for every request:
1. Applies RBAC and RLS authorization.
2. Emits a `StudyAccessed` audit event.
3. Issues short-lived (5–15 min) signed URLs for any direct object access.

**Verify:**
- Tunisian doctor requests a study they are not linked to → 404, and an audit row records the denied attempt.
- A signed URL still works at 4 minutes and is rejected at 20 minutes.
- Frontend contains no Orthanc credentials (grep the bundle).

**Gate:** ✅ No path exists from the browser to Orthanc that bypasses the API.

---

# PHASE 9 — Viewer

## P9.1 — Cornerstone3D integration

**Do:** embed Cornerstone3D fetching via the API's WADO-RS proxy. Load progressively — thumbnails first, then frames on demand. **Never download an entire study up front.**

Persistent, non-dismissible banner: *"Reference viewing only — not for diagnostic use."*

**Verify:**
- Time to first rendered image on a throttled connection (simulate 2 Mbit/s, 200 ms latency) is under 5 seconds.
- Network trace confirms frames load on demand, not all at once.
- Banner present on every viewer screen.

**Gate:** ✅ First image under 5 s on a throttled connection, and no full-study prefetch.

---

# PHASE 10 — Scheduling

## P10.1 — Availability

**Do:** Tunisian doctor defines recurring and one-off availability windows. All times stored UTC; displayed in the viewer's local timezone. Handle the Libya/Tunisia offset explicitly and test around DST boundaries.

**Verify:** a slot created by a doctor in Tunis displays at the correct local time for a patient in Tripoli, including across a DST change.

**Gate:** ✅ Timezone correctness verified with explicit test cases, not assumed.

---

## P10.2 — Booking

**Do:** patient (or client) books a slot. Booking is a transaction that: locks the slot, creates the appointment, links the relevant studies, emits `AppointmentBooked`.

Double-booking is prevented by the exclusion constraint from P3.1 — the database is the authority, not application logic.

**Verify:** fire 50 concurrent booking requests for the same slot. **Exactly one** succeeds; the rest receive a clean conflict error, not a 500.

**Gate:** ✅ Concurrency test passes deterministically across repeated runs.

---

## P10.3 — Study linkage and triage gating

**Do:** implement per **DECISION D3**. If triage-before-payment is enabled, the Tunisian doctor sees studies once the appointment is requested; otherwise only after payment succeeds. Either way, consent (P5.3) is required first.

**Verify:** toggle the config both ways and confirm access matches in each mode.

**Gate:** ✅ Both modes behave correctly and are covered by tests.

---

# PHASE 11 — Payments

## P11.1 — Provider selection (BLOCKING — see L7)

**Do not** assume a global processor is available. Libya has significant currency-control and banking-access constraints, and most international processors do not serve it. Realistic v1 options to evaluate with a local advisor:
- A Tunisian gateway with payment collected on the Tunisian side
- Bank transfer with manual reconciliation
- Cash-at-clinic with the platform recording, not processing, the payment

**Verify:** written confirmation of the chosen rail and its legal viability.

**Gate:** ✅ Provider chosen and documented. Do not build against a provider that has not been confirmed available to your users.

---

## P11.2 — Billing module

**Do:**
1. Never store card data. Tokenised provider flows only — the platform must stay out of PCI scope.
2. Idempotency keys on every payment operation.
3. Webhook handler with signature verification and replay protection.
4. `PaymentSucceeded` confirms the appointment; failure or timeout releases the slot after a defined window.

**Verify:**
- Replay the same webhook 10 times → one state change.
- Simulate payment failure → slot released, patient notified.
- Simulate webhook arriving before the client redirect → state still correct.

**Gate:** ✅ Idempotency and out-of-order webhook handling both proven.

---

# PHASE 12 — Notifications

**Do:** SMS and email for: patient claim, consent request, upload complete, booking confirmed, appointment reminder, consent revoked.

**Rules:** notification content must **never** include clinical details or images. "Your appointment is confirmed" — not the diagnosis, modality, or body part.

**Verify:** inspect every template; assert in a test that no template interpolates a clinical field.

**Gate:** ✅ Automated test blocks clinical data in notification payloads.

---

# PHASE 13 — Observability

**Do:**
1. OpenTelemetry traces across API → DB → Orthanc → S3.
2. Structured JSON logs. **Log scrubbing that strips patient identifiers, file contents, and tokens — verified, not assumed.**
3. Sentry with PII scrubbing enabled.
4. Dashboards: upload success rate, upload resume rate, p95 time-to-first-image, booking conversion, failed authorization attempts.
5. Alerts: authorization failure spike, upload failure rate above threshold, replication lag, backup failure, unusual patient-access volume per actor.

**Verify:** trigger an error containing a patient name and a token → confirm neither appears in Sentry or the log store.

**Gate:** ✅ Verified scrubbing by deliberately logging sensitive data and confirming it is stripped.

---

# PHASE 14 — Security hardening

## P14.1 — Least privilege

**Do:** no engineer has standing production access to patient images. Break-glass access only: time-boxed, requires a second approver, logged, and alerts the team.

**Verify:** attempt a normal-account production data read → denied. Exercise break-glass → alert fires and the access is logged.

**Gate:** ✅ Standing access is impossible; break-glass is auditable.

---

## P14.2 — Dependency and container scanning

**Do:** Dependabot/Renovate plus a vulnerability scanner in CI. Fail the build on high/critical findings. Scan container images too.

**Gate:** ✅ A deliberately vulnerable dependency blocks the build.

---

## P14.3 — Edge protection

**Do:** Cloudflare WAF in front of everything. TLS 1.3 minimum. HSTS. Strict CSP. Rate limits on auth and upload endpoints. Bot protection on login.

**Verify:** run an automated scanner; confirm common injection payloads are blocked at the edge and the security-header grade is A or better.

**Gate:** ✅ Scanner clean; headers verified.

---

## P14.4 — Threat model and penetration test

**Do:**
1. Write `docs/threat-model.md` covering at minimum: compromised doctor account, malicious insider, stolen device with an active session, S3 misconfiguration, dependency compromise, consent bypass, patient misidentification.
2. Commission a third-party penetration test **before real patient volume**, with explicit focus on authorization boundaries between doctors and between patients.
3. Remediate all high/critical findings and retest.

**Gate:** ✅ Pen test report exists, all high/critical findings remediated and retested. **Do not onboard real patients before this gate.**

---

# PHASE 15 — Resilience drills

## P15.1 — Backup restore drill

**Do:** restore the database from PITR into a scratch environment. Verify referential integrity and that studies remain linked to the right patients.

**Verify:** record the actual RTO and RPO achieved.

**Gate:** ✅ Restore succeeds and measured RTO/RPO meet documented targets. Schedule this quarterly — an untested backup fails at exactly the wrong moment.

---

## P15.2 — Region failure drill

**Do:** simulate loss of the primary region. Confirm DICOM originals are readable from the replica. Document the failover runbook.

**Gate:** ✅ Originals recoverable from the DR region; runbook written and followed by someone who did not write it.

---

## P15.3 — Incident response

**Do:** write `docs/runbooks/incident-response.md`: severity levels, on-call, first-hour actions, evidence preservation, breach notification triggers and deadlines (per L8), and communication templates.

**Verify:** run a tabletop exercise of a suspected unauthorized access to one patient's study.

**Gate:** ✅ Tabletop completed; gaps logged and fixed.

---

# PHASE 16 — Pre-launch checklist

Every line must be checked before the first real patient.

**Legal**
- [ ] L1–L8 resolved in writing
- [ ] Consent text reviewed by counsel, published in Arabic and French
- [ ] Terms of service state the platform is not a diagnostic tool
- [ ] Retention periods configured to match L5
- [ ] DPA/BAA-equivalent signed with the cloud provider

**Access control**
- [ ] All P3.2 RLS tests green in CI
- [ ] Cross-doctor and cross-patient isolation verified end-to-end
- [ ] Consent revocation immediately removes access
- [ ] MFA enforced on all clinical accounts
- [ ] No standing production data access for engineers

**Data integrity**
- [ ] Object Lock verified — originals cannot be deleted
- [ ] Cross-region replication verified
- [ ] Checksums verified end-to-end on upload
- [ ] PITR restore drill completed within target RTO
- [ ] No lossy transcoding anywhere in the pipeline

**Reliability**
- [ ] Interrupted upload resumes successfully on a poor connection
- [ ] Concurrency test: exactly one booking wins a contested slot
- [ ] p95 time-to-first-image under target on a throttled connection

**Security**
- [ ] Pen test complete, high/critical remediated and retested
- [ ] Secret scanning and dependency scanning enforced in CI
- [ ] Log scrubbing verified with real sensitive payloads
- [ ] Audit log immutability verified

**Operations**
- [ ] Alerts fire and reach a human who is on call
- [ ] Incident response runbook exercised
- [ ] Staging contains zero real patient records — verified by query

**Claims**
- [ ] Marketing describes security accurately. Do not use "military grade" — it is not a technical standard, and overclaiming becomes a liability during a breach investigation or regulatory review. Describe the architecture: AES-256 at rest, TLS 1.3 in transit, row-level access control, immutable audit log.

---

# 17. Deliberate anti-patterns — do not do these

| Anti-pattern | Why it is dangerous here |
|---|---|
| Copying production data to staging "for testing" | Single largest avoidable breach cause |
| Trusting client-side file validation | Trivially bypassed; re-validate server-side always |
| Fuzzy name matching to deduplicate patients | Merges two people into one record; catastrophic and hard to detect |
| Hiding UI elements as the access-control mechanism | The API is the boundary, not the interface |
| Re-encoding DICOM to save storage | Destroys diagnostic information |
| A single "admin" database connection that bypasses RLS | Defeats the entire second layer of defence |
| Naive single-request uploads | Guarantees failure on Libyan connectivity |
| Application-level double-booking checks only | Race conditions; use the database exclusion constraint |
| Storing consent as a boolean | Unprovable in a dispute; store the evidence |
| Silent retries that mark a partial study `ready` | A doctor reads an incomplete study and misses a finding |

---

# 18. Open items for v2

- Direct hospital PACS integration via DICOMweb (STOW/QIDO/WADO) so receiving hospitals can pull into their own systems
- De-identification pipeline if imaging is ever used for analytics or model training — a separate consent basis is required
- Desktop uploader agent for clinics, pulling directly from PACS or CD and uploading overnight in the background (likely the strongest adoption lever for Libyan clinics)
- HL7 FHIR if scope ever expands beyond imaging
- Structured referral notes from the Libyan doctor

---

**End of specification.**

Build in order. Do not skip gates. When a gate fails, stop and fix it — every gate in this document exists because skipping it creates either a patient-safety risk or a legal one.
