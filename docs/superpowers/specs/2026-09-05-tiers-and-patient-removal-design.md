# Subscription tiers and the removal of patient accounts

Date: 2026-09-05
Status: approved design, not yet implemented

## Summary

Two changes, sequenced, in one spec because the first decides the inputs to
the second.

1. **Patient accounts are removed.** A patient becomes a record only — created
   by the referring Libyan doctor, never a login. The Libyan doctor assigns the
   patient to a Tunisian doctor.
2. **Subscription tiers become side-scoped.** One catalogue for the source
   (Libya) side and one for the destination (Tunisia) side, and a per-case
   coordination fee that accrues to *both* orgs at per-corridor rates.

Neither change takes money. Blocking item **L7** — whether a Libyan payer can
lawfully pay a Tunisian-facing platform, and where the receiving entity must be
incorporated — is still unanswered, and this design makes the same commitment
migrations `0007` and `0011` already make: record intent and what is owed, wire
no rail.

## Decisions taken

| # | Question | Decision |
|---|----------|----------|
| 1 | How far does patient access go? | Record only. No login, no token link, no portal. |
| 2 | Who records consent? | The Libyan doctor attests **and** uploads the signed form. |
| 3 | Who pays the coordination fee? | Both sides split it, at per-corridor rates. |
| 4 | Catalogue shape | One catalogue per corridor side. |
| 5 | Limit enforcement | **None, deliberately.** Tier contents are not decided yet. |
| 6 | Removal style | Clean forward migration; drop the login machinery outright. |

## Open item this design creates

**L4 must be re-confirmed by counsel.** `0002_rls.up.sql:317` states *"Only the
patient may grant consent — never the doctor on their behalf (L4)"*, and L4
(`BUILD_SPEC.md:58`) asks what form patient consent must take for cross-border
transfer. This design does not remove patient consent: the patient still signs,
on paper, and the platform holds a scan of the signature — plausibly a stronger
answer to "must it be written? witnessed?" than an in-app checkbox. What changes
is that the row is written by the doctor as an attestation rather than by the
patient as an action. That is a change of legal posture and must be put to
counsel before launch. Until it is answered, the policy comment and the schema
must not be left contradicting each other.

---

# Part 1 — Patient removal

## What stays

`patients_patients` is the clinical record and is untouched apart from losing
`claimed_by_user`. `consent_records` stays, and so does
`app_has_consent_for(patient_id)` — **with its exact current signature and
semantics**. That function gates the receiving doctor's access to patient
demographics (`0002_rls.up.sql:303`) and to imaging (`:200`, `:365`), so
preserving it means the imaging policies — the ones the P3.2 gate tests
directly — are not rewritten by this work. Only the writer of the row changes.

## What is removed

**Identity**
- `patient` leaves `ROLES` in `packages/contracts/src/roles.ts` and the
  `identity_users.role` CHECK constraint.
- `patient` leaves the Keycloak realm configuration.
- `identity.service.ts:54,70` loses its patient branches (the `patientId`
  lookup and the `mfaEnrolled: ctx.role !== 'patient'` special case — with the
  patient gone, every remaining role requires a second factor via
  `SECOND_FACTOR_ROLES`, and that conditional becomes a lie worth deleting).

**The claim flow, in full**
- `patients_claim_tokens` table, its two indexes, and its two policies.
- `patients_claim_with_token(text)`.
- `app_claimed_patient(uuid)`.
- `patients_patients.claimed_by_user` and `patients_patients_claimed_by_idx`.
- `POST /patients/:id/claim-token` and `POST /patients/claim`
  (`patients.controller.ts:102,118`) and the SMS issuance behind them.
- Policy `patients_claimed` (`0002_rls.up.sql:298`).

**Consent policies**
- `consent_patient_select`, `consent_patient_insert`, `consent_patient_revoke`
  (`0002_rls.up.sql:313,317,322`) are dropped.
- `consent_referring_doctor` and `consent_receiving_doctor` stay as-is.

