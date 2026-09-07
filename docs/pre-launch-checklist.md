# Pre-launch checklist

**BUILD_SPEC PHASE 16.** "Every line must be checked before the first real
patient."

---

## How to read this

- ✅ **Verified** — a test or command was run and its output observed. The
  evidence column says which.
- 🏠 **Local** — the verification was executed and its output observed, but
  against a **local stand-in** rather than the deployed target. Real evidence,
  and not a substitute for the real environment. Never counts toward launch.
  The note always names what stood in for what.
- ⬜ **Open** — not done. No partial credit.
- 🔒 **Blocked** — cannot be done from this repository; needs credentials, a
  third party, or a legal answer.

**Nothing here is checked off on the basis of code review.** A gate is passed
when its verification was executed and the result observed.

> ### Current headline
> **The application is substantially built and tested. It is NOT launchable.**
> All eight legal prerequisites are unanswered, no infrastructure exists, and
> there has been no penetration test. Those are not paperwork — L1 decides
> whether the transfer is lawful at all.

---

## Legal

| Item | Status | Notes |
|---|---|---|
| L1–L8 resolved in writing | 🔒 **open** | **None answered.** Blocks launch outright. |
| Consent text reviewed by counsel, published ar + fr | 🔒 open | Mechanism built and tested; the *wording* is counsel's (L4) |
| Terms of service state the platform is not a diagnostic tool | ⬜ open | Viewer banner is done and tested; ToS not written |
| Retention periods configured to match L5 | 🔒 open | Config keys exist with **placeholder** values. Object Lock retention is **irreversible** — do not apply a guess |
| DPA/BAA-equivalent signed with cloud provider | 🔒 open | No account exists |

**Payment entity — RESOLVED (2026-08-10):** the business is incorporated in
**Estonia**, which Stripe supports. D2's authorise-then-capture works as built.

**Two obligations that follow from that, and are now open items:**

| Item | Status | Notes |
|---|---|---|
| DPA signed with AWS (GDPR Art 28) | 🔒 open | L3 is now unconditional, not conditional |
| **SCCs with each Tunisian doctor/clinic** | 🔒 **open** | Tunisia has no EU adequacy decision. A Tunisian doctor viewing EU-hosted data is a Chapter V restricted transfer |
| Transfer impact assessment | 🔒 open | Accompanies the SCCs |
| Breach notification assumed at 72h (GDPR Art 33) | ⚠️ | Supersedes the "unknown" in the incident runbook unless L8 finds something stricter |

**Product consequence:** a Tunisian doctor must not be verified/activated until
their SCCs are signed. `identity_doctor_profiles.verified_at` is the gate.

---

## Access control

| Item | Status | Evidence |
|---|---|---|
| All P3.2 RLS tests green in CI | ✅ | 21 tests; run in CI on every commit against real PostgreSQL |
| Cross-doctor and cross-patient isolation verified end-to-end | ✅ | `patients.e2e.test.ts` — through HTTP, 404 not 403 |
| Consent revocation immediately removes access | ✅ | `consent.test.ts` — access disappears on next query |
| MFA enforced on all clinical accounts | 🏠 **local** | API guard verified by test; Keycloak conditional-MFA flow now bound and **exercised in a real browser** — a doctor with no TOTP lands on `CONFIGURE_TOTP` and receives no code; a patient completes login unprompted. Local Keycloak only |
| No standing production data access for engineers | 🔒 open | P14.1 — no production exists |

**MFA — what was actually wrong, and what is now proven.**

`configure-mfa.sh` did not work. It created `conditional-user-role` executions
and never set their role config, used a non-subflow provider for the
conditional subflow, and never bound the flow. The result enforced **nothing**.
It went unnoticed because `AuthGuard` independently rejects a clinical-role
token showing no second factor, so the misconfiguration failed *closed* —
doctors locked out rather than let in.

Rewritten against the admin REST API, idempotent, and now verified
behaviourally by `pnpm verify:mfa`, which drives a real browser through the
login page (conditional MFA lives in the browser flow; a direct-grant request
would bypass it and prove nothing):

- a `libya_doctor` with no TOTP lands on
  `login-actions/required-action?execution=CONFIGURE_TOTP`, and the callback
  receives **no authorization code**;
- a `patient` completes login and is never prompted.

**The probe was proven by negative control:** rebinding the realm to the stock
`browser` flow made the doctor complete login and receive a code, and the probe
failed 3 checks. A green run therefore means something.

