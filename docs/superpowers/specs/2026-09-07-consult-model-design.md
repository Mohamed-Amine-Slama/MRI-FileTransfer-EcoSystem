# The consult model: a doctor directory, a priced case, an answer

Date: 2026-09-07
Status: approved design, not yet implemented
Sub-project: **1 of 7** in the PRD alignment programme (see "Where this sits")

## Summary

The platform stops being a *transfer and scheduling* service and becomes a
*consulting* service. A Libyan laboratory uploads a patient's imaging, browses
the Tunisian doctors who are currently accepting work, picks one at a price the
platform quotes, and receives a diagnosis. Money is held from payment and moves
to the doctor when the answer is submitted.

Three things follow, and this spec covers only the first:

1. **The calendar goes.** There are no slots, no availability windows, no
   bookings and no reminders. A doctor is either accepting cases or not.
2. **The case becomes the unit of work and of billing**, with a price that is
   quoted once and never recomputed.
3. **The doctor is a payee, not a payer.** This spec builds the case states and
   the price that sub-project 4 settles against; it moves no money.

## Where this sits

The PRD describes seven independent workstreams. In dependency order:

| # | Sub-project | Status |
|---|-------------|--------|
| **1** | **Consult model** — case lifecycle, doctor directory, pricing | **this spec** |
| 2 | PII shielding — pseudonymous projection + DICOM de-identification | next |
| 3 | Response module — diagnosis and prescription authoring | after 2 |
| 4 | Escrow and payouts — hold, release, USD→TND, timeout refunds | after 3 |
| 5 | Verification — per-clinician card + CIN, 3-working-day SLA | parallel |
| 6 | English default and the translation pipeline | parallel |
| 7 | Doctor analytics | after 3 and 4 |

Sub-project 7 is **not a leaf**. The tier that multiplies a doctor's price is
computed from the same counters the admin analytics report, so the two share one
source of truth and are built together.

## Decisions taken

| # | Question | Decision |
|---|----------|----------|
| 1 | Booking or a queue? | Neither. A **directory** with a per-doctor on/off switch. The labo chooses. |
| 2 | What does the doctor see before accepting? | A **summary only** — modality, body part, referral reason, urgency, specialty. No images, no files, no identity. |
| 3 | What happens on decline? | The case returns to the labo, who picks another doctor. **The payment hold is retained** — they do not pay twice. |
| 4 | Who sets the price? | The **platform**. Specialty base rate × the doctor's earned tier × a scarcity multiplier. |
| 5 | How does availability affect price? | **Scarcity surge**: the fewer doctors accepting in that specialty, the higher the multiplier. |
| 6 | When is price fixed? | At quote. **Never recomputed.** A quote carries an expiry; the labo pays the quoted number or asks for a new quote. |
| 7 | Rebuild or reshape? | **Reshape `scheduling` in place.** See "Why not a new module". |

## Why not a new module

The obvious move is a fresh `cases` module and the deletion of `scheduling`.
It is the wrong one.

`scheduling_appointments` is already the case record in everything but name.
Migration `0024` put `case_ref` on it; `0023` keyed `billing_ledger_entries`
to it by foreign key and gave it the `declined` state; `0021` rewrote its
policies when the patient role left. More to the point, the `scheduling` module
owns the SECURITY DEFINER predicates that the whole access-control story rests
on — `app_has_appointment_with` (`0002_rls.up.sql:139`), `app_has_consent_for`
(`:154`) and `app_can_see_study` (`:189`, rewritten at
`0021_remove_patient_accounts.up.sql:115`). Those three functions are what the
seven P3.2 gate tests exercise, and BUILD_SPEC calls that gate "the most
important gate in the project."

Migration `0021`'s own header states the rule this design follows:

> A migration that redefined that function would be rewriting the access-control
> core under cover of a role removal.

A new module would rewrite all three from scratch to say almost the same thing.
So: rename the tables, strip the calendar, keep the predicates and adjust them
deliberately, one at a time, each with its gate test green.

---

# Part 1 — The case

## `scheduling_appointments` → `cases_cases`

