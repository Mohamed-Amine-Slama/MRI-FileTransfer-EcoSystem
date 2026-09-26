# MIR — Cross-border medical imaging transfer

A platform for sending medical scans across a border for a specialist's opinion.
A **referring clinic in Libya** uploads a patient's MRI/CT study. A
**receiving doctor in Tunisia** reads it in the platform's viewer and sends back a
structured report, which is also available as a PDF.

Built to [`BUILD_SPEC.md`](./BUILD_SPEC.md), phase by phase, gate by gate. Later
changes are specified in [`docs/superpowers/specs/`](./docs/superpowers/specs/).

---

> ## ⚠️ NOT READY FOR REAL PATIENTS
>
> The application is substantially built and tested. It cannot be launched.
>
> - **All eight legal prerequisites (L1–L8) are unanswered.** L1 decides
>   whether the cross-border transfer is lawful at all.
> - **No infrastructure exists.** Every PHASE 2 gate is open, including the
>   Object Lock verification the spec calls the single most important one.
> - **No penetration test.** The spec is explicit: do not onboard real
>   patients before it.
> - **No payment rail.** Prices, quotes and ledgers are real; no money moves.
>
> Run `pnpm verify:gates` for the full accounting, or read
> [`docs/pre-launch-checklist.md`](./docs/pre-launch-checklist.md).

---

## How it works

A case moves through these steps:

1. **Submit.** The clinic registers the patient, records consent, opens a case
   with a specialty and uploads the DICOM study.
2. **Pick a doctor.** The clinic chooses from the receiving doctors in that
   specialty who are accepting cases. It can add a note for the doctor.
3. **Quote and pay.** Choosing a doctor locks the price. A consult costs a flat
   $100: the clinic keeps $30, the doctor is paid $20, and the platform keeps
   the rest. The split is fixed when the quote is issued.
4. **Accept or decline.** Until the doctor accepts, they see only a summary of
   the case. Accepting unlocks the imaging. Declining sends the case back so the
   clinic can pick another doctor.
5. **Read and report.** The doctor reads the study in the viewer (stack scroll,
   window/level, pan, zoom, measure, invert, series picker) and fills in the
   radiology report next to it. The form autosaves.
6. **Answer.** Once the report is submitted, the clinic can read it and download
   the PDF (English or French). The PDF has the case reference, the patient's
   age and sex, and the doctor's name. It never includes the patient's name.

**The receiving doctor never sees the original scan.** On upload, the study is
de-identified in Orthanc into a separate copy (a "twin") with new UIDs, and
the receiving side only ever reads that copy.

### Who uses it

| Account | Role | Can do |
|---|---|---|
| Referring clinic / lab (Libya) | `libya_doctor` | Patients, cases, uploads, picking a doctor, reading reports, its ledger |
| Receiving doctor (Tunisia) | `tunisia_doctor` | Inbox, availability switch, viewer, reports, payouts |
| Assistant | `assistant` | A doctor's calendar. Sees patient names and phone numbers only, never scans |
| Ops staff | `admin` | Provider verification, all cases, audit log, platform ledger |
| Applicant | `applicant` | Their own "pending review" screen until verified |

Every role except `applicant` must use TOTP two-factor sign-in. Countries are
set per corridor rather than hardcoded, so adding another country pair is a
configuration change (`packages/contracts/src/corridor.ts`).

Yearly plans are shown and recorded: 1000 USD for a clinic, 1000 TND for a
doctor. They do not restrict access yet.

The interface is in Arabic and French and supports right-to-left layout.

## Quick start

```bash
pnpm install
docker compose up -d postgres redis      # Orthanc and Keycloak also available
cp .env.example .env

pnpm --filter @mir/api migrate:up        # apply migrations
pnpm verify                              # the full pipeline
pnpm verify:gates                        # what is actually verified vs open
```

Requires Node 20–24 and Docker. PostgreSQL listens on **5433** to avoid
colliding with a local install.

### A local world you can sign in to