**Still `local`, not verified:** this is the compose Keycloak. The deployed
realm is a different artifact and the same check must be run against it. The
script also refuses to report a pass if the dev-only hardcoded `amr` mapper is
present, since that would make every token claim a second factor.

---

## Data integrity

| Item | Status | Evidence |
|---|---|---|
| Object Lock verified — originals cannot be deleted | 🔒 **open** | Terraform written (compliance mode). The probe is now **written and runnable** (`pnpm verify:object-lock`), but **has never run against real S3**. This is the spec's single most important infra gate — see the LocalStack note below |
| Cross-region replication verified | 🔒 open | Configured, never applied |
| Checksums verified end-to-end on upload | ✅ | `upload.test.ts` — SHA-256 over decoded original; corrupt chunk rejected |
| PITR restore drill completed within target RTO | 🔒 open / 🏠 local | Managed RDS PITR **unmeasured** (no account). A **local** basebackup restore was executed 2026-08-29: RTO 123.2 s, 18/18 instances still mapped to the right patient and checksum, RLS and the booking exclusion constraint survived (that constraint is gone as of migration 0025 — the drill is still evidence that constraints survive a restore, but it needs re-running against the current schema). Not the RDS figure — see `dr.md` |
| No lossy transcoding anywhere in the pipeline | ✅ | Byte-for-byte equality asserted; Orthanc `IngestTranscoding` omitted; lossy syntaxes flagged not converted |

**Object Lock — why LocalStack does not count.** The probe was exercised
against LocalStack 3.8 on 2026-08-29 to validate its own logic. It confirmed
the mechanics: COMPLIANCE mode is detected, the upload is versioned and
inherits retention, and **deleting the object version is rejected while the
object survives**. Two assertions could not be exercised, both LocalStack
fidelity limits rather than probe defects:

- **The reason for the rejection.** LocalStack returns a bare `AccessDenied`
  with no mention of Object Lock, so the check distinguishing *lock-enforced*
  from *policy-enforced* cannot fire. That distinction is the whole point — an
  object "protected" by a bucket policy is deletable by anyone who can edit
  that policy — and it remains **unproven**.
- **Anonymous access.** LocalStack reports `RestrictPublicBuckets: true` and
  then serves the object anonymously with HTTP 200. It stores the
  public-access-block configuration without enforcing it.

Cross-region replication was not exercised at all. **P2.4 stays blocked.**

---

## Reliability

| Item | Status | Evidence |
|---|---|---|
| Interrupted upload resumes on a poor connection | ✅ | Resume verified three ways: service-level abort, browser hard-close, and a **TCP RST mid-transfer** through an interposed proxy (no FIN) — resumed from server state, checksum matched, deterministic over 5 runs |
| ~~Concurrency: exactly one booking wins a contested slot~~ | ⬜ retired | Migration 0025 removed the slot and its exclusion constraint, so there is no contended resource left to race for. The gate was deleted rather than adapted: a concurrency test that can no longer fail reads as protection that is not there. **What replaced it** is the status guard — every lifecycle verb is a conditional UPDATE naming the state it is legal from, covered by the case lifecycle suite |
| p95 time-to-first-image under target on throttled connection | ✅ | **~1.0s** vs 5s budget at 2 Mbit/s / 200ms, desktop and mobile |

---

## Security

| Item | Status | Evidence |
|---|---|---|
| Pen test complete, high/critical remediated | 🔒 **open** | Not commissioned. **Spec: do not onboard real patients before this** |
| Secret scanning enforced in CI | ✅ | gitleaks; proven to catch planted AWS/GitHub/Orthanc credentials |
| Dependency scanning enforced in CI | ✅ | `pnpm scan:verify` plants minimist@1.2.5 (GHSA-xvch-5gv4-984h), asserts audit goes red **by advisory id**, restores the tree byte-for-byte |
| Log scrubbing verified with real sensitive payloads | ✅ | Scrubber **now actually in the log path** — an error raised over real HTTP logs its phone/JWT/email redacted; proven by negative control. One **documented limitation** below |
| Audit log immutability verified | ✅ | UPDATE and DELETE both denied to `mir_app`; row survives both |
| Security headers set and asserted | ⚠️ **partial** | CSP, HSTS, Permissions-Policy, COOP/CORP on both apps, asserted by directive in 6 API + 3 browser tests. **`script-src 'unsafe-inline'` remains** — see below. Cloudflare WAF/rate limiting/bot protection unconfigured |

