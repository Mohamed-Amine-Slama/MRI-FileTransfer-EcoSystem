# Identifier suppression: a de-identified twin, and a patient the doctor never reads

Sub-project 2. Design date 2026-09-08.

## Summary

The platform's stated first rule — a Tunisian doctor never sees a patient
identifier (`platform-requirements.md` §7) — is not enforced today. It is
broken in five places, and only one of them was known before this design.

This sub-project closes all five. Two are database-side and are fixed with a
projection and a narrowed policy. Three are imaging-side and are fixed by
building a **de-identified twin** of every study at ingest and pointing the
destination side at the twin, never at the original.

Nothing here is a new product capability. It is the difference between a
document that promises confidentiality and a platform that provides it.

## Where this sits

Follows sub-project 1 (the consult model, 2026-09-07). Blocks nothing, and is
blocked by nothing: the identifiers to suppress — name, phone, email, national
ID — are already named in §7, so decision C6 (the full field list a doctor
receives) constrains §7.3 only and is not on this path.

Sub-project 3 (answer authoring) must not ship before this one. It puts a
doctor-facing authoring surface in front of case data, and doing that while the
case payload still carries the patient's name would widen the leak rather than
close it.

## The five leaks

| # | Path | What leaks | Layer |
|---|---|---|---|
| 1 | `cases.service.ts:120` — `CASE_COLUMNS` | `p.full_name` joined into every case read the doctor makes | Application |
| 2 | RLS `patients_receiving_doctor` (0025:352) | Row-level grant on the whole patient row: name, phone, DOB, national ID | Database |
| 3 | `GET /dicom-web/studies/:uid/metadata` | Raw Orthanc study metadata — `PatientName`, `PatientID`, `PatientBirthDate` | Imaging |
| 4 | `GET /dicom-web/studies/:uid/instances/:sop/metadata` | Raw DICOM JSON, every patient tag, straight from Orthanc | Imaging |
| 5 | WADO-RS whole-object retrieval, frames, thumbnail | Original DICOM bytes with headers intact; pixels that may carry burned-in text | Imaging |

Leak 2 is the important one. RLS is row-level and has no column granularity, so
"the doctor may see this patient" has always meant "the doctor may see every
column of this patient". The application layer choosing not to select a column
is not a control.

## Decisions taken

| # | Decision | Rationale |
|---|---|---|
| S1 | The doctor sees case ref, **exact age** (capped `090Y`) and sex | Age and sex change how imaging is read; stripping them degrades the clinical product. The cap is the Safe Harbor convention for ages over 89. |
| S2 | **De-identified twin at ingest** (approach A), not read-time stripping | Defence in depth: the doctor's path must not be able to reach an identifier even if the proxy is wrong. Chosen over a cheaper proxy filter deliberately, accepting the storage cost. |
| S3 | Burned-in text: **trust the tag, quarantine on doubt** | Deterministic and testable. OCR on ingest was rejected as cost and false-positive risk on a zero-tolerance path; lab attestation was rejected as a contractual control, not a technical one. |
| S4 | Twins are reaped **90 days after the case closes** | The original is the record; the twin is reproducible from it. Bounds storage to the working set. The 90 is a placeholder pending L5. |
| S5 | Twin building runs on **BullMQ** | Already in the stack's tech table and absent from the code. Anonymisation needs retries and a dead-letter path; the ingest transaction is the wrong place for both. |

## Part 1 — The database side

### The patient projection

A security-definer function returns the destination side a de-identified view,
following the pattern migrations 0026/0027 established for the pricing and
directory reads:

```
cases_patient_brief(p_case uuid) -> (age_years int, sex text)
```

`age_years` is computed from `date_of_birth` against the **case's**
`created_at`, capped at 90. Not against a study date: a case may link zero
studies or several, and an age that depends on which study you picked is not a
stable number. The function returns nothing for a caller with no case and no
consent for that patient, so it carries the same predicate as the policy it
replaces.

**`CASE_COLUMNS` needs no change at all.** This is the point of fixing leak 2
first. `CASE_COLUMNS` reaches the name through `LEFT JOIN patients_patients`,
and RLS filters rows inside a join exactly as it does in a top-level select —
so once the doctor holds no policy on that table, the join yields `NULL` and
`patientName` is null for a doctor with no application code edited.

That is the property worth stating plainly: leak 1 is not fixed by remembering
to drop a column. It is fixed by making the column unreachable, so that a future
`SELECT p.full_name` written by someone who never read this document returns
nothing rather than a name.

### The policy narrows

`patients_receiving_doctor` is dropped. A Tunisian doctor has no `SELECT` on
`patients_patients` at all — not a narrower one, none. Everything they are
entitled to arrives through `cases_patient_brief`.

This is the change that makes leak 1 unrepeatable. With no grant, a future
`SELECT p.full_name` by a doctor returns zero rows rather than a name.

## Part 2 — The imaging side

### The twin

At ingest, after the original is durable, a job anonymises the study into
Orthanc as a **separate resource** with fresh Study, Series and SOP UIDs. Fresh
UIDs are mandatory, not stylistic: reusing the originals would make Orthanc
dedupe the twin into the original and there would be one copy, not two.

New columns:

| Table | Column | Purpose |
|---|---|---|
| `imaging_studies` | `twin_study_uid`, `twin_orthanc_id` | Resolve the destination side's requests |
| `imaging_instances` | `twin_sop_uid`, `twin_series_uid` | Per-instance resolution for frames and metadata |

The destination side's URLs carry twin UIDs end to end, so a doctor never learns
an original UID — which is itself a linkable identifier.

### The tag policy

DICOM PS3.15 Annex E basic confidentiality profile, applied by Orthanc rather
than hand-rolled (ADR-3), with three deliberate deviations:

| Tag | Treatment | Why |
|---|---|---|
| `PatientAge` (0010,1010) | **Set**, not stripped. Computed from DOB and study date, capped `090Y`. | This is how S1 reaches the doctor. |
| `PatientSex` (0010,0040) | Retained | Clinically load-bearing. |
| `StudyDate` (0008,0020) | Retained — the profile removes it | How recent a scan is changes how it is read. The patient is already pseudonymous behind a fresh UID. **This is the one knowing departure from the profile and is recorded here so it is reviewable rather than discovered.** |

Technical tags Cornerstone3D needs to render — Rows, Columns, BitsAllocated,
PixelRepresentation, Rescale slope/intercept, Window centre/width, PixelSpacing,
image orientation and position — are equipment data, not patient data, and are
untouched.

### Release gating

The twin is not a thumbnail. A missing thumbnail is a slow viewer; a missing
twin is a case the doctor cannot open. So it must not follow the existing
best-effort-and-log pattern that Orthanc storage and thumbnails use inside the
ingest transaction.

`imaging_studies.status` already carries the needed states and **nothing has
ever set `quarantined`** — the state was designed for and left unwired. This
design uses it:

```
uploading -> processing -> ready
                |
                +-> quarantined   (burned-in doubt; ops or the lab clears it)
                +-> failed        (anonymisation exhausted its retries)
```

`studies_receiving_doctor` gains `AND status = 'ready'`. That is the defence in
depth S2 is paying for: if the proxy ever resolved the wrong copy, or a twin
were missing, the database refuses independently.

### Burned-in text

At ingest, read `BurnedInAnnotation` (0028,0301):

- `YES` → `quarantined`.
- Absent **and** modality in (US, XC, OT, SC) → `quarantined`. Secondary capture
  and ultrasound are where burned-in identifiers actually occur; a CT or MR
  straight from a scanner effectively never carries them.
- Otherwise → proceed to twin building.

A quarantined study builds no twin and is invisible to the destination side. The
lab is told to confirm or re-export. Ops clears it from the existing admin
surface.

### The download path

The viewer's whole-object retrieval is used only by the "download `.dcm`"
button — rendering goes through frames plus metadata JSON. Under S2 the doctor's
download serves the **twin's** bytes. This is not a restriction on the doctor:
§5.2 requires them to take the study to their own validated equipment, and the
twin is a complete, readable DICOM study. It is the identifiers that do not
travel, not the imaging.

## Part 3 — The worker

BullMQ, Redis-backed, per S5. First jobs:

| Job | Trigger | On failure |
|---|---|---|
| `imaging.buildTwin` | Study reaches full file count | Retry with backoff; after exhaustion, `failed` and an ops alert |
| `imaging.reapTwins` | Scheduled | Log and retry next run |

The existing quote-expiry sweep from sub-project 1 is a candidate to move here
later. It is **not** moved in this sub-project — a working sweep rewritten for
tidiness is scope that buys nothing.

## Part 4 — Testing

TDD throughout. The RLS suite is the primary home, because it is the layer that
must hold when the application layer is wrong.

**Database:**
- A doctor selecting `patients_patients` gets zero rows in every case state.
- `cases_patient_brief` returns nothing without both a case and a consent.
- Age caps at 90 for a patient aged 91+.
- A `processing`, `quarantined` or `failed` study is invisible to the doctor and
  visible to the lab.

**Imaging:**
- The twin's metadata contains no tag on the strip list — asserted tag by tag,
  not by sampling.
- A doctor resolving an **original** study UID gets 404, not the study.
- `BurnedInAnnotation: YES` quarantines and builds no twin.
- An ultrasound with the tag absent quarantines.
- A CT with the tag absent proceeds.

**Application:**
- `CaseSummary.patientName` is null for a doctor and populated for the lab —
  asserted against the unmodified `CASE_COLUMNS` query, since the whole claim is
  that the database produces this without application help.
- Route-access audit still passes: no new route ships without a declared role.

## Open items this design creates

1. **Existing studies have no twin.** No production data exists and ADR-7 keeps
   real data out of every other environment, so this is a dev-fixture concern,
   not a migration risk. A one-shot backfill job covers existing rows.
2. **The 90-day reap is a placeholder.** It becomes real when L5 answers
   retention. The number is config, not a constant.
3. **`StudyDate` retention** is a knowing deviation from the basic profile and
   should be put to counsel alongside L9, not decided here.
4. **Quarantine has no lab-facing screen yet.** Ops can clear it; the lab is
   notified. A self-service re-export flow is deferred.
5. **This design does not touch consent.** A doctor with no consent record
   naming them still sees nothing, at both layers, exactly as before.