**Kept as-is:** `id`, `case_ref`, `patient_id`, `created_by`, `doctor_id`,
`reason`, `notes`, `cancel_reason`, `created_at`, and the study link table
(`scheduling_appointment_studies` → `cases_case_studies`).

**Added:**

| Column | Type | Why |
|---|---|---|
| `organisation_id` | `uuid NOT NULL REFERENCES identity_organisations(id)` | The labo that owes. Today it is derived by joining through `patients_patients.created_by_doctor` in `billing_owing_organisation` (`0023_ledger_and_fees.up.sql`, `billing_owing_organisation`); storing it makes the debtor a fact of the case rather than a join that can drift when a clinician changes employer. |
| `specialty` | `text NOT NULL` | The specialty asked for, fixed at submission. Pricing reads it; it must not follow the doctor's profile if that later changes. |
| `quoted_amount_minor` | `bigint` | Null until quoted. |
| `quoted_currency` | `text` | |
| `quoted_at` | `timestamptz` | |
| `quote_expires_at` | `timestamptz` | |
| `accepted_at` | `timestamptz` | Starts the answer clock. |
| `answered_at` | `timestamptz` | The escrow release trigger (sub-project 4). |
| `answer_due_at` | `timestamptz` | Set on accept from config. Drives the timeout. |

**Dropped:** `starts_at`, `ends_at`, `kind`, `reminder_sent_at`, and the
`scheduling_appointments_doctor_id_tstzrange_excl` exclusion constraint. With no
slots there is nothing to double-book, and the constraint's `btree_gist`
dependency goes with it.

## The status machine

Replacing `('pending','confirmed','declined','cancelled','completed','no_show')`:

```
submitted ──> quoted ──> paid ──> accepted ──> answered ──> closed
     ^           │         │          │
     │           │         └ declined ┘   (doctor refuses; returns to
     └───────────┴───────────┘             `submitted`, hold retained)
                 │
                 └─ cancelled  (labo withdraws)
                    expired    (accepted, never answered)
```

**`quoted` carries the doctor.** A quote is for one case *and one doctor*,
because the doctor's tier is a term in the price. There is no separate
`assigned` state: choosing a doctor and locking their price are the same act,
and a state that could hold a case with a doctor but no price — or a price but
no doctor — would be a state the pricing rules cannot describe.

- `no_show` **goes.** There is no appointment to miss. It was added deliberately
  in `0014` and defended in `0023`, so its removal is a decision, not an
  oversight: the verb has no referent once attendance does not exist.
- `declined` **stays and changes meaning** — from "the doctor refused the
  referral" to "the doctor refused this case; pick another." It is still
  distinct from `cancelled`, and for the same reason `0023` gave: a labo reads
  a refusal and a withdrawal differently.
- `expired` is **new** and answers PRD open question 2.

Transitions are enforced in `packages/contracts/src/case.ts`, which already owns
a `TRANSITIONS` table and `canTransition`. The table is rewritten; the shape is
not.

## The API surface follows the tables

`/scheduling/*` becomes `/cases/*`, and `appointmentId` becomes `caseId`
throughout the contracts. This is a breaking rename with no compatibility
shim: the web app is the only consumer, it ships from this repo, and a
deprecated alias would leave two names for one thing in an access-controlled
surface — which is how a policy ends up guarding one of them.

## Availability

One column: `identity_doctor_profiles.accepting_cases boolean NOT NULL DEFAULT false`.

Default `false` is deliberate and matches how `applicant` works — a newly
approved doctor appears in no directory until they say they are open for work.
Nothing about a doctor's presence in the system implies consent to receive cases.

**Deleted:** `scheduling_availability`, `scheduling_availability_rules`
(`0016`), the `rule_id` link, and every endpoint and screen that reads them.

---

# Part 2 — Pricing

## Two tables

```sql
CREATE TABLE pricing_specialty_rates (
  corridor_id   text NOT NULL,
  specialty     text NOT NULL,
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  active        boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corridor_id, specialty)
);

CREATE TABLE pricing_tiers (
  code            text PRIMARY KEY,           -- 'standard' | 'senior' | 'expert'
  multiplier_bp   int NOT NULL CHECK (multiplier_bp > 0),  -- basis points
  min_answered    int NOT NULL,
  sort            int NOT NULL
);
```