**Rate limiting — what was actually wrong.** `rate-limiter.ts` was written and
tested and referenced by nothing outside its own test, so **the API applied no
rate limiting to any route**. The ledger said "logic tested; no alert
delivery", which reads as *the limiter works, the alerting does not* — the
limiter was not in the request path at all. The intent was even visible in
neighbouring code: `PatientsController` validates claim-token shape early "so a
400 is returned for obvious junk without consuming rate-limit budget". There
was no budget.

Now enforced over real HTTP on the three abuse-prone routes, opt-in per route
so no clinical read path is throttled:

| Route | Budget | Keyed on |
|---|---|---|
| `POST /patients/:id/claim-token` | 3 / 15 min | **the patient** |
| `POST /patients/claim` | 5 / 5 min | the caller |
| `POST /uploads` | 60 / min | the caller |

The claim-token budget is keyed on the **patient, not the doctor**, and that
distinction was a bug in the first version of this work: keyed on the doctor, a
clinic onboarding a fourth patient in a morning is refused — legitimate work
denied by a control meant to stop phone bombing. Asserted by a test that
exhausts one target and confirms a second is unaffected.

**Two limits that are yours to close before deploying:** the store is in
memory, so N replicas permit N times the rate and a deploy clears every
lockout — `REDIS_URL` and a `redis` service already exist but no client is
installed, and a distributed store should not be invented speculatively for a
deployment that does not exist. And the anomaly sweep (`ANOMALY_SWEEP_SQL`) has
no scheduler and no alert channel, because there is no on-call rotation to
route to.

**CSP limitation, stated plainly:** `script-src` carries `'unsafe-inline'`.
Next's App Router streams RSC payloads through inline `<script>` tags, and
without it the application does not hydrate at all — verified, not assumed: the
e2e suite fails 44 of 52 with the tightened policy. The correct fix is a
per-request nonce; it was implemented and **does not work here**, because Next
stamps nonces only onto dynamically rendered pages and these routes are
statically prerendered. Adopting it means forcing dynamic rendering app-wide —
an architecture decision, not a config tweak. What bounds the exposure
meanwhile: the app contains no `dangerouslySetInnerHTML`, no `innerHTML`
assignment, no `eval` and no `new Function`, and that claim is enforced by a
test (`apps/web/lib/security/xss-surface.test.ts`) rather than left in a
comment.

**The scrubber was not wired in, and this is how that was found.** The 16 unit
tests were green and testing the right function. Nothing called it: neither
`formatLogLine` nor `sentryBeforeSend` had a single non-test caller, and the
API ran on Nest's default console logger, so `GlobalExceptionFilter` printed
exception messages verbatim. The evidence was in the CI output the whole time —
the suite's own log lines showed a patient name in full — and was read as test
noise. Same failure shape as `configure-mfa.sh`: correct code, never reached.

Fixed by routing at the sink (`ScrubbingLogger`, installed in `main.ts` with
`bufferLogs` so framework startup lines cannot escape first) rather than at
each call site, so a log call written by someone who has never read PHASE 13
still gets scrubbed. `scrubbing-logger.test.ts` raises an error through a real
HTTP request and asserts the phone, JWT and email do not reach the sink; a
**negative control** in the same file removes the logger and shows all three
leaking, so a green run means something.

**Two limitations remain, stated plainly:**

- A patient name appearing *only* in free text, with no accompanying field to
  learn it from, is **not** scrubbed. Names have no detectable shape. The
  mitigation is not to interpolate patient data into messages; the limitation
  is recorded as a passing test so nobody mistakes it for coverage.
- **There is no Sentry.** The `sentryBeforeSend` hook is written and tested,
  but no Sentry SDK is installed and no DSN is configured, so the gate's
  "confirm neither appears in Sentry" half is **untestable here** — not passed.
  Earlier wording in this file claimed Sentry payloads were covered. They are
  not; there is nothing to cover yet.

---

## Operations

| Item | Status | Evidence |
|---|---|---|
| Alerts fire and reach a human on call | ⬜ open | Detection logic written and tested; **no on-call rotation exists** |
| Incident response runbook exercised | ✅ / ⚠️ | Forensic queries **executed** against seeded data 2026-08-29; 4 gaps found and fixed, incl. one returning an empty audit log rather than an error. **Live multi-person tabletop still outstanding** |
| Staging contains zero real patient records — verified by query | 🔒 open | No staging exists. ADR-7 enforced in CI for `test-data/` |

---

## Claims

| Item | Status |
|---|---|
| Marketing describes security accurately | ⬜ open — no marketing material yet |