With Postgres, Keycloak and Orthanc running and migrations applied:

```bash
node scripts/dev-bootstrap.mjs       # dev realm settings, users, seed cases
node scripts/dev-seed-imaging.mjs    # one real MR series (needs the API up)
```

`dev-bootstrap.mjs` weakens the Keycloak realm for local use: it turns TLS off
and makes every password sign-in count as two-factor. It refuses to run
against anything that isn't on your own machine.

| Sign in as | Password |
|---|---|
| `dev-doctor@example.test` (referring clinic) | `dev-doctor-pass-1234` |
| `dev-receiver@example.test` (receiving doctor, accepting) | `dev-receiver-pass-1234` |
| `dev-ops@example.test` (ops) | `dev-ops-pass-1234` |
| `dev-assistant@example.test` | `dev-assist-pass-1234` |
| `dev-applicant@example.test` | `dev-applicant-pass-1234` |

Two things to know before running the apps on the host:

- **Run the API from a build, not `dev`.** `tsx` does not emit the decorator
  metadata that Nest's dependency injection needs, so `pnpm --filter @mir/api dev`
  fails at startup. Run `pnpm --filter @mir/api build`, then
  `node apps/api/dist/main.js`.
- **Use a production build of the web app to click through it.** The CSP
  forbids `unsafe-eval`, which `next dev` needs, so pages served by `next dev`
  never become interactive. Run `pnpm --filter @mir/web build` then
  `pnpm --filter @mir/web start` (port 3001).

### Running the apps in containers instead

The quick start above runs the two apps on the host and only the dependencies
in Docker. To run everything in containers:

```bash
docker compose --profile apps up -d --build
```

Web on <http://localhost:3001>, API on <http://localhost:3000>. Migrations run
automatically as a one-shot `migrate` service before the API starts.

Two things about this stack are worth knowing:

- **It is single-origin.** The frontend calls the API at `/api` on its own
  origin, and the `web` image is built with `API_ORIGIN` set so Next rewrites
  that prefix to the API service — the job Cloudflare does at the edge in
  deployed environments (P8.2). Because `next build` bakes the rewrite into its
  standalone output, changing where `/api` points needs a rebuild, not a
  restart.
- **The API connects as `mir_app`, not as a superuser**, so row-level security
  is actually in force (ADR-6). Migration 0002 creates that role `NOLOGIN` with
  no password on purpose, so a `db-grant` service attaches a local development
  password after migrating. Nothing outside this compose file does that, and
  nothing should.

The app services sit behind the `apps` profile, so plain
`docker compose up -d postgres redis` still starts dependencies only and does
not contend for ports 3000 and 3001 with a host `pnpm dev`.

To use a hosted database (Supabase) instead of the compose one, see the
`DATABASE_*` comments in `.env.example`. Connect as `mir_app`. Never connect as
`postgres`, because on Supabase that role has `BYPASSRLS` and would skip
row-level security.

## Layout

```
apps/api        NestJS modular monolith (ADR-1): cases, imaging, patients,
                consent, identity, organisations, pricing, plans, billing,
                ledger, notifications, audit
apps/web        Next.js App Router, Arabic + French, RTL from day one (D4)
packages/       shared contracts (zod schemas, roles, corridors), DICOM utilities
infra/          Terraform (written, never applied), Orthanc, Keycloak
scripts/        verification probes, local bootstrap and seeding
docs/           ADRs, decisions, threat model, runbooks, specs and plans,
                pre-launch checklist
test-data/      SYNTHETIC DICOM ONLY (ADR-7)
```

## The properties worth knowing about

**Authorization is enforced twice, independently** (ADR-6). Application RBAC
and PostgreSQL row-level security. The app connects as a non-superuser,
non-owner role with `NOBYPASSRLS`; there is no admin bypass connection. A bug
in one layer does not expose data.

**Originals are immutable** (ADR-4). Uploaded DICOM is stored byte-for-byte
under Object Lock. Nothing re-encodes pixel data, ever. Thumbnails and the
de-identified twin are separate derived objects.

