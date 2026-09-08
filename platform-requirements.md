# Online Medical Consulting Platform — Product Requirements

**Status:** authoritative. Revision 2 — 2026-09-08.
**Supersedes:** revision 1 (undated), which stated ten topics without build state,
carried three statements that contradict settled decisions, and omitted the
commercial and legal terms the build cannot be finished without.

## How to read this

This is the **product** source of truth: what the platform is for and what it
owes its users. Two other documents sit under it and neither overrides it:

| Document | Owns |
|---|---|
| `BUILD_SPEC.md` | Build order, architecture decisions (ADR-1..7), legal blockers L1–L8 |
| `frontend-technical-brief.md` | Screen-level frontend requirements. Code comments cite it as "brief §5.1" etc. Its §-numbers are **not** this document's. |
| `docs/decisions.md` | Dated product decisions D1–D5 and their revisions |

Every requirement below carries its build state, so this file doubles as the
list of what is left:

- **Built** — implemented and covered by tests.
- **Partial** — something exists; the gap is stated.
- **Not built** — nothing exists.
- **Blocked** — cannot be built until a named decision or legal answer lands.

A requirement with no state is a statement of intent, not a work item.

---

## 0. Vocabulary — who the two sides are

**There are no Libyan doctors on this platform.** The Libyan side is a
**laboratory or clinic** — an organisation. Its staff hold seats in that
organisation. The Tunisian side is an **individual doctor**. Wherever this
document says "the lab" it means the Libyan organisation, and "the doctor"
means the Tunisian clinician.

**Known naming debt.** The stored role identifier for the Libyan side is
`libya_doctor`. It is a legacy access-subject name, not a claim that a Libyan
doctor holds an account — see the rationale at `packages/contracts/src/corridor.ts:7`.
Renaming it touches ~299 occurrences across RLS policies, four migrations and
the Keycloak realm, so it stays. Presentation code never sees it: screens ask
for a `CaseSide` (`source` / `destination` / `ops`).