When it is written: **do not use "military grade".** It is not a technical
standard and overclaiming becomes a liability during a breach investigation.
Describe the architecture — AES-256 at rest, TLS 1.3 in transit, row-level
access control, immutable audit log — and only claim what the Verified column
above supports.

---

## Phase completion

| Phase | Status |
|---|---|
| P0 Foundations | ✅ |
| P1 Guardrails | ✅ (P1.3 red/green proven locally; never on a real PR) |
| P2 Infrastructure | 🔒 written, **zero gates run** |
| P3 Schema + RLS | ✅ |
| P4 Identity, audit | ✅ except Keycloak deployment |
| P5 Patients, consent | ✅ |
| P6 DICOM validation | ✅ |
| P7 Resumable upload | ✅ except physically-severed-network test |
| P8 Orthanc + DICOMweb | ✅ locally; VPC isolation unverified |
| P9 Viewer | ✅ gates met; Cornerstone3D installed and wired, **full-fidelity render unproven against a real Orthanc** |
| P10 Scheduling | ✅ |
| P11 Payments | ✅ code; **rail viability unresolved (L7/D2a)** |
| P12 Notifications | ✅ templates + guard; no delivery provider wired |
| P13 Observability | ⚠️ scrubber now in the log path AND tracer now emitting spans — both were tested but uncalled; **no Sentry SDK**, so the gate's Sentry half is untestable |
| P14 Hardening | ⚠️ threat model + dep scanning; rate limiting now enforced in-app; **no pen test**, no edge config |
| P15 Resilience | ⚠️ restore drill + IR query walkthrough executed; region-failure drill and live tabletop outstanding |
| P16 This checklist | ✅ |

---

## What is left, and who can do it

Nothing below can be closed from inside this repository. Each needs an account,
a signature, a person, or a decision.

### Blocks launch outright

1. **Get L1 answered.** If the cross-border transfer is not lawful, nothing
   else matters. L2–L8 follow it.
2. **Commission the penetration test**, focused on authorization boundaries
   between doctors and between patients. The spec is explicit: do not onboard
   real patients before it.
3. **Sign the DPA with AWS, and SCCs with every Tunisian doctor or clinic.**
   Tunisia has no adequacy decision, so a Tunisian doctor viewing EU-hosted
   data is a Chapter V restricted transfer. `verified_at` is the product gate.

### Needs an AWS account, then one command each

4. **Run the P2.4 Object Lock probe** — `pnpm verify:object-lock`. The one gate
   the spec singles out. Written and runnable; LocalStack proved its mechanics
   but cannot prove the delete is refused *by the lock* rather than by a bucket
   policy, which is the entire question.
5. **Measure managed RDS PITR** (P2.5). The 123 s figure in `dr.md` is a
   single-node local basebackup and must never be quoted as the RDS number.
6. **Set a real Object Lock retention period** to match L5 before applying any
   Terraform. Compliance mode is **irreversible** — a guess is permanent.

### Needs a decision from you, then is straightforward

7. **Swap the rate-limit store to Redis** before running more than one API
   replica. In-memory buckets mean N replicas permit N times the rate and a
   deploy clears every lockout. `REDIS_URL` and the `redis` service already
   exist; no client is installed.
8. **Choose an alerting destination and an on-call rotation.** The anomaly
   sweep SQL and the detection logic exist; there is nowhere to send a page, so
   P4.5 stays partial. Detection without delivery is not alerting.
9. **Decide on Sentry.** The `sentryBeforeSend` scrubbing hook is written and
   tested, but no SDK is installed, so half of the P13 gate has nothing to test
   against.
10. **Write the terms of service**, stating the platform is not a diagnostic
    tool. The viewer banner is built and tested; the wording is not, and it is
    counsel's, not mine.

### Cheap, and routinely finds real problems

11. **Run the live multi-person incident tabletop.** The forensic queries were
    executed against seeded data and four gaps were found and fixed, but a
    walkthrough by one person is not the exercise.
12. **Run one region-failure drill (P15.2)** with an operator who did not write
    the runbook. That constraint is the point of it.

---

## A note on how the last defects were found

Six of the seven defects fixed in this repository recently were the same shape:
**correct, well-tested code that nothing called.** A green suite proves a
function works; it cannot prove the application reaches it, because the tests
are themselves the references that make it look used.

`pnpm scan:unwired` lists exports referenced only by tests. It is a review aid,
not a gate — test doubles and harnesses show up legitimately — but a security
control in its output is a defect until proven otherwise. It is worth reading
before trusting any ✅ in this document.