A table rather than a constant, for the reason `billing_fee_schedule` is a table
(`0023`): the agreed rate is rows, not a branch in code.

`multiplier_bp` is **basis points, integer**. Money is integer minor units
everywhere in this codebase (`moneySchema` in `packages/contracts/src/ledger.ts`)
and a float multiplier would reintroduce the rounding the design avoids.

## The formula

```
quote = base(corridor, specialty)
      × tier_multiplier(doctor)
      × surge_multiplier(specialty)
```

Rounded once, at the end, half-up to the currency's minor unit
(`CURRENCY_MINOR_UNITS`, already in `ledger.ts`).

Because `tier_multiplier` takes a doctor, **a quote cannot be issued before a
doctor is chosen.** The directory shows each doctor's indicative price computed
by this same formula; picking one turns that indication into the locked quote.

**Tier** is derived from counters, not set by hand: a doctor's answered-case
count and dispute record place them on the ladder. The current tier is
recomputed nightly and cached on `identity_doctor_profiles.tier_code`, so
quoting is one read rather than an aggregation over the case history. The job
that computes it is the same job that feeds admin analytics (sub-project 7).

**Surge** is computed at quote time from the number of doctors in that specialty
with `accepting_cases = true`, against a **published ladder**:

| Doctors accepting | Multiplier |
|---|---|
| 5 or more | ×1.00 |
| 3–4 | ×1.15 |
| 1–2 | ×1.30 |
| 0 | no quote — the specialty is closed |

Bounded and legible on purpose. A continuous formula is impossible to explain to
a labo, impossible to defend to a regulator, and unbounded in exactly the
direction that looks worst in a medical market.

## The quote is a lock

`POST /cases/:id/quote` takes the chosen `doctorId`, writes it alongside
`quoted_amount_minor`, `quoted_at` and `quote_expires_at` (TTL from config,
default 30 minutes), and moves the case to `quoted`. Payment charges **that stored number**, read from the row — never a
recomputation. An expired quote is refused with a clean error and the labo asks
for a new one.

This is not a nicety. A price that changes between the screen and the charge is
a dispute the platform loses, and re-deriving the number at payment time is how
that happens.

---

# Part 3 — The flow

1. **Submit.** The labo creates the case against a patient record, states the
   specialty and the intake fields, and uploads. Status `submitted`.
2. **Pick.** The labo browses the directory — doctors in that specialty with
   `accepting_cases = true`, each showing tier, answered-case count and their
   indicative price — and chooses one.
3. **Quote.** Choosing locks that doctor and that price. Status `quoted`.
4. **Pay.** The labo pays the quoted number; funds are held. Status `paid`, and
   the case is now in front of the doctor. *(Sub-project 4 — this spec defines
   the state and the trigger, and wires no rail.)*
5. **Triage.** The doctor sees the **summary projection only**. Accept →
   `accepted`, imaging unlocks, `answer_due_at` is set. Decline → the case
   returns to `submitted` with the hold intact and the labo picks again.
6. **Answer.** The doctor submits the diagnosis. Status `answered`; the release
   trigger fires. *(Sub-project 3 builds the authoring; sub-project 4 the
   release.)*
7. **Close.** Status `closed`.

**A decline re-prices the case.** The hold was taken against one doctor's
price; the next doctor may sit on a different tier. So re-picking issues a fresh
quote and settles the difference against the existing hold — the labo tops up if
the new doctor costs more, and the excess is released if they cost less. The
alternative, silently reusing the old amount, would either underpay the second
doctor or overcharge the labo, and both are the kind of quiet arithmetic error
that surfaces as a dispute months later.

**Timeout.** A case `accepted` and not `answered` by `answer_due_at` moves to
`expired`: the labo is refunded in full and a counter is recorded against the
doctor, feeding the tier computation. The window is configuration
(`CASES_ANSWER_WINDOW_HOURS`), not a constant — BUILD_SPEC §2 requires exactly
this of anything a legal answer might later move.