**Guards losing `'patient'`** — mechanical, no behaviour change for the roles
that remain:
- `imaging/internal/dicomweb.controller.ts` — seven guards.
- `imaging/internal/studies.controller.ts:33`.
- `patients/internal/patients.controller.ts:79`.
- `scheduling/internal/scheduling.controller.ts:179,185,232,240,253,277`.
- `consent/internal/consent.controller.ts:49,69`.
- `identity/internal/profile.controller.ts:24,30,36,48`,
  `identity.controller.ts:38`,
  `organisations/internal/organisations.controller.ts:120`.
- `billing/internal/billing.controller.ts:29,39` — removed with the module's
  payment endpoints (Part 2).
- `notifications.subscriber.ts:32` and `audit.service.ts:197` lose their
  patient-actor branches.

**Web**
- Delete `app/claim/` and `app/consent/` (the patient-facing screens).
- Delete `PatientDashboard` and the patient branches in `app/page.tsx:79,90,479`.
- Delete the two patient entries in `components/shell/nav.ts:116,132`.
- `app/appointments/`, `app/appointments/new/`, `app/appointments/[id]/` keep
  their `RoleGate` minus `'patient'`.

## What changes shape: consent capture

`consent_records` gains:

- `attested_by uuid NOT NULL REFERENCES identity_users(id)` — the Libyan doctor
  who asserts they hold the signed form. Distinct from `granted_to`, which
  remains the receiving doctor.
- `document_object_key text NOT NULL` — the uploaded scan, stored on the same
  object path as imaging uploads and subject to the same retention.
- `document_sha256 text NOT NULL` — the uploaded bytes, hashed. `evidence_hash`
  keeps its current meaning (the hash of the rendered terms text); this is a
  second, separate hash of the signed artefact, because a dispute needs to
  distinguish "these were the terms" from "this is what they signed".

New policy, replacing the three patient ones:

```sql
CREATE POLICY consent_referring_doctor_insert ON consent_records FOR INSERT
  WITH CHECK (
    app_current_role() = 'libya_doctor'
    AND app_created_patient(patient_id)
    AND attested_by = app_current_user_id()
  );
```

Revocation moves to the same doctor under an equivalent UPDATE policy that can
only set `revoked_at`. Consent is still never deleted.

**Flow.** Consent becomes a required step of case submission at
`app/cases/new`: the doctor uploads the signed form and ticks the attestation,
and the case cannot be submitted without both. The audit trail records the
attesting user, the timestamp, and the document hash.

## Assignment

No new capability is needed. `libya_doctor` is **already** authorised on
`GET /doctors`, `GET /doctors/:id/slots`, `POST /appointments`, and
`DELETE /appointments/:id`. The patient path ran alongside it; removing the
patient leaves the assignment flow the Libyan doctor already had. The web
booking screens need their copy re-pointed ("book your appointment" becomes
"assign to a receiving doctor") but not their plumbing.

---

# Part 2 — Subscription tiers

## Current state

`billing_plans` and `billing_subscriptions` (migration `0011`) hold a flat,
side-agnostic catalogue of `solo`/`clinic`/`network`, org-scoped, with every
price and limit explicitly marked placeholder. `identity_organisations.side`
already exists (`'source'|'destination'`).

**There is no ledger table.** `packages/contracts/src/ledger.ts` is a contract
only, and `apps/web/app/ledger/page.tsx` reads `lib/api/mock`. The coordination
fee has never been persisted. Part 2 builds that persistence for the first time.

## Side-scoped catalogue

`billing_plans` gains:

```sql
side text NOT NULL CHECK (side IN ('source','destination'))
```

`code` remains the single-column primary key, so `billing_subscriptions.plan_code`
and its foreign key are untouched. Codes become side-namespaced placeholders —
`src_solo`, `src_clinic`, `src_network`, `dst_solo`, `dst_clinic`, `dst_network`
— and the CHECK widens to that set. These names are placeholders like everything
else in the catalogue.

An organisation may only subscribe to a plan on its own side. This is enforced
by a trigger on `billing_subscriptions` rather than in the service, because a
CHECK cannot reach across tables and every other integrity rule in this schema
is database-enforced:

```sql
CREATE FUNCTION billing_subscription_side_matches() RETURNS trigger ...
  -- raises if (SELECT side FROM identity_organisations WHERE id = NEW.organisation_id)
  --   <> (SELECT side FROM billing_plans WHERE code = NEW.plan_code)
```

`billing_public_plans()` returns `side` as an additional column. `/pricing` is
public and renders both ladders as two tabs; `/settings/billing` renders only
the org's own side.

## Contract changes

In `packages/contracts/src/plan.ts`:

- `planTierSchema` gains `side: endpointSideSchema` (imported from `corridor.ts`).
- `PLAN_CODES` widens to the six codes above.
- New helper, so no screen re-derives the filter:
  `tiersForSide(tiers: readonly PlanTier[], side: EndpointSide): PlanTier[]`.
- `PLACEHOLDER_CATALOGUE` becomes two ladders of three. Its `TODO(pricing)`
  header stays and is strengthened: the tier *contents* are undecided, not just
  the numbers.

## Coordination fees

Two new tables.

**`billing_fee_schedule`** — what each side owes per case, per corridor.

```
corridor_id  text     -- opaque, no FK: corridors are application config (0010)
side         text     CHECK (side IN ('source','destination'))
amount_minor bigint   CHECK (amount_minor >= 0)
currency     text     CHECK (currency ~ '^[A-Z]{3}$')
active       boolean  NOT NULL DEFAULT true
PRIMARY KEY (corridor_id, side)
```

A 60/40 split is then two rows, not a branch in code. Ops-editable, so changing
a rate is not a deploy — the same reasoning that made the plan catalogue a table.

**`billing_ledger_entries`** — what an organisation owes.

```
id               uuid PRIMARY KEY DEFAULT uuid_generate_v7()
organisation_id  uuid NOT NULL REFERENCES identity_organisations(id)
kind             text NOT NULL CHECK (kind IN ('coordination_fee','saas_subscription'))
appointment_id   uuid REFERENCES scheduling_appointments(id)  -- NULL for subscription entries
amount_minor     bigint NOT NULL CHECK (amount_minor > 0)
currency         text NOT NULL CHECK (currency ~ '^[A-Z]{3}$')
status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','overdue'))
occurred_at      timestamptz NOT NULL DEFAULT now()
```

One table holds both kinds, but **there is no total column, and no view or
endpoint produces one**. §5.7 P0 forbids merging coordination fees with
subscription charges into a single "amount owed"; the contract keeps its
discriminated union, `summariseLedger` keeps totalling per kind and per
currency, and the ledger screen keeps its two separate tables and two separate
CSV exports. Persisting the two kinds in one table must not be allowed to
become permission to sum them.

A partial unique index on `(appointment_id, organisation_id) WHERE kind =
'coordination_fee'` makes double-accrual unrepresentable rather than merely
unlikely.

**Why the referral is keyed to `scheduling_appointments` and not to a case.**
`Case` is a contract-level concept only (`packages/contracts/src/case.ts`):
there is no `cases` table, no migration, and no controller — the case screens
run on `lib/api/mock`. The durable row that both accrual moments already turn
on is the appointment, which carries the assignment (`doctor_id`), the patient,
its linked studies (`scheduling_appointment_studies`), and the status the
accept/decline flow already drives. Inventing a `cases` table for a billing
foreign key would be building the wrong thing for the wrong reason.

**Accrual points**
- **Source** entry when the Libyan doctor submits the case.
- **Destination** entry when the Tunisian doctor accepts it. A declined case
  accrues nothing on the destination side.

Both read the rate from `billing_fee_schedule` for the org's corridor and side.
If no active row exists for that pair, no entry is written and the omission is
logged — a missing rate must not invent a charge, and must not block a
referral.

**Nothing charges.** There is no rail, no provider id, and no card. `status`
exists so that wiring collection later is a service change rather than a
migration against live entries.

**RLS.** An organisation reads its own entries (`app_member_of`); `admin` reads
all (§5.8 ops oversight). Only the system context inserts.

`/ledger` drops `lib/api/mock` for the real endpoint.

## What is removed with the patient

