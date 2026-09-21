# Platform corrections: login-first, flat consult price, structured report, diagnostic viewer

Date: 2026-09-21
Status: approved design, not yet implemented
Branch: `feat/frontend-uplift`

## Summary

A round of owner feedback, taken as one programme because most items touch the
same three screens (the doctor's inbox, the case page, the viewer) and none of
them can be verified without a working local world to click through.

| # | Owner request | Section |
|---|---------------|---------|
| 1 | Remove the landing page for now; go straight to login; keep its files | §1 |
| 2 | Appointment $100: Libyan clinic $30, Tunisian doctor $20, platform the rest | §3 |
| 3 | 1000 TND/year sub tier for Tunisian doctors; $1000/year for Libyan clinics | §4 |
| 4 | Fix the Tunisian doctor's availability | §7 |
| 5 | Doctor's review as a template with structured inputs, converted to PDF | §5 |
| 6 | Heavy test of all dashboards, UI and functionality | §0, §9, §10 |
| 7 | MRI opened and diagnosed inside the platform | §6 |
| 8 | Remove the Tunisian clinic and the Libyan doctor account types | §2 |
| 9 | Fix dashboard performance, lag and stuck issues | §1, §8 |
| 10 | "See details" in the Tunisian dashboard freezes on "rendering the MRI image" | §6 |

## Decisions taken

| # | Question | Decision |
|---|----------|----------|
| D1 | What is broken about availability? | **The switch itself.** Keep one on/off switch; fix why it fails or has no effect. No schedule, no away dates. |
| D2 | How does the $100 move? | **Clinic keeps $30 and owes the platform $70.** Platform pays the doctor $20 and keeps $50. Flat for every specialty. |
| D3 | The "not for diagnostic use" banner | **Removed**, with full diagnostic tools. The owner accepts the regulatory exposure of an uncertified viewer used for diagnosis. |
| D4 | Report template shape | **One radiology template** for every case, fixed sections, pick-lists where possible. |
| D5 | Subscriptions gate access? | **No.** Shown, chosen, and recorded; nothing is blocked until a payment rail exists (L7). |
| D6 | Rename the `libya_doctor` role? | **No.** It is the stored access subject in ~300 places (RLS, Keycloak, migrations). Only the visible copy changes. |
| D7 | Messaging and per-file access trail on the case page | **Hidden.** They have no backend and write to an in-memory fixture that vanishes on reload. Building them is a follow-up. |
| D8 | PDF language | **English or French** (the doctor picks). Arabic PDF output is a follow-up: server-side Arabic needs shaping and bidi that the PDF library does not do. |

## §0 — A local world that can be tested

`scripts/dev-bootstrap.mjs` no longer matches the schema. Its database half
still seeds a `patient` role (removed in 0021) and writes `scheduling_*` tables
(renamed in 0025), so it aborts on the first statement and seeds nothing. Every
section below is verified in a browser, so this is first.

The Keycloak half is sound and stays. The database half is rewritten against the
current schema to produce:

- **Libyan clinic** "Sample Referring Clinic" (`source`, kind `clinic`,
  approved) with `dev-doctor@example.test` seated in it.
- **Three Tunisian doctors** (`destination`, kind `doctor`, one organisation
  each, approved), each with a **verified** doctor profile and a lowercase
  specialty key: `dev-receiver` (radiology), `dev-radiologist` (radiology),
  `dev-cardio` (cardiology). `dev-receiver` starts accepting; the others do not.
- **Ops** and **applicant** accounts as today. The `patient` account is dropped.
- **Patients and cases**, one per interesting status (submitted, quoted, paid,
  accepted, answered), each with consent recorded for its doctor.
- **One real MRI series** from `test-data/dicom`, stored through Orthanc and
  linked to the accepted case, so the viewer and the report have pixels to work
  with.

The script stays idempotent and re-runnable after a Keycloak recreate.

## §1 — Login-first, landing hidden

- `app/page.tsx`: a signed-out visitor is `router.replace`d to `/login`. While
  the session resolves it shows a small spinner — **not** the landing page,
  which today mounts its WebGL helix and GSAP timelines for every signed-in user
  during the first few hundred milliseconds.
- `app/[locale]/page.tsx` (`/ar`, `/fr`, `/en`) redirects to `/login`.
- `Corridor` is no longer imported from `app/page.tsx`, so the dashboard route
  stops shipping the landing's code.
- **Nothing under `components/corridor/`, `lib/site/`, or `app/[locale]/` is
  deleted.** Restoring the landing is reverting the two route files.
- `e2e/public-surface.spec.ts` and `e2e/corridor.spec.ts` assert the landing;
  they are updated to assert the redirect (the corridor suite is skipped with a
  pointer to this spec, not deleted).

## §2 — Account types

| Side | Allowed kinds |
|------|---------------|
| source (Libya) | `clinic`, `laboratory` |
| destination (Tunisia) | `doctor` |

- Contracts gain `providerKindsForSide(side)`; `PROVIDER_KINDS` keeps its values
  so historical rows still parse.
- `POST /organisations` rejects a kind outside its side's list (400).
- The provider sign-up form offers only the side's kinds and resets the kind
  when the side changes.
- Visible copy that calls the source role "Libyan doctor" says "Libyan clinic"
  in all three locales.

## §3 — Flat consult price and the split

**Price.** A new table `pricing_consult_price` (one row per corridor):
`amount_minor`, `currency`, `clinic_share_minor`, `doctor_share_minor`, with
`CHECK (clinic_share_minor + doctor_share_minor <= amount_minor)`. Seeded
`ly-tn`: 10000 / USD / 3000 / 2000. The platform's share is the remainder and is
never stored, so the three can never disagree.

**Quote.** `PricingService.quoteFor` returns the corridor row. Specialty rate,
seniority tier and surge are no longer terms. Their tables stay (no destructive
migration); the code stops reading them. The "is this doctor accepting" check in
`CasesService.quote` stays exactly as it is.

**Locked at quote.** `cases_cases` gains `clinic_share_minor` and
`doctor_share_minor`, written with the quote. Payment and answer read the case,
never the price table: a price edited after a quote must not change a quoted
case, which is the rule the consult model already applies to the amount.

**Ledger.**

| Event | Entry | Organisation | Amount |
|-------|-------|--------------|--------|
| Clinic pays | `coordination_fee` (clinic owes platform) | clinic | quoted − clinic share = **$70** |
| Doctor submits report | `doctor_payout` (platform owes doctor) | doctor's org | doctor share = **$20** |
| Doctor accepts | *nothing* | — | the destination fee is retired |

- `billing_ledger_entries.kind` gains `doctor_payout`, with its own one-per-case
  unique index.
- `LEDGER_ENTRY_KINDS` gains `doctor_payout`; `summariseLedger` keeps the kinds
  in separate totals (§5.7 P0 still forbids one "amount owed").
- `billing_fee_schedule` is no longer read.

**Screens.** The pick-doctor screen shows $100 for every doctor and, before
payment, the breakdown "$100 consult · you keep $30 · you pay $70". The doctor's
ledger shows $20 per answered case. The admin ledger shows, per case, $70 in and
$20 out; the $50 margin is the difference and is labelled as such.

**Out of scope:** USD→TND conversion and any real money movement.

## §4 — Yearly subscriptions

- Two new plan codes, both `active`: `src_clinic_yearly` ($1,000.00 USD / year,
  `amount_minor` 100000) and `dst_doctor_yearly` (1,000.000 TND / year,
  `amount_minor` 1000000 — TND has three minor digits).
- `billing_plans` gains `billing_interval` (`'month' | 'year'`). The six
  placeholder monthly plans are set `active = false`, not deleted, so existing
  subscriptions still reference a row.
- Contracts: `PlanTier.priceMonthly` becomes `price` plus
  `interval: 'month' | 'year'`; `PLACEHOLDER_CATALOGUE` is replaced by the two
  real tiers. Seat and case limits are `null` (unlimited).
- `/pricing` and Settings → Billing render per-year prices with the correct
  currency. The subscription period for a yearly plan is one year.
- **Not gated** (D5).

## §5 — Structured report and PDF

**The form.** `consultReportSchema` in contracts is the single definition used
by the web form, the API validator, and the PDF renderer:

| Section | Input |
|---------|-------|
| Clinical indication | text, prefilled from the case's referral reason |
| Exam type | select: MRI brain, spine (cervical / thoracic / lumbar), knee, shoulder, abdomen, pelvis, other |
| Technique | sequence checkboxes (T1, T2, FLAIR, DWI/ADC, SWI/T2\*, STIR, PD, post-contrast T1) + contrast yes/no |
| Comparison | none, or prior study date + note |
| Findings | repeatable rows: region (text) · normal/abnormal · description |
| Impression | numbered list, at least one item |
| Recommendations | preset checkboxes (clinical correlation, follow-up imaging in N months, specialist referral, biopsy, further imaging) + other |
| Prescription | optional repeatable rows: drug · dose · frequency · duration |
| Urgency | routine / urgent / critical |
| Report language | English / French |

Every field has a label and a length cap; required fields are the indication,
exam type, at least one finding, and at least one impression item.

**Storage.** `cases_reports` (one row per case): `case_id` (PK, FK),
`author_id`, `content jsonb`, `status` (`draft` | `submitted`), timestamps.
RLS: the case's assigned doctor reads and writes their own draft while the case
is `accepted`; the case's source organisation reads a `submitted` report; admin
reads all.

**API.**
- `GET /cases/:id/report`: the draft or the submitted report.
- `PUT /cases/:id/report`: save a draft. Relaxed validation; autosaved from
  the form after two seconds idle.
- `POST /cases/:id/answer`: now **requires** the report body. In one
  transaction: validate it fully, store it as `submitted`, move the case to
  `answered`, accrue the `doctor_payout`. A bare answer with no report is a 400.
- `GET /cases/:id/report.pdf`: rendered on demand from the stored report with
  `pdfkit` and an embedded Latin font. Audit-logged on every download. It
  carries the case reference, the patient's age and sex, the doctor's name, and
  the submission time. **Never the patient's name** (§7 of the requirements).

**The workspace.** `/cases/[id]` for the assigned doctor on an accepted case
becomes "Read & report": the viewer on the start side, the form on the end side
(stacked below 1024px). After submission both sides see the read-only report
and a "Download PDF" button. The inbox's bare "Answer" button becomes
"Write report", linking there.

## §6 — Diagnostic MRI viewer

**The hang (bug).** The step-4 effect in `app/viewer/[studyUid]/page.tsx`
calls `setFidelity('loading-full')` while `fidelity` is in its own dependency
list. The state change re-runs the effect; the cleanup marks the first run
cancelled; the second run returns early because fidelity is no longer
`'thumbnail'`. The first run then abandons its viewer at the `cancelled` check,
and the page sits on "Loading full resolution…" forever with the Cornerstone
viewport at `opacity: 0`. The fix separates initialising the engine (runs once
per study) from showing a slice (runs per navigation), and adds a 15-second
timeout that falls back to the preview image with a message.

**The tools.**
- The series loads as a **stack**: every instance's image id is known up front;
  pixels load on demand for the visible slice plus a small neighbourhood
  prefetch. The rule "never download the whole study up front" holds.
- `@cornerstonejs/tools` (same major as core): stack scroll on the wheel,
  window/level on primary drag, pan on middle drag or a toolbar toggle, zoom on
  secondary drag, length and angle measurements, invert, reset. A slice slider
  with "n / N" beside the viewport.
- A series picker when a study has more than one series.
- CT window presets (lung, bone) are removed; MRI has no Hounsfield scale. The
  controls are auto W/L, invert, reset.
- `DiagnosticUseBanner` is no longer rendered; the component file stays.
- The viewer is a component (`components/viewer/StudyViewer.tsx`) used by both
  `/viewer/[studyUid]` and the Read & report workspace.

## §7 — The availability switch

Reproduce first, against the §0 world, then fix what is actually wrong. Three
causes are visible from reading the code, and each would look like "the switch
is broken" to a doctor:

1. **No profile row.** A doctor approved through `admin/providers` never gets an
   `identity_doctor_profiles` row. `cases_set_accepting` updates zero rows, the
   API answers 404, and the screen says "Something went wrong".
2. **Never verified.** Profiles created outside the seed's second block have
   `verified_at = NULL`. The switch saves, but the directory, the quote check,
   and the headcount all filter on `verified_at IS NOT NULL`, so the doctor stays
   invisible to every clinic.
3. **Specialty case.** Profiles say `Radiology`, rate cards and case intake say
   `radiology`. `dp.specialty = p_specialty` never matches.

The fix makes approval of a destination doctor create or complete their profile
with `verified_at` set to the decision time; normalises specialty to lowercase
keys at every write and in one migration for existing rows; and gives the
screen a specific message when the account has no profile ("your profile is not
complete; contact support") instead of the generic error.

## §8 — Dashboard performance

§1 removes the largest known cost. Beyond it: record a Chrome performance trace
of each role's dashboard and of `/doctor`, `/cases`, `/cases/[id]`, and the
viewer; fix what the traces show (duplicate fetches, long tasks, render loops).
**Budget:** no main-thread task over 200 ms after first paint, dashboard
interactive within 1 s locally. The traces before and after are summarised in
the final report.

## §9 — Mock screens onto the real API

`lib/api/mock` is still the only implementation behind `casesApi`, and it serves
`/cases`, `/cases/[ref]`, `/cases/new`, `/workspace`, `/ledger`,
`/notifications`, `/admin/cases`, `/admin/ledger`, and `/admin/providers`, plus
`useCurrentProvider`. The doctor's inbox reads the real `/cases`, so a real
case id handed to the mock-backed detail page is "not found". That is the
visible half of "see details doesn't work".

Each screen moves to `api.*` in `lib/api/endpoints.ts`. Where an endpoint is
missing and the screen needs it, it is added: at least
`GET /cases/:id/studies`. Messaging and the file-access trail are hidden (D7).
`useCurrentProvider` resolves from `GET /organisations/mine`.
`lib/api/mock` stays, as the vitest fixture it already is, and is no longer
imported by any route.

## §10 — Testing

- **Unit (vitest):** the report schema, the split arithmetic (including TND
  minor units), kinds-per-side, the plan catalogue, the viewer's state machine.
- **API (vitest + real Postgres):** quote locks the split; pay accrues $70; answer
  without a report is 400; answer with a report accrues $20 exactly once;
  report RLS (the other doctor and the clinic's draft access are denied); PDF
  download writes an audit row; approval creates a verified profile; the switch
  works for a freshly approved doctor.
- **E2E (Playwright, against the §0 world):**
  - clinic: sign in → new case → upload MRI → pick doctor → see $100/$70 → pay
  - doctor: switch on → accept → viewer (scroll, W/L, measure) → report → submit → PDF
  - admin: approve a doctor → the doctor can switch on and appears to the clinic;
    the ledger shows the split
  - `/` signed-out lands on `/login`
- **Manual:** every dashboard and route clicked through in Chrome as each role,
  with the console and network panels open.
- The final report lists what failed, not only what passed.

## Build order

§0 → §1 → §2 → §6 hang fix → §9 → §7 → §3 → §4 → §5 → §6 tools → §8 → §10.

The quick, visible fixes land first. The mock rewiring precedes the money work
because the ledger and case screens being re-pointed are the ones §3 changes.

## Risks

- **The requirements' §7 confidentiality rule.** The report, the PDF, and the
  rewired case page are three new places a patient's name could leak to a
  doctor. Every one is covered by an API test asserting the doctor-facing
  payload has no name, phone, or email.
- **Regulatory (D3).** Removing the banner is the owner's call and is recorded
  here as such.
- **The re-theme plan** (`2026-09-20-platform-retheme.md`) is not yet executed
  and edits `globals.css` and a few shared UI components. This programme adds
  screens but does not restyle; new UI uses the existing tokens and components,
  so the re-theme still applies cleanly afterwards.