**Module boundaries are enforced by CI**, and the enforcement is itself
verified — `pnpm boundaries:verify` plants violations and fails if the rules
stop catching them.

**The audit log is append-only at three levels**: no code path, no GRANT, and
an Object Lock archive so a full database compromise cannot rewrite history.

**Uploads assume the network will fail.** Chunked, resumable, durable state in
PostgreSQL; the queue survives a browser kill and resumes with no user action.

**The web app only makes requests it needs.** Links don't prefetch: import
`Link` from `apps/web/components/ui/link.tsx`, never `next/link` (lint blocks
it). Pass `prefetch` only on a link people almost always click. A signed-out
page load makes one data call (`POST /auth/refresh`). The session skips
`/api/auth/me` when there's no token, because it would always return 401.
Signed-out `/login` went from 30 requests to 19.

## Testing

```bash
pnpm test                          # unit + integration, every package
pnpm --filter @mir/web test:e2e    # browser tests, desktop + mobile
```

`pnpm test` resets the local `mir_app` password as part of the API suite, so an
API you already have running can lose its database connection. Restart it
afterwards.

Verification commands that prove a guard still works, rather than that the tree
currently passes it:

```bash
pnpm boundaries:verify   # plants module-boundary violations, asserts they fail
pnpm scan:verify         # plants a vulnerable dependency, asserts audit goes red
pnpm verify:mfa          # doctor without TOTP cannot log in (needs Keycloak)
pnpm drill:restore       # backup -> scratch restore, integrity verified
pnpm verify:object-lock  # P2.4 probe (needs real AWS credentials)
```

The tests that matter most:

| What | Where |
|---|---|
| Row-level security | `apps/api/src/shared/db/rls.test.ts` |
| Upload resume + integrity | `apps/api/src/modules/imaging/upload.test.ts` |
| Browser-kill resume | `apps/web/e2e/upload-resume.spec.ts` |
| Log scrubbing | `apps/api/src/shared/observability/log-scrubber.test.ts` |
| Severed-TCP upload resume | `apps/api/src/modules/imaging/upload-severed.test.ts` |

## Known gaps

Beyond the legal and infrastructure blockers above:

- **The viewer is used for diagnosis but is not certified.** The "not for
  diagnostic use" banner was removed on purpose, and the owner accepts that
  regulatory exposure (decision D3 in
  [`docs/superpowers/specs/2026-09-21-platform-corrections-design.md`](./docs/superpowers/specs/2026-09-21-platform-corrections-design.md)).
  The terms of service in the pre-launch checklist need to reflect this.
- **The viewer has only been tested on synthetic data.** It has shown one
  synthetic MR series through a local Orthanc and has never been used on real
  clinical studies.
- **Subscriptions do not gate anything**, and no payment rail is wired (L7).
- **The PDF report is English or French only.** An Arabic PDF needs text
  shaping and bidirectional layout, which the PDF library doesn't handle.
- **Case messaging and the per-file access trail are hidden.** Neither has a
  backend yet.
- **The public landing page is hidden.** `/` sends visitors to sign-in. The
  landing page files are still in the repo.
- **The CSP carries `script-src 'unsafe-inline'`.** Next's App Router streams
  RSC payloads through inline scripts, and these routes are statically
  prerendered so a per-request nonce cannot reach them. Removing it means
  forcing dynamic rendering app-wide. The app contains no
  `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`, and that
  claim is enforced by a test rather than a comment.
- **No notification delivery provider** is wired. Templates and the
  no-clinical-data guarantee are built and tested.
- **A patient name in free-text logs cannot be scrubbed** when there is no
  accompanying field to learn it from. Recorded as a passing test so it is not
  mistaken for coverage.

## Development note

This repository lives on `/mnt/c` (a Windows drive) under OneDrive. That makes
`node_modules` operations slow (~40s API boot instead of ~2s) and has caused
`EACCES` failures during installs from OneDrive file locks. **Moving it to the
Linux filesystem is strongly recommended.**