`billing_payments` and `billing_webhook_events` (migration `0007`) are keyed to
`patients_patients` and gated on `app_current_role() = 'patient'`. The payer was
the patient's card, and there is no patient. Both tables, their policies, the
Stripe authorise-at-booking / capture-on-acceptance path, and the patient
endpoints in `billing.controller.ts` are dropped.

`payment-rail.ts` is **kept as an unwired seam**. Org-side collection will need
one when L7 resolves, and the interface is the part worth preserving.

### The appointment status machine changes with it

`scheduling_appointments.status` defaults to `'pending_payment'` and includes
`'authorised'` (`0001_init.up.sql:176`) — both are artefacts of DECISION D2,
"authorise at booking, capture on the doctor's acceptance", against the
patient's card. With no card and no patient, an appointment can never enter
either state, and leaving them in the CHECK constraint would leave two
unreachable states that every reader has to rule out.

The machine becomes:

```
status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','confirmed','declined','cancelled','completed'))
```

`pending` — assigned by the Libyan doctor, awaiting the receiving doctor.
`confirmed` — accepted. `declined` — refused by the receiving doctor, which is
distinct from `cancelled` (withdrawn by the referring side) and must stay
distinct, because the two mean different things to the referring clinic and
accrue differently. Existing rows are migrated `pending_payment`/`authorised`
→ `pending`. The `EXCLUDE USING gist` double-booking constraint is unaffected
apart from its `WHERE (status <> 'cancelled')` clause, which widens to exclude
`declined` as well — a declined slot must be bookable again.

## Enforcement: deliberately none

Tier contents are not decided, so nothing is gated. Concretely:

- `seat_limit` and `monthly_case_limit` stay as ops-editable data.
- The settings screen renders meters through the existing `usageRatio` and
  `PlanUsage`.
- `withinLimit` and `hasEntitlement` stay exported and unit-tested, but **no
  guard calls them**. No invitation is refused, no case submission is refused.
- One documented seam — a `PlanGuard`-shaped decorator, defined and not applied
  — marks where enforcement will attach.

This is a decision, not an omission, and the code should say so where a reader
would otherwise assume the check was forgotten.

---

## Migrations

- **`0021_remove_patient_accounts`** — Part 1. Drops the claim machinery, the
  patient policies, `claimed_by_user`, and `patient` from the role CHECK; adds
  the three consent columns and the doctor attestation policies.
- **`0022_side_scoped_plans`** — adds `billing_plans.side`, widens the code
  CHECK, re-seeds the two placeholder ladders, adds the side-match trigger,
  and updates `billing_public_plans()`.
- **`0023_ledger_and_fees`** — creates `billing_fee_schedule` and
  `billing_ledger_entries` with their policies; drops `billing_payments` and
  `billing_webhook_events`; rewrites the `scheduling_appointments.status`
  CHECK and default, migrates existing rows, and widens the double-booking
  exclusion to ignore `declined`.

Each ships with a `.down.sql` that restores the prior structures for local
rollback. There is no production data: the README states no real patients and
no infrastructure exist.

## Testing

**Part 1**
- RLS: a `tunisia_doctor` still reaches imaging only with an appointment *and* a
  consent record — the `app_has_consent_for` path must be proven unchanged.
- RLS: a `libya_doctor` can insert a consent row only for a patient they
  created, and only with `attested_by` equal to themselves.
- Case submission is refused without both the attestation and the document.
- Regression: no migration, contract, guard, or web route names `patient` as a
  role. This is the test that catches a policy left behind, which is the
  failure mode that matters — a stale policy naming a dropped role is how a
  system fails open later.

**Part 2**
- A source org cannot subscribe to a destination plan (trigger raises).
- An org reads its own ledger entries and no other org's.
- Assigning a referral accrues exactly one source entry; accepting accrues
  exactly one destination entry; declining accrues none; a retried write does
  not double-accrue (the partial unique index is proven, not assumed).
- A declined appointment frees its slot for re-booking.
- A corridor with no active fee row accrues nothing and does not block the case.
- No endpoint and no contract function returns a total spanning both entry
  kinds.
- `tiersForSide` returns only the requested side.
