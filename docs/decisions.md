# Product decisions (P0.1)

Status: **answered** — 2026-08-09
Decided by: project owner, in response to the BUILD_SPEC P0.1 gate.

These five decisions were blocking everything downstream. They are settled.
Changing any of them is a new decision, recorded as a new revision of this file
with a date and a rationale — not an edit in place.

---

## D1 — Who creates the patient record?

**Decision: the Libyan doctor creates the patient record. The patient later claims it via phone OTP.**

Rationale: this matches the real clinic workflow — the doctor has the imaging CD
or the PACS export in hand at the moment of referral, and the patient may not own
a smartphone or have registered yet. Blocking the doctor on patient self-registration
would strand studies at the point of care.

Consequences for the build:
- `patients_patients.created_by_doctor` is `NOT NULL`. Every patient has an originating doctor.
- `patients_patients.claimed_by_user` is nullable and stays `NULL` until the claim succeeds.
- The patient-facing RLS policies key off `claimed_by_user`, so an unclaimed patient
  record is invisible to every patient account. This is correct: nobody should see it
  until the phone number is proven.
- The claim flow (P5.2) is on the critical path for patient consent (P5.3), because
  consent must be granted by the patient, not by the doctor on their behalf.

---

## D2 — When is payment taken?

**Decision: authorise at booking, capture when the Tunisian doctor accepts the case.**

Rationale: the slot must be held the moment the patient commits, or contested slots
resolve unfairly. But money should not move until the receiving doctor has agreed to
take the case, otherwise every declined referral becomes a refund.

Consequences for the build:
- The billing module needs a rail supporting **auth/capture separation**. This is a
  hard constraint to carry into the L7 / P11.1 provider evaluation.
- **Open risk:** if L7 concludes that the only viable rail is bank transfer or
  cash-at-clinic, auth/capture is not available and this decision must be revisited.
  The billing module is therefore built against an internal `PaymentRail` interface
  with the provider behind it, so a rail swap does not rewrite the scheduling module.
- `scheduling_appointments.status` starts at `pending_payment`; authorisation moves it
  to `authorised`; capture on doctor acceptance moves it to `confirmed`.
- An authorisation that is never captured must expire and release the slot. The window
  is configuration, not a constant.

---

### D2a — Payment rail: Stripe

**Decision: Stripe, as the payment gateway.** Recorded 2026-08-09. Supersedes the
"evaluate bank transfer / cash-at-clinic" option in BUILD_SPEC P11.1.

This resolves the *technical* half of D2: Stripe supports authorisation and
delayed capture (`capture_method: manual`), which is exactly what D2 requires —
hold at booking, capture when the Tunisian doctor accepts. It also keeps the
platform out of PCI scope via Stripe Elements / Payment Intents, satisfying
P11.2 rule 1.

### Entity jurisdiction — RESOLVED: Estonia

**Decision (2026-08-10): the business is incorporated in Estonia**, not in
Libya or Tunisia.

This resolves the blocker. Estonia is an EU/EEA member and **is** on Stripe's
supported-country list, so the merchant side works and auth/capture is
available — D2 stands as written, and the Stripe implementation already built
is the right one.

**But incorporating in the EU changes the data-protection picture, and two
consequences follow immediately:**

**1. GDPR now applies directly — L3 is live, not hypothetical.**
The spec listed L3 as conditional ("*if* hosting in the EU"). With an Estonian
controller and EU hosting, it is unconditional. Health imaging is **Article 9
special-category data**, which needs an Article 9(2) condition — most likely
explicit consent, which the consent module already captures with evidence,
versioning and a rendered-text hash. The supervisory authority is the Estonian
**Andmekaitse Inspektsioon (AKI)**. A DPA with AWS is required (they offer a
standard one). Breach notification becomes **72 hours** under Article 33 —
which is almost certainly the binding deadline for L8, and is the number the
incident-response runbook should now assume.

**2. ⚠️ The Tunisian doctor's access is a restricted transfer.**

This is the consequence most easily missed. If the data is hosted in the EU and
a doctor **in Tunisia** logs in and views a study, that is a transfer to a
third country under GDPR Chapter V. **Tunisia has no EU adequacy decision.**

So the transfer needs an Article 46 safeguard — in practice Standard
Contractual Clauses between the Estonian entity and the receiving Tunisian
doctor or clinic, plus a transfer impact assessment. That is a contract each
receiving doctor must sign before they can be granted access.

**Product consequence, and the reason this is recorded here rather than only in
a legal file:** doctor onboarding is no longer just licence verification
(P4.1). A Tunisian doctor cannot be verified and activated until the SCCs are
signed. `identity_doctor_profiles.verified_at` should not be set without it.
This is cheap to build now and expensive to retrofit once doctors are onboarded.

**Still for counsel:** whether the Libya → EU leg needs anything on the Libyan
side (L1), whether an EU-established platform serving Tunisian clinicians
triggers Tunisian registration anyway (L2), and confirmation of the SCC module
and TIA above.

Separately, on the paying side: Libyan-issued cards that work on international
rails are uncommon, and Libya is subject to sanctions screening that Stripe
applies to both the business and the payer. A rail that is technically
available but that a Libyan patient's card cannot actually clear is not a rail.

**What this means for the build:** none of the above changes the integration
work, so P11 proceeds. The billing module sits behind an internal `PaymentRail`
interface with Stripe as the first implementation, so if L7 forces a different
entity structure or an additional local rail, the change is confined to the
billing module and does not reach scheduling.