**Triage stops being a toggle.** `SCHEDULING_TRIAGE_BEFORE_PAYMENT`
(`config.schema.ts:157`, `.env.example:91`) is deleted. Decision D3 made
summary-before-payment a configurable default-off; in this model a summary
before acceptance is the flow itself, and payment precedes assignment in every
case. A config key that can no longer be false is a lie in the schema.

## Consent is untouched

The labo still attests the patient's signed consent and uploads the scan;
`consent_records`, `attested_by`, `document_sha256` and `app_has_consent_for`
all keep their current shape and semantics. Nothing in the PRD replaces consent,
and it is load-bearing for GDPR Article 9 given the Estonian controller recorded
in `docs/decisions.md`.

---

# Part 4 — What is removed

**Database**
- `scheduling_availability`, `scheduling_availability_rules`, `rule_id`
- The `tstzrange` exclusion constraint and the `btree_gist` dependency
- `scheduling_appointments.starts_at`, `.ends_at`, `.kind`, `.reminder_sent_at`
- The `no_show` status

**API**
- `GET /scheduling/availability`, `POST /scheduling/availability`
- `GET /scheduling/doctors/:id/slots`
- `POST /scheduling/appointments/:id/no-show`
- The reminder job

**Web**
- `/schedule/calendar`, `/schedule/availability`, `/appointments`,
  `/appointments/new`, `/appointments/[id]`
- `components/schedule/*` calendar and slot-picker components

**Config**
- `SCHEDULING_TRIAGE_BEFORE_PAYMENT`

**Contracts**
- Slot and availability schemas; the `no_show` member of the status enum

---

# Part 5 — Testing

**The acceptance bar for the migration is that the seven P3.2 gate tests stay
green through the rename.** They are rewritten to name `cases_cases`, and
nothing else about them changes. If a predicate has to be loosened to make one
pass, that is the signal to stop.

New tests:

| Test | Expected |
|---|---|
| Quote, then pay after the tier changes | Charged the quoted amount, not a recomputed one |
| Quote past its expiry | Refused; no charge; a new quote may be requested |
| Doctor declines, labo picks a dearer doctor | Case returns to `submitted`; new quote issued; only the difference is charged |
| Quote requested against a doctor with `accepting_cases = false` | Refused |
| Surge with 0 doctors accepting | No quote issued; specialty reported closed |
| Case accepted, clock passes `answer_due_at` | Exactly one `expired` transition and one refund, under repeat runs |
| Doctor reads a case in `paid` | Summary fields only; imaging returns 404 |
| Rounding: base × tier × surge | One half-up rounding at the end, integer minor units throughout |

The last one matters more than it looks: three multiplications rounded
independently drift, and the drift lands in the doctor's payout.

---

# Open items this design creates

1. **The medical-device line moves in sub-project 3, not here.** BUILD_SPEC §1.3
   positions the platform as transfer-and-scheduling with a reference-only
   viewer, deliberately outside medical-device regulation. A doctor authoring a
   diagnosis on the platform crosses that line. This spec does not cross it —
   but it removes the scheduling half of the positioning, so §1.3 is already
   stale and must be rewritten when sub-project 3 lands.

2. **`docs/decisions.md` D2, D2a and D3 are superseded.** D2's
   authorise-at-booking / capture-on-acceptance describes a patient card that
   migration `0021` removed; D3's triage toggle is deleted above. Per that
   file's own rule, these are recorded as a new dated revision, not edited in
   place.

3. **The destination-side coordination fee becomes a commission.**
   `billing_fee_schedule` currently charges the Tunisian side $20 per referral
   (`0023`). Under the PRD the doctor is paid, so that row's meaning inverts:
   it becomes the platform's cut of the payout. Sub-project 4 decides whether it
   stays in that table or moves.

4. **Surge pricing on medical consults needs a fairness position.** The ladder is
   bounded and published, which is the technical mitigation. Whether a price
   that rises when few doctors are available is defensible to a Libyan labo, and
   to whichever regulator L2 identifies, is a product and legal question this
   design does not answer.