**Conflict to resolve:** `frontend-technical-brief.md` §3 says "Libyan
clinics/labs/**doctors**". That brief is stale on this point. This document wins.

---

## 1. Business model

Online consulting platform connecting **Libyan laboratories/clinics** with
**Tunisian doctors**.

### 1.1 Revenue streams

| Stream | State |
|---|---|
| Pay-per-consult | **Partial** — the price is computed and locked; no money moves. |
| Monthly subscription plans | **Partial** — tiers exist, side-scoped (migration 0022); seat and case limits are stored but **unenforced**, and nothing charges. |
| Per-case coordination fee | **Partial** — `billing_fee_schedule` (migration 0023) holds a per-corridor, per-side fee. Revision 1 did not mention this stream at all. |

### 1.2 How a consult is priced

The **platform** sets the price. A doctor does not quote; a lab does not
negotiate. Three published terms (`packages/contracts/src/pricing.ts`):

```
quote = specialty base rate  ×  the doctor's earned tier  ×  scarcity surge
```

- Base rate is per specialty, per corridor, in USD (`pricing_specialty_rates`).
  **The seeded numbers are placeholders, not an agreed price list.**
- Tier multiplier is earned from answered cases: `standard` / `senior` / `expert`.
- Surge is a bounded four-rung ladder read off how many doctors in that
  specialty are currently accepting. Nobody accepting means the specialty is
  **closed** — a 409, not a very large price.
- The quote is locked against the case with a TTL and expires.

**State: Built.**

### 1.3 The revenue split — NOT DEFINED

Nothing anywhere states what share of the consult price the platform keeps and
what reaches the doctor. §10 of revision 1 spoke of a "reduced commission" as
an incentive without a commission ever having been set.

Until this is decided there is no payout to compute and no invoice to render.

**State: Blocked — decision C1.**

### 1.4 Surge pricing is not legally cleared

Whether surge pricing on medical consults is defensible is a question for
counsel, not for this file. The technical mitigation — a bounded, published
ladder rather than a continuous opaque one — is not an answer.

**State: Blocked — decision L9.**

---

## 2. Accounts, roles and access

### 2.1 Who can hold an account

Revision 1 said "only two account types can register". That was never the whole
model. The real set:

| Account | Registers? | Notes |
|---|---|---|
| Libyan lab / clinic (organisation) | Yes | Verified. Holds seats. |
| Tunisian doctor (individual) | Yes | Verified. |
| Platform admin / ops | **No** — provisioned, never self-registered | Separate flow by design (brief §3). |
| Applicant | Transitional | Held by an organisation awaiting a verification decision. |
| Assistant | Invited, not registered | A seat inside an organisation. Sees an agenda projection, never imaging. |

Roles as stored: `libya_doctor`, `tunisia_doctor`, `admin`, `applicant`,
`assistant` (`packages/contracts/src/roles.ts:57`). Seat roles inside an
organisation: `owner`, `member`, `assistant`.

**Explicitly excluded from registering:** Tunisian clinics/hospitals, Libyan
hospitals, and Libyan doctors as individuals.

**State: Built.**

### 2.2 Second factor

TOTP is required before login completes for every clinical role and for
assistants. Revision 1's security section did not ask for this.

**State: Built.**

---

## 3. Doctor verification (Tunisian side)

Manual review by the ops team.

### 3.1 What is collected

Requirements are **corridor data**, not hardcoded (`apps/web/lib/corridor/registry.ts`):

| Side | Required |
|---|---|
| Tunisian doctor | CNOM number (ordre des médecins), facility permit (file) |
| Libyan lab/clinic | Licence number, facility permit (file) |

**State: Partial.** Two defects:

1. **A required document is collected as text.** `CorridorFields.tsx` has no
   branch for `kind: 'file'` — it falls through to a text input, so the permit
   is stored as a typed string and no document is ever uploaded or reviewed.
2. **No national ID (CIN).** Revision 1 required the CIN alongside the ordre
   card. It is not in the corridor's document requirements.

### 3.2 The 3-working-day response

The platform commits to an ops decision within **3 working days**. The applicant
can see where they stand without contacting the team (`/verification` renders
the decision, its date, and — when refused — a reason chosen from a fixed list
of dictionary keys, never free text).

**State: Partial.** The screen exists; nothing measures the 3 days, no clock
starts on submission, and no alert fires when one is about to be missed.

### 3.3 SCCs are a precondition of verification

A Tunisian doctor viewing EU-hosted imaging is a restricted transfer to a
country with no adequacy decision (see §8.1). Standard Contractual Clauses must
be signed **before** the doctor is activated: `identity_doctor_profiles.verified_at`
must not be set without them.

**State: Not built.** Revision 1 did not know this requirement existed.

### 3.4 Account is inactive until approved

**State: Built.**

---

## 4. Money: collection, escrow and payout

### 4.1 The rule

Funds from the lab are held by the platform and released to the doctor **only
once the doctor submits their answer**.

**State: Not built.** `POST /cases/:id/pay` records a state transition and moves
nothing. There is no hold, and no decision on where the money sits between
payment and release. The seam is marked in `cases.controller.ts:221`.

### 4.2 The rail

**Stripe** (decision D2a), chosen because it supports authorise-then-capture.
The implementation exists behind an internal `PaymentRail` interface and is
**deliberately unwired** — `apps/api/src/modules/billing/internal/payment-rail.ts`
is imported by nothing, and its header comment says why. Do not wire it up to
quiet the `pnpm scan:unwired` report.

PayPal appears in revision 1 but was never evaluated. It is not a rail until
someone evaluates it against the same auth/capture requirement.

**State: Blocked — L7.** Whether a Libyan payer can lawfully and practically pay
a Tunisian-facing platform, and whether Libyan-issued cards clear on
international rails under sanctions screening, is unanswered in writing.

### 4.3 Payout to the doctor

Charged in USD, paid out in TND to a Tunisian bank account.

**State: Not built.** No bank details are captured at onboarding, no
USD→TND conversion exists, no payout is computed — and it cannot be computed
until the split in §1.3 is decided. The platform must **never store raw bank
credentials**; tokenise via the processor.

### 4.4 If the doctor never answers

**State: Blocked — decision C2.** This needs three numbers before any of it can
be built: how long the doctor has to answer, what the lab is refunded, and who
arbitrates a disputed answer. The schema already carries `answer_due_at` with
no policy behind it.

### 4.5 Entity and jurisdiction

The business is incorporated in **Estonia** (decisions.md, 2026-08-10) — not
Libya, not Tunisia. Revision 1 never named the operating entity, which is the
fact that determines both the payment rail and the data-protection regime.

---

## 5. Imaging and the doctor's answer

### 5.1 The viewer

Built-in DICOM viewer for MRI/CT/X-ray, no external software.
Cornerstone3D. DICOM is the only accepted format (ADR-2). Original bytes are
immutable and never re-encoded (ADR-4, ADR-5).

**State: Built.**

### 5.2 Reference-only is a regulatory line, not a disclaimer

The viewer is **reference viewing only — not for diagnostic use**. The receiving
doctor performs the diagnostic read on their own validated equipment. This is a
deliberate constraint that keeps the product on the transfer side of
medical-device regulation (`BUILD_SPEC.md` §1.3), and it must appear in the
terms of service, as a persistent banner in the viewer, and in marketing.

**State: Built.**

### 5.3 The doctor's answer — the unresolved conflict

Revision 1 required the doctor to "enter prescription and diagnosis directly on
the platform". **That contradicts §5.2.** A platform that hosts the diagnostic
act is arguing a different regulatory case from one that transfers a study and
coordinates a consult.

Today `POST /cases/:id/answer` takes **no body** — it flips the case to
`answered` and stores no clinical content at all.

**State: Blocked — decision C3.** Three options, and this document does not pick
one:

1. **Structured answer authored in-platform** (revision 1's reading). Moves the
   medical-device line and needs counsel before a line of it is written.
2. **Answer as an uploaded signed report**, authored on the doctor's own
   equipment and attached. Keeps §5.2 intact.
3. **Answer as a free-text impression** plus a mandatory statement that the
   formal read was performed elsewhere.

Cross-border **prescribing** — a Tunisian doctor writing a prescription for a
Libyan patient — is a separate legal question revision 1 did not raise at all.

### 5.4 De-identification is a pipeline, not a promise

**State: Not built.** See §7.2. This is the requirement that makes §7 achievable
and revision 1 omitted it entirely.

---

## 6. Language and translation

### 6.1 Interface languages

Arabic and French, RTL from day one (decision D4). Consent text is versioned
per locale and its evidence hash is the hash of the text in the locale the
signer actually saw.

The UI dictionary currently ships **three** locales — `ar`, `fr`, `en` — while
consent content is constrained to `ar` and `fr`.

**State: Built.**

### 6.2 English as the default — under review

Revision 1 stated English as the platform's main language. D4 decided the
opposite: Arabic and French, **no English in v1**. The question is open, not
settled in either direction, and it is being put to counsel and the product
owner. Until it is answered, D4 stands.

**State: Blocked — decision C4.**

### 6.3 Document translation

Automatic or facilitated translation of the doctor's answer and the lab's
analysis files, in four directions: EN→FR, AR→FR, FR→EN, FR→AR.

**State: Not built.** Nothing exists. The UI string catalogue is not a
translation pipeline.

Three things must be decided before it can be: whether translation is machine
or human-medical, **which version is the legal record** when a translation and
an original disagree, and who carries liability for a mistranslated finding.

**State: Blocked — decision C5.**

---

## 7. Confidentiality — the top rule

**The Tunisian doctor must never see patient personal identifiers.** Name,
phone, email, national ID. The doctor receives only the medical files and
clinical detail strictly necessary for the read. Identity stays with the
Libyan lab.

This is the platform's stated first rule. It is currently **not enforced**.

### 7.1 The application-layer leak

**State: Partial — the rule is broken today.** Every case read joins the
patient's name into the payload (`cases.service.ts:120`, `p.full_name AS
patient_name`) and returns it to the doctor. Only the web UI declines to render
it (`apps/web/app/doctor/page.tsx` shows the case reference and no patient).
A UI that chooses not to display a field is not a confidentiality control — the
field is one API client away.

Suppression must land at the **API and RLS layers**, not the screen.

### 7.2 Identifiers ride inside the imaging

**State: Not built.** Patient identifiers are not only in the database. They are
in the DICOM headers (`PatientName`, `PatientID`, and a long tail of others),
and they can be **burned into the pixels** of scanned or annotated images. No
de-identification pipeline exists in `packages/dicom-utils`.

§7 cannot be satisfied without one. This is the largest single gap between what
this document promises and what the platform does.

Note ADR-4: original bytes are immutable. De-identification therefore produces a
**derived doctor-facing object**; it never rewrites the stored original.

### 7.3 "Strictly necessary clinical detail" is undefined

Nobody has written down which fields a doctor does receive. Until that list
exists, §7 is a principle that cannot be tested — and every screen and query
that touches a case is guessing.

**State: Blocked — decision C6.**

---

## 8. Security and data protection

Maximum-level security, treated as zero-tolerance given the sensitivity of the
data.

### 8.1 The regime is GDPR, not HIPAA

Revision 1 proposed "HIPAA-equivalent" alignment. That is the wrong frame. With
an **Estonian** controller and EU hosting:

- **GDPR applies directly.** Medical imaging is **Article 9 special-category
  data** and needs an Article 9(2) condition — in practice explicit consent,
  which the consent module already captures with evidence, versioning and a
  rendered-text hash.
- The supervisory authority is the Estonian **Andmekaitse Inspektsioon (AKI)**.
- A **DPA with the cloud provider** is required.
- **Breach notification is 72 hours** (Article 33). This is the binding deadline
  for L8 and the number the incident-response runbook must assume.
- A Tunisian doctor's access is a **restricted transfer** under Chapter V.
  Tunisia has no adequacy decision, so it needs an Article 46 safeguard — SCCs
  plus a transfer impact assessment. See §3.3.

### 8.2 Controls

| Control | State |
|---|---|
| Encryption in transit and at rest | Built |
| Role-based access control | Built |
| PostgreSQL row-level security as an independent second layer (ADR-6) | Built |
| Audit log of every access to patient files | Built |
| Errors never confirm the existence of records the caller cannot see (404, never 403) | Built |
| TOTP second factor for clinical roles | Built |
| Synthetic data only outside production (ADR-7) | Built |
| Retention and deletion schedule | **Not built** — blocked on L5 |
| Breach-notification runbook at 72h | **Not built** |
| Penetration test before launch | **Not built** |
| Bank credentials tokenised, never stored raw | **Not built** — see §4.3 |

---

## 9. User experience — lab side

Patient intake must be fast, simple and frictionless: minimal required fields,
drag-and-drop upload, progress indication, mobile-friendly.

**State: Partial.** The intake exists and its fields are corridor data. What is
missing is any **number** to hold it to — see §11. "100% UX" is not a
requirement anyone can pass or fail.

---

## 10. Doctor performance, tiers and analytics

### 10.1 What is tracked per doctor

Total earnings, total consults handled, number of "correct" consults.

**State: Not built.** No earnings figure exists (it cannot — §1.3), no consult
count is aggregated, and no admin screen renders any of it.

### 10.2 Tiers

`pricing_tiers` carries a `min_answered` threshold per tier, and the tier
multiplies the consult price (§1.2).

**State: Partial.** `tier_code` is read but never written outside its migration
default. **Every doctor is `standard` and always will be** until a promotion job
exists. A tier ladder nobody climbs is a pricing term that does nothing.

### 10.3 "Correct consult" is undefined

The scoring metric — no disputes? positive lab feedback? no revision requests? —
has never been defined. §10 is unbuildable until it is, and so is the
promotions/incentives system built on top of it.

**State: Blocked — decision C7.**

---

## 11. Non-functional requirements — NOT DEFINED

Revision 1 set no numbers. The build cannot be verified against "fast" or
"maximum". Each of the following needs a figure before launch:

| Area | What must be decided |
|---|---|
| Study size | Maximum accepted upload. Studies are hundreds of MB over a constrained Libyan link. |
| Upload resilience | Resumable upload is effectively mandatory at that size. Confirm and set a resume window. |
| Turnaround | Time a doctor has to answer (§4.4) and time a lab waits for a directory quote. |
| Availability | Uptime target, and what degraded service means for a case already paid for. |
| Backup / DR | RPO and RTO. `eu-south-1` primary, `eu-west-3` DR (D5). |
| Support | Browsers, minimum screen size, whether the lab side must work on a phone. |
| Retention | Per §8.2, blocked on L5. |

**State: Blocked — decision C8.**

---

## 12. Build order

The sub-project numbering below is used throughout the codebase in `TODO` and
comment references. Until now it existed only as scattered forward-references
and was never written down in one place. This is that list.

| # | Sub-project | Delivers | Status |
|---|---|---|---|
| 1 | Consult model | Status machine, pricing formula, directory, quote/pay verbs, HTTP surface, web screens | **Done** (2026-09-07) |
| 2 | Identifier suppression | §7.1 and §7.2 — API/RLS suppression and the de-identification pipeline | Next |
| 3 | Answer authoring | §5.3, once C3 is decided | Blocked on C3 |
| 4 | Escrow and settlement | §4.1–§4.3, once L7 and C1 are answered | Blocked on L7, C1 |
| 5 | Verification hardening | §3.1 file upload, §3.2 SLA clock, §3.3 SCC gate | Ready |
| 6 | Localisation and translation | §6.2 and §6.3 | Blocked on C4, C5 |
| 7 | Tiers and analytics | §10.1–§10.3 | Blocked on C7 |

**Sub-project 2 is next and is not blocked on anything.** It is this document's
stated top rule, and it is the one gap where the platform currently promises
something it does not do. No doctor-facing screen should be put in front of
real patient data until it lands.

---

## 13. Decisions register

Replaces revision 1's open-questions list. Each entry names who decides and what
it blocks — an open question with no owner is a question nobody is answering.

### Commercial and product (owner: project owner)

| # | Question | Blocks |
|---|---|---|
| C1 | Platform's share of the consult price | §1.3, payouts, sub-project 4 |
| C2 | Answer deadline, refund policy, dispute arbitration | §4.4, sub-project 4 |
| C3 | Is the diagnosis authored in-platform, uploaded, or an impression only? | §5.3, sub-project 3 |
| C4 | Is English the default interface language? | §6.2, sub-project 6 |
| C5 | Machine or human translation; which version is the legal record | §6.3, sub-project 6 |
| C6 | The exact field list a doctor receives | §7.3 only. Does **not** block §7.1 or §7.2: suppressing the identifiers already named — name, phone, email, national ID — needs no further decision. |
| C7 | Definition of a "correct consult" | §10.3, sub-project 7 |
| C8 | Non-functional numbers | §11, launch |

### Legal (owner: counsel — must not be decided by the build team)

Carried from `BUILD_SPEC.md` §2, plus one new.

| # | Question | Blocks |
|---|---|---|
| L1 | Lawful basis for moving health data out of Libya | Production data |
| L2 | Tunisian INPDP registration | Production data |
| L3 | GDPR posture of the Estonian entity — **live, not hypothetical** | §8.1 |
| L4 | Required form of patient consent for cross-border transfer | Consent content |
| L5 | Retention obligations in both countries | §8.2, §11 |
| L6 | Whether a pre-arrival read is regulated telemedicine | §5.3 |
| L7 | Whether a Libyan payer can lawfully pay a Tunisian-facing platform | §4.2, sub-project 4 |
| L8 | Breach notification — likely answered by Article 33's 72 hours | §8.2 |
| **L9** | **Whether surge pricing on medical consults is defensible** | §1.4 |

**Do not onboard real patients until L1, L4 and L7 are answered in writing.**