**Do not onboard real patients on this rail until L7 is answered in writing.**

---

## D3 — Can the Tunisian doctor view studies before accepting/payment (triage)?

**Decision: configurable toggle, default OFF. Image access requires successful payment.**

Rationale: defaulting closed means the conservative behaviour ships first and triage
is a deliberate act of enabling, not an accident of configuration. P10.3 requires the
toggle to exist either way.

Consequences for the build:
- Config key `SCHEDULING_TRIAGE_BEFORE_PAYMENT` (boolean, default `false`).
- **Consent (P5.3) is required in both modes.** The toggle only moves the *payment*
  gate; it never bypasses consent. A Tunisian doctor with no consent record naming
  them sees nothing, in either mode, at both the API layer and the RLS layer.
- Both modes must be covered by tests (P10.3 gate).

---

## D4 — Interface languages for v1?

**Decision: Arabic and French. RTL support from day one.**

Rationale: Arabic for Libyan doctors and patients, French for Tunisian doctors.
Retrofitting RTL into a layout built LTR-first is expensive and never fully clean,
so the direction-aware layout is a day-one constraint rather than a later project.

Consequences for the build:
- `identity_users.locale` defaults to `'ar'`.
- Consent text (P5.3) is versioned **per locale**. A published version exists in both
  `ar` and `fr` before it can be used in production.
- The evidence hash stored on a consent record is the hash of the rendered text in the
  locale the patient actually saw — not a canonical language.
- Frontend uses logical CSS properties (`margin-inline-start`, not `margin-left`) so
  direction flips without a second stylesheet.
- No English in v1. Admin tooling is French.

---

## D5 — Primary region?

**Decision: `eu-south-1` (Milan) primary, `eu-west-3` (Paris) as the fallback and DR region.**

Rationale: Milan is the closest AWS region to Tunis, which matters because the payload
is hundreds of megabytes of imaging over a constrained link.

**Unverified precondition:** Milan must be confirmed to support every required service
before infrastructure is applied — specifically S3 Object Lock in compliance mode,
S3 cross-region replication, RDS PostgreSQL 16 multi-AZ, and customer-managed KMS keys
with rotation. This has **not** been verified; there is no AWS account attached to this
work yet. If any is missing, the decision falls back to Paris primary with Milan as DR.

Consequences for the build:
- Terraform pins `eu-south-1` as primary and `eu-west-3` as the replication target.
- The region is a variable, not a literal, in every Terraform module, so the fallback
  is a variable change rather than a rewrite.
- Note: `eu-south-1` is an opt-in region. The account must explicitly enable it.

---

## Related blocking items not decided here

D1–D5 are product decisions. They do **not** resolve the legal prerequisites L1–L8 in
BUILD_SPEC §2, which require local counsel in both jurisdictions and remain open.
In particular, D2 depends on L7 (payment rails) and the consent implementation behind
D4 depends on L4 (required form of patient consent).


---

# Revision — 2026-09-07: the consult model supersedes booking

Recorded as a revision rather than an edit, per this file's own rule. D1 and D5
are untouched.

## D2, D2a — superseded

D2 read "authorise at booking, capture when the Tunisian doctor accepts". Both
halves are gone: migration 0021 removed the patient card the authorisation was
taken against, and migration 0025 removed the booking.

The replacement is in `docs/superpowers/specs/2026-09-07-consult-model-design.md`.
A lab picks a doctor from the directory, the platform quotes a price — the
specialty's base rate, times that doctor's earned tier, times a scarcity surge —
and locks it against the case. The lab pays the locked number, and the funds are
released when the doctor submits an answer.

D2a's choice of Stripe stands as the rail and is still unwired pending L7.
`PAYMENT_AUTHORIZATION_WINDOW_HOURS` is deleted: it bounded a card hold against
a slot, and there is neither.

**What is NOT decided here:** where the money sits between payment and release.
No hold exists yet; `POST /cases/:id/pay` records the state and moves nothing.

## D3 — superseded

D3 made triage-before-payment a toggle, default off.

In the consult model a doctor always sees a summary before accepting and never
sees imaging before accepting, so the toggle has no false position.
`SCHEDULING_TRIAGE_BEFORE_PAYMENT` is deleted rather than defaulted, because a
config key that can no longer be false is a lie in the schema.

## D4 — unchanged here, and under review

Arabic and French stand; there is still no English in v1. Sub-project 6 puts
English-as-default to counsel and to the product owner. Until that is decided,
this file's answer is the one above.

## New: how a consult is priced

Not previously a decision, because there was no price to set.

**Decision: the platform sets the price. A doctor does not quote, and a lab does
not negotiate.** Three terms, published: a per-specialty base rate, the doctor's
tier multiplier (earned from answered cases), and a surge multiplier read off a
bounded four-rung ladder from how many doctors in that specialty are currently
accepting.

Rationale: a per-doctor quote turns every case into a negotiation across a
language barrier and a border, and it makes the platform's own fee
unexplainable. Three published terms can be shown to a lab, to a doctor, and to
whichever regulator L2 identifies.

**Unresolved:** whether surge pricing on medical consults is defensible at all
is a question for counsel, not for this file. The technical mitigation is that
the ladder is bounded and published rather than continuous and opaque; that is
not the same as an answer.
