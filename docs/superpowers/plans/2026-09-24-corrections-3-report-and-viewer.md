# Platform Corrections — Plan 3: Structured Report, PDF, Diagnostic Viewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Tunisian doctor reads the MRI inside the platform with real diagnostic tools and answers by filling a structured radiology form that becomes a PDF; the clinic downloads that PDF.

**Architecture:** One zod schema (`consultReportSchema` in contracts) is the form, the API validator and the PDF's input. Reports live in `cases_reports` (one row per case, RLS-scoped). `POST /cases/:id/answer` now carries the report and, in one transaction, stores it as `submitted` and moves the case to `answered`. The PDF is rendered on demand by `pdfkit` with an embedded DejaVu Sans font. The viewer becomes a component (`StudyViewer`) with `@cornerstonejs/tools`, used by `/viewer/[studyUid]` and by the new "Read & report" workspace on the case page.

**Tech Stack:** NestJS + PostgreSQL RLS (API), zod (contracts), pdfkit + dejavu-fonts-ttf (PDF), Next.js 15 client pages, Cornerstone3D core/dicom-image-loader/tools 5.x, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-platform-corrections-design.md` §5 (report and PDF) and §6 (diagnostic viewer).

## Global Constraints

- A doctor-facing payload never carries the patient's name, phone or email; **the PDF never carries the patient's name** (requirements §7). The PDF carries the case reference, patient age and sex, the doctor's name, and the submission time.
- Required report fields: indication, exam type, at least one finding, at least one impression item. Every field has a label and a length cap.
- Report language: English or French only.
- `GET /cases/:id/report.pdf` is audit-logged on every download.
- The viewer never downloads the whole study's pixels up front: pixels load for the visible slice plus a small neighbourhood prefetch.
- CT window presets (lung, bone) are removed; the controls are auto W/L, invert, reset. `DiagnosticUseBanner` is no longer rendered; its file stays.
- `@cornerstonejs/tools` is the same major as `@cornerstonejs/core` (5.x).
- Never use a physical-direction Tailwind utility (`ps-/pe-`, `ms-/me-`, `start-/end-`, `text-start`, `border-s`).
- Copy is dictionary keys in all three locales (ar, fr, en) in `apps/web/lib/i18n/dictionary.ts`. PDF labels (EN/FR only) live in the API next to the renderer.
- Rebuild contracts after every contracts change: `pnpm --filter @mir/contracts build`.
- Migrations ship a working `.down.sql`.
- Local runs: API from `apps/api/dist/main.js` on **3110**, web production build on **3210** (ports 3100/3003 belong to a parallel session). Never `pkill -f` a pattern that appears in the command itself.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A draft survives a reload.** The doctor types, waits two seconds, reloads: every field is back. → Task 3 (draft round-trip test) and Task 7 (browser check).
2. **A double-clicked "Submit report" answers once and pays once.** The second POST is a 404 (the case is no longer `accepted`); exactly one `doctor_payout` row exists. → Task 3 test.
3. **The clinic cannot read a draft.** Before submission `GET /cases/:id/report` is a 404 for the clinic, and so is the PDF route. → Task 2 RLS test, Task 3 and Task 4 tests.
4. **Free text that is not plain ASCII** (French accents, `≥`, `µ`, Arabic words) renders in the PDF without throwing. → Task 4 test.
5. **A study with more than one series** shows a series picker; switching resets the counter to `1 / N` for the new series; a one-slice series disables the slider. → Task 6 unit test on `groupSeries` and e2e.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/contracts/src/report.ts` (+ `report.test.ts`) | **Create.** `consultReportSchema`, `consultReportDraftSchema`, enums, types. |
| `packages/contracts/src/index.ts` | **Modify.** Export `./report`. |
| `apps/api/migrations/0034_case_reports.up.sql` / `.down.sql` | **Create.** `cases_reports` + RLS. |
| `apps/api/src/modules/cases/report-rls.test.ts` | **Create.** Who reads/writes a report row. |
| `apps/api/src/modules/cases/internal/reports.service.ts` | **Create.** `get`, `saveDraft`, `submitWithAnswer`. |
| `apps/api/src/modules/cases/internal/report-pdf.ts` (+ `report-pdf.test.ts`) | **Create.** `buildReportDocument` (pure model), `renderReportPdf`, `ReportPdfService`. |
| `apps/api/src/modules/cases/internal/report-pdf-labels.ts` | **Create.** EN/FR label table. |
| `apps/api/src/modules/cases/internal/cases.controller.ts` | **Modify.** `GET/PUT cases/:id/report`, `GET cases/:id/report.pdf`, `POST cases/:id/answer` requires the report. |
| `apps/api/src/modules/cases/internal/cases.service.ts` | **Modify.** `markAnswered` removed; answering goes through `ReportsService.submitWithAnswer`. |
| `apps/api/src/modules/cases/cases.module.ts` | **Modify.** Provide `ReportsService`, `ReportPdfService`. |
| `apps/api/src/shared/events/domain-events.ts`, `apps/api/src/modules/audit/internal/audit.service.ts`, `audit.subscriber.ts` | **Modify.** `CaseAnswered`, `CaseReportDownloaded`, audited. |
| `apps/api/src/modules/cases/reports.test.ts` | **Create.** Draft, submit, double-submit, clinic visibility, PDF route. |
| `apps/api/src/modules/imaging/internal/dicomweb.controller.ts` (+ `dicomweb-series-path.test.ts`) | **Modify.** `GET studies/:studyUid/series/:seriesUid/metadata`. |
| `apps/web/lib/api/endpoints.ts` | **Modify.** `cases.report`, `cases.saveReport`, `cases.answer(id, report)`. |
| `apps/web/lib/report/draft.ts` (+ `draft.test.ts`), `apps/web/lib/report/download.ts` | **Create.** `emptyReport`, `completeReport`, `downloadReportPdf`. |
| `apps/web/components/report/ReportForm.tsx`, `ReportView.tsx` | **Create.** The structured form with autosave; the read-only report. |
| `apps/web/lib/viewer/series.ts` (+ `series.test.ts`) | **Create.** `groupSeries(instances)`. |
| `apps/web/lib/viewer/cornerstone.ts` | **Modify.** Whole-series stack, tools, slice events. |
| `apps/web/components/viewer/StudyViewer.tsx` | **Create.** Viewer UI: preview → full, toolbar, slider, series picker. |
| `apps/web/app/viewer/[studyUid]/page.tsx` | **Modify.** Thin page around `StudyViewer`. |
| `apps/web/app/cases/[ref]/page.tsx` | **Modify.** "Read & report" workspace; read-only report after submission for both sides. |
| `apps/web/app/doctor/page.tsx` | **Modify.** "Answer" → "Write report" link. |
| `apps/web/e2e/viewer.spec.ts` | **Modify.** Banner → absent; CT presets → tools; series picker. |

---

### Task 1: The report contract

**Files:**
- Create: `packages/contracts/src/report.ts`, `packages/contracts/src/report.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `consultReportSchema`, `consultReportDraftSchema`, `type ConsultReport`, `type ConsultReportDraft`, `EXAM_TYPES`, `SEQUENCES`, `RECOMMENDATION_PRESETS`, `URGENCIES`, `REPORT_LANGUAGES`, `REPORT_STATUSES`, `type ReportStatus`.

- [ ] **Step 1: Write the failing test** — `packages/contracts/src/report.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { consultReportDraftSchema, consultReportSchema, type ConsultReport } from './report';

const valid: ConsultReport = {
  indication: 'Headaches for six weeks; rule out a mass.',
  examType: 'mri_brain',
  examTypeOther: null,
  technique: { sequences: ['t1', 't2', 'flair'], contrast: false },
  comparison: { kind: 'none' },
  findings: [{ region: 'Posterior fossa', status: 'normal', description: '' }],
  impression: ['No intracranial mass.'],
  recommendations: { presets: ['clinical_correlation'], followUpMonths: null, other: '' },
  prescription: [],
  urgency: 'routine',
  language: 'en',
};

describe('consultReportSchema', () => {
  it('accepts a complete report', () => {
    expect(consultReportSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['an empty indication', { ...valid, indication: '  ' }],
    ['no finding', { ...valid, findings: [] }],
    ['no impression', { ...valid, impression: [] }],
    ['a blank impression line', { ...valid, impression: [' '] }],
    ['"other" exam with no name', { ...valid, examType: 'other', examTypeOther: null }],
    [
      'follow-up imaging with no interval',
      { ...valid, recommendations: { presets: ['follow_up_imaging'], followUpMonths: null, other: '' } },
    ],
    ['an Arabic report language', { ...valid, language: 'ar' }],
    ['an over-long finding', { ...valid, findings: [{ region: 'x', status: 'abnormal', description: 'a'.repeat(2001) }] }],
    ['a prior comparison with a bad date', { ...valid, comparison: { kind: 'prior', date: '12/03/2026', note: '' } }],
  ])('refuses %s', (_label, report) => {
    expect(consultReportSchema.safeParse(report).success).toBe(false);
  });

  it('keeps its caps on a draft but not its minimums', () => {
    expect(consultReportDraftSchema.safeParse({ findings: [], impression: [] }).success).toBe(true);
    expect(consultReportDraftSchema.safeParse({ indication: 'a'.repeat(2001) }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/contracts && npx vitest run src/report.test.ts`
Expected: FAIL — `Cannot find module './report'`.

- [ ] **Step 3: Implement** — `packages/contracts/src/report.ts`

```ts
import { z } from 'zod';

/**
 * The consult report — spec 2026-09-21 §5.
 *
 * ONE definition, three readers: the web form, the API validator and the PDF
 * renderer. A field added here is a field the form must render and the PDF
 * must print; nothing else defines what a report is.
 *
 * It carries no patient identity. The PDF adds the case reference, age and sex
 * from the case; the patient's name is never an input.
 */

export const EXAM_TYPES = [
  'mri_brain',
  'mri_spine_cervical',
  'mri_spine_thoracic',
  'mri_spine_lumbar',
  'mri_knee',
  'mri_shoulder',
  'mri_abdomen',
  'mri_pelvis',
  'other',
] as const;
export const SEQUENCES = ['t1', 't2', 'flair', 'dwi_adc', 'swi_t2star', 'stir', 'pd', 't1_post_contrast'] as const;
export const RECOMMENDATION_PRESETS = [
  'clinical_correlation',
  'follow_up_imaging',
  'specialist_referral',
  'biopsy',
  'further_imaging',
] as const;
export const URGENCIES = ['routine', 'urgent', 'critical'] as const;
export const REPORT_LANGUAGES = ['en', 'fr'] as const;
export const REPORT_STATUSES = ['draft', 'submitted'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

const text = (max: number) => z.string().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const findingSchema = z.object({
  region: required(120),
  status: z.enum(['normal', 'abnormal']),
  description: text(2000),
});
const prescriptionSchema = z.object({
  drug: required(120),
  dose: required(60),
  frequency: required(60),
  duration: required(60),
});
const comparisonSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('prior'), date: isoDay, note: text(500) }),
]);
const techniqueSchema = z.object({
  sequences: z.array(z.enum(SEQUENCES)).max(SEQUENCES.length),
  contrast: z.boolean(),
});
const recommendationsSchema = z.object({
  presets: z.array(z.enum(RECOMMENDATION_PRESETS)).max(RECOMMENDATION_PRESETS.length),
  followUpMonths: z.number().int().min(1).max(60).nullable(),
  other: text(500),
});

export const consultReportSchema = z
  .object({
    indication: required(2000),
    examType: z.enum(EXAM_TYPES),
    examTypeOther: text(120).nullable(),
    technique: techniqueSchema,
    comparison: comparisonSchema,
    findings: z.array(findingSchema).min(1).max(30),
    impression: z.array(required(1000)).min(1).max(10),
    recommendations: recommendationsSchema,
    prescription: z.array(prescriptionSchema).max(10),
    urgency: z.enum(URGENCIES),
    language: z.enum(REPORT_LANGUAGES),
  })
  .superRefine((r, ctx) => {
    if (r.examType === 'other' && (r.examTypeOther ?? '').trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['examTypeOther'], message: 'Name the exam' });
    }
    if (r.recommendations.presets.includes('follow_up_imaging') && r.recommendations.followUpMonths === null) {
      ctx.addIssue({ code: 'custom', path: ['recommendations', 'followUpMonths'], message: 'Give the interval' });
    }
  });
export type ConsultReport = z.infer<typeof consultReportSchema>;

/**
 * What an autosave may store: every field optional, arrays may be empty, rows
 * may be half-typed — but every length cap still holds, so a draft cannot be
 * a way to park a megabyte in the database.
 */
export const consultReportDraftSchema = z
  .object({
    indication: text(2000),
    examType: z.enum(EXAM_TYPES),
    examTypeOther: text(120).nullable(),
    technique: techniqueSchema,
    comparison: z.object({
      kind: z.enum(['none', 'prior']),
      date: text(10).optional(),
      note: text(500).optional(),
    }),
    findings: z
      .array(z.object({ region: text(120), status: z.enum(['normal', 'abnormal']), description: text(2000) }))
      .max(30),
    impression: z.array(text(1000)).max(10),
    recommendations: recommendationsSchema,
    prescription: z
      .array(z.object({ drug: text(120), dose: text(60), frequency: text(60), duration: text(60) }))
      .max(10),
    urgency: z.enum(URGENCIES),
    language: z.enum(REPORT_LANGUAGES),
  })
  .partial();
export type ConsultReportDraft = z.infer<typeof consultReportDraftSchema>;
```

Add to `packages/contracts/src/index.ts`: `export * from './report';`

- [ ] **Step 4: Run tests, rebuild**

Run: `cd packages/contracts && npx vitest run src/report.test.ts && cd ../.. && pnpm --filter @mir/contracts build`
Expected: PASS (11 tests), build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/report.ts packages/contracts/src/report.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): the structured consult report schema (spec §5)"
```

---

### Task 2: `cases_reports` and who may touch it

**Files:**
- Create: `apps/api/migrations/0034_case_reports.up.sql`, `.down.sql`, `apps/api/src/modules/cases/report-rls.test.ts`

**Interfaces:**
- Produces: table `cases_reports(case_id uuid PK FK, author_id uuid, content jsonb, status text, created_at, updated_at, submitted_at)`.

- [ ] **Step 1: Write the failing test** — `apps/api/src/modules/cases/report-rls.test.ts`

Set up with the harness exactly as `cases-lifecycle.test.ts` does (`setupTestDatabase`, `truncateAll`, `createPractice`, `createUser`, `createPatient`, `createCase(h.owner, patient, doctor, status)`). Run SQL as a role with a helper that opens a transaction on `h.app` and sets the session context the way `DatabaseService.tx` does (read `apps/api/src/shared/db/database.service.ts` for the exact `set_config` keys and copy them):

```ts
async function as<T>(userId: string, role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await h.app.connect();
  try {
    await c.query('BEGIN');
    await c.query(/* the same set_config calls DatabaseService.tx makes */);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rows as T[];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
const insertDraft = (caseId: string, doctor: string) =>
  as(doctor, 'tunisia_doctor',
     `INSERT INTO cases_reports (case_id, author_id, content) VALUES ($1, $2, '{}'::jsonb) RETURNING case_id`,
     [caseId, doctor]);
```

Tests:
1. the assigned doctor inserts a draft on an `accepted` case and reads it back (1 row);
2. the assigned doctor inserting on a `paid` case throws `/row-level security/`;
3. another `tunisia_doctor` reads 0 rows;
4. the referring clinic (the `libya_doctor` who created the patient) reads 0 rows while `draft`; after `h.owner` sets `status='submitted', submitted_at=now()`, reads 1;
5. the doctor's `UPDATE cases_reports SET content='{"x":1}'` on the submitted row changes 0 rows;
6. `admin` reads the row.

- [ ] **Step 2: Run it to see it fail** — `cd apps/api && npx vitest run src/modules/cases/report-rls.test.ts` → FAIL `relation "cases_reports" does not exist`.

- [ ] **Step 3: Migration** — `0034_case_reports.up.sql`

```sql
-- The structured consult report — spec 2026-09-21 §5.
-- One row per case. The doctor drafts it while the case is `accepted`; it is
-- submitted in the same transaction that answers the case, and from then on it
-- is read-only for everybody.
BEGIN;

CREATE TABLE cases_reports (
  case_id      uuid PRIMARY KEY REFERENCES cases_cases(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES identity_users(id),
  content      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  -- Belt and braces on the API's 64 KB cap: a draft is not file storage.
  CONSTRAINT reports_content_bounded CHECK (pg_column_size(content) < 131072),
  CONSTRAINT reports_submitted_stamped CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);

ALTER TABLE cases_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases_reports FORCE  ROW LEVEL SECURITY;

-- The author, on their own case. Writes only while the case is accepted and
-- the row is still a draft; the subquery reads cases_cases under the doctor's
-- own policy, so "their case" is the database's answer, not the service's.
CREATE POLICY reports_doctor_select ON cases_reports FOR SELECT
  USING (app_current_role() = 'tunisia_doctor' AND author_id = app_current_user_id());
CREATE POLICY reports_doctor_insert ON cases_reports FOR INSERT
  WITH CHECK (
    app_current_role() = 'tunisia_doctor' AND author_id = app_current_user_id() AND status = 'draft'
    AND EXISTS (SELECT 1 FROM cases_cases c
                 WHERE c.id = case_id AND c.doctor_id = app_current_user_id() AND c.status = 'accepted'));
CREATE POLICY reports_doctor_update ON cases_reports FOR UPDATE
  USING (app_current_role() = 'tunisia_doctor' AND author_id = app_current_user_id() AND status = 'draft')
  WITH CHECK (
    author_id = app_current_user_id()
    AND EXISTS (SELECT 1 FROM cases_cases c
                 WHERE c.id = case_id AND c.doctor_id = app_current_user_id() AND c.status = 'accepted'));

-- The referring clinic reads the report once it is submitted, never a draft.
CREATE POLICY reports_referring_select ON cases_reports FOR SELECT
  USING (app_current_role() = 'libya_doctor' AND status = 'submitted' AND app_can_see_case(case_id));

CREATE POLICY reports_admin_select ON cases_reports FOR SELECT
  USING (app_current_role() = 'admin');

GRANT SELECT, INSERT, UPDATE ON cases_reports TO mir_app;

COMMIT;
```

`0034_case_reports.down.sql`:

```sql
BEGIN;
DROP TABLE IF EXISTS cases_reports;
COMMIT;
```

- [ ] **Step 4: Run the test** → PASS (6). Round-trip on a scratch database with the plan-2 `roundtrip.cjs` pattern (all ups, then 0034 down → up → down → up).

- [ ] **Step 5: Commit** — `feat(db): cases_reports — the doctor drafts, the clinic reads once submitted`

---

### Task 3: Draft, submit-and-answer, and the API routes

**Files:**
- Create: `apps/api/src/modules/cases/internal/reports.service.ts`, `apps/api/src/modules/cases/reports.test.ts`
- Modify: `cases.controller.ts`, `cases.service.ts`, `cases.module.ts`, `shared/events/domain-events.ts`, `modules/audit/internal/audit.service.ts`, `modules/audit/internal/audit.subscriber.ts`, and every test calling `markAnswered` (`grep -rn markAnswered apps/api/src`).

**Interfaces:**
- Consumes: Task 1 schemas and types; table `cases_reports` (Task 2).
- Produces:
  - `ReportsService.get(caseId): Promise<{ status: ReportStatus; content: ConsultReportDraft; submittedAt: Date | null } | null>`
  - `ReportsService.saveDraft(caseId, draft: ConsultReportDraft): Promise<void>` — `NotFoundException` unless the caller may write.
  - `ReportsService.submitWithAnswer(caseId, report: ConsultReport): Promise<void>` — one transaction: upsert, mark `submitted`, case `accepted → answered` with `answered_at`; after commit, `accrueDoctorPayout` under `systemContext`; publishes `CaseAnswered`.
  - Routes: `GET /cases/:id/report` → `{ status, content, submittedAt: string | null }` or 404; `PUT /cases/:id/report` (tunisia_doctor) → 204; `POST /cases/:id/answer` (tunisia_doctor) body `{ report }` → `{ status: 'answered' }`, 400 on an invalid report.
  - Events: `CaseAnswered { caseId, patientId, doctorId }`, `CaseReportDownloaded { caseId, patientId, format: 'pdf' }`; both `subjectType 'case'`, audited.

- [ ] **Step 1: Failing tests** — `reports.test.ts`. Setup mirrors `cases-lifecycle.test.ts`; construct `reports = new ReportsService(db, bus, new LedgerService(db))`. `acceptedCase()` reuses its `market()` → `cases.quote` → `cases.markPaid` → `cases.accept` path and returns `{ lab, doctor, caseId }`. `asDoctor`/`asLab` wrap `runWithContext(ctx(id, role), fn)`. `report` is the `valid` object from Task 1's test.

```ts
it('saves a draft and reads it back', async () => {
  const { doctor, caseId } = await acceptedCase();
  await asDoctor(doctor, () => reports.saveDraft(caseId, { indication: 'half-typed' }));
  const got = await asDoctor(doctor, () => reports.get(caseId));
  expect(got?.status).toBe('draft');
  expect(got?.content).toEqual({ indication: 'half-typed' });
});

it('the clinic cannot read a draft', async () => {
  const { lab, doctor, caseId } = await acceptedCase();
  await asDoctor(doctor, () => reports.saveDraft(caseId, { indication: 'x' }));
  expect(await asLab(lab, () => reports.get(caseId))).toBeNull();
});

it('submitting answers the case, stores the report and pays the doctor once', async () => {
  const { lab, doctor, caseId } = await acceptedCase();
  await asDoctor(doctor, () => reports.submitWithAnswer(caseId, report));
  expect(await statusOf(caseId)).toBe('answered');
  const seen = await asLab(lab, () => reports.get(caseId));
  expect(seen?.status).toBe('submitted');
  expect(seen?.content).toEqual(report);
  // A double click: the second submit finds no accepted case.
  await expect(asDoctor(doctor, () => reports.submitWithAnswer(caseId, report))).rejects.toThrow(/not found/i);
  const payouts = await h.owner.query(
    "SELECT 1 FROM billing_ledger_entries WHERE case_id = $1 AND kind = 'doctor_payout'",
    [caseId],
  );
  expect(payouts.rowCount).toBe(1);
});

it('a submitted report can no longer be edited', async () => {
  const { doctor, caseId } = await acceptedCase();
  await asDoctor(doctor, () => reports.submitWithAnswer(caseId, report));
  await expect(asDoctor(doctor, () => reports.saveDraft(caseId, { indication: 'changed' }))).rejects.toThrow(/not found/i);
});

it('the answer route refuses a missing or incomplete report', async () => {
  const { doctor, caseId } = await acceptedCase();
  const controller = new CasesController(cases, directory, reports);
  await expect(asDoctor(doctor, () => controller.answer(caseId, {}))).rejects.toBeInstanceOf(BadRequestException);
  await expect(
    asDoctor(doctor, () => controller.answer(caseId, { report: { ...report, impression: [] } })),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(await statusOf(caseId)).toBe('accepted');
});
```

In `cases-lifecycle.test.ts` (and any other caller) replace `cases.markAnswered(caseId)` with `reports.submitWithAnswer(caseId, report)`.

- [ ] **Step 2: Run** → FAIL (`ReportsService` missing).

- [ ] **Step 3: Implement** `reports.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { ConsultReport, ConsultReportDraft, ReportStatus } from '@mir/contracts';
import { requireContext, runWithContext, systemContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import { EventBus } from '../../../shared/events/event-bus';
import { LedgerService } from '../../ledger';

/** An RLS WITH CHECK refusal reads as "no such case", like every verb here (§6). */
const refusedAsMissing = <T>(fallback: T) => (err: unknown): T => {
  if (err instanceof Error && /row-level security/.test(err.message)) return fallback;
  throw err;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    private readonly ledger: LedgerService,
  ) {}

  async get(caseId: string): Promise<{ status: ReportStatus; content: ConsultReportDraft; submittedAt: Date | null } | null> {
    return this.db.tx(async (tx) => {
      const r = await tx.query<{ status: ReportStatus; content: ConsultReportDraft; submitted_at: Date | null }>(
        'SELECT status, content, submitted_at FROM cases_reports WHERE case_id = $1',
        [caseId],
      );
      const row = r.rows[0];
      return row === undefined ? null : { status: row.status, content: row.content, submittedAt: row.submitted_at };
    });
  }

  async saveDraft(caseId: string, draft: ConsultReportDraft): Promise<void> {
    const { userId } = requireContext();
    const written = await this.db
      .tx(async (tx) => {
        const r = await tx.query(
          `INSERT INTO cases_reports (case_id, author_id, content) VALUES ($1, $2, $3)
           ON CONFLICT (case_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
             WHERE cases_reports.status = 'draft'`,
          [caseId, userId, JSON.stringify(draft)],
        );
        return r.rowCount ?? 0;
      })
      .catch(refusedAsMissing(0));
    if (written === 0) throw new NotFoundException('Case not found');
  }

  async submitWithAnswer(caseId: string, report: ConsultReport): Promise<void> {
    const ctx = requireContext();
    const answered = await this.db
      .tx(async (tx) => {
        const up = await tx.query(
          `INSERT INTO cases_reports (case_id, author_id, content) VALUES ($1, $2, $3)
           ON CONFLICT (case_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
             WHERE cases_reports.status = 'draft'`,
          [caseId, ctx.userId, JSON.stringify(report)],
        );
        if ((up.rowCount ?? 0) === 0) return null;
        // Submitted BEFORE the case moves: the update policy requires the case
        // to still be `accepted`.
        await tx.query(
          `UPDATE cases_reports SET status = 'submitted', submitted_at = now() WHERE case_id = $1`,
          [caseId],
        );
        const moved = await tx.query<{ patient_id: string; doctor_id: string }>(
          `UPDATE cases_cases SET status = 'answered', answered_at = now()
            WHERE id = $1 AND status = 'accepted' RETURNING patient_id, doctor_id`,
          [caseId],
        );
        // Throwing rolls the report back with the case: no submitted report on
        // a case that did not move.
        if (moved.rows[0] === undefined) throw new NotFoundException('Case not found');
        return moved.rows[0];
      })
      .catch(refusedAsMissing(null));
    if (answered === null) throw new NotFoundException('Case not found');

    // As the system role — the ledger's INSERT policy admits nobody else (see
    // CasesService.markPaid). Idempotent by the one-payout-per-case index.
    await runWithContext(systemContext('case-accrual'), () => this.ledger.accrueDoctorPayout(caseId));
    await this.bus.publish({
      type: 'CaseAnswered',
      caseId,
      patientId: answered.patient_id,
      doctorId: answered.doctor_id,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
```

(Check `DomainEventBase` for the exact base fields and `CasesService.actorFields()` for how they are filled; use the same.)

Controller (`cases.controller.ts`; constructor gains `private readonly reports: ReportsService`):

```ts
@RequiresRole('tunisia_doctor', 'libya_doctor', 'admin')
@Get('cases/:id/report')
async report(@Param('id', ParseUUIDPipe) id: string) {
  const r = await this.reports.get(id);
  if (r === null) throw new NotFoundException('Report not found');
  return { status: r.status, content: r.content, submittedAt: r.submittedAt?.toISOString() ?? null };
}

@RequiresRole('tunisia_doctor')
@Put('cases/:id/report')
@HttpCode(204)
async saveReport(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<void> {
  const draft = consultReportDraftSchema.safeParse(body);
  if (!draft.success || JSON.stringify(draft.data).length > 64 * 1024) {
    throw new BadRequestException('Invalid draft');
  }
  await this.reports.saveDraft(id, draft.data);
}

@RequiresRole('tunisia_doctor')
@Post('cases/:id/answer')
@HttpCode(200)
async answer(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<{ status: 'answered' }> {
  const parsed = z.object({ report: consultReportSchema }).safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ message: 'A complete report is required', issues: parsed.error.issues });
  }
  await this.reports.submitWithAnswer(id, parsed.data.report);
  return { status: 'answered' };
}
```

Delete `CasesService.markAnswered`. Add `CaseAnswered` and `CaseReportDownloaded` to `domain-events.ts` (interfaces + union), to `subjectTypeFor`/`subjectIdFor`/`metadataFor` in `audit.service.ts` (`'case'`, `event.caseId`, `{ doctorId }` / `{ format }`), and to `AUDITED_EVENTS` in `audit.subscriber.ts`. Provide `ReportsService` in `cases.module.ts`.

- [ ] **Step 4: Run** `cd apps/api && npx vitest run src/modules/cases src/modules/audit src/modules/ledger && npx tsc --noEmit -p .` → PASS (the audit completeness test must include the two new events).

- [ ] **Step 5: Commit** — `feat(cases): answering submits the structured report in one transaction`

---

### Task 4: The PDF

**Files:**
- Create: `apps/api/src/modules/cases/internal/report-pdf.ts`, `report-pdf-labels.ts`, `report-pdf.test.ts`
- Modify: `apps/api/package.json`, `cases.controller.ts`, `cases.module.ts`, `reports.test.ts`

**Interfaces:**
- Consumes: `ConsultReport` (Task 1); `ReportsService.get` (Task 3); `CasesService.getCase(id)` → `CaseSummary { caseRef, doctorName, patientAgeYears, patientSex, patientId }`.
- Produces:
  - `interface ReportPdfInput { caseRef: string; patientAgeYears: number | null; patientSex: string | null; doctorName: string; submittedAt: Date; report: ConsultReport }` — **no name field**.
  - `buildReportDocument(input: ReportPdfInput): { title: string; header: [string, string][]; sections: { heading: string; lines: string[] }[] }`
  - `renderReportPdf(input: ReportPdfInput): Promise<Buffer>`
  - `ReportPdfService.forCase(caseId): Promise<{ filename: string; bytes: Buffer }>` — 404 unless `submitted`; publishes `CaseReportDownloaded`.
  - Route `GET /cases/:id/report.pdf` (tunisia_doctor, libya_doctor, admin).

- [ ] **Step 1: Install** — `pnpm --filter @mir/api add pdfkit dejavu-fonts-ttf && pnpm --filter @mir/api add -D @types/pdfkit`

- [ ] **Step 2: Failing tests** — `report-pdf.test.ts`

```ts
const input: ReportPdfInput = {
  caseRef: 'MIR-2026-0042',
  patientAgeYears: 47,
  patientSex: 'F',
  doctorName: 'Dr Karim Receiving',
  submittedAt: new Date('2026-09-24T10:00:00Z'),
  report: { ...valid, language: 'fr' }, // `valid` from Task 1's test
};

it('carries the case reference, age, sex, doctor and time', () => {
  const all = JSON.stringify(buildReportDocument(input));
  for (const s of ['MIR-2026-0042', '47', 'Dr Karim Receiving', '2026-09-24']) expect(all).toContain(s);
});

it('has no field a patient name could arrive through', () => {
  const doc = buildReportDocument({ ...input, patientName: 'Amal Ben Ali' } as ReportPdfInput);
  expect(JSON.stringify(doc)).not.toContain('Amal');
});

it('labels in the report language', () => {
  expect(buildReportDocument(input).sections.map((s) => s.heading)).toContain('Conclusion');
  const en = buildReportDocument({ ...input, report: { ...input.report, language: 'en' } });
  expect(en.sections.map((s) => s.heading)).toContain('Impression');
});

it('renders non-ASCII free text without throwing', async () => {
  const pdf = await renderReportPdf({
    ...input,
    report: { ...input.report, impression: ['Lésion ≥ 5 mm, 3 µL — ورم'] },
  });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.byteLength).toBeGreaterThan(2000);
});
```

In `reports.test.ts`: for a submitted report, `pdf.forCase(caseId)` as the clinic returns bytes starting `%PDF-` and a filename `MIR-…-report.pdf`, and `audit_events` gains one `CaseReportDownloaded` row; for a draft, as the clinic, it throws `NotFoundException`.

- [ ] **Step 3: Implement.**

`report-pdf-labels.ts` exports `REPORT_LABELS: Record<'en' | 'fr', ReportLabels>` where `ReportLabels` has: `title` (“Radiology report” / “Compte rendu radiologique”), `caseRef` (“Case” / “Dossier”), `patient` (“Patient” / “Patient”), `patientValue(age, sex)` (“47 y · F” / “47 ans · F”, “—” for unknowns), `doctor` (“Reporting doctor” / “Médecin rédacteur”), `submitted` (“Submitted” / “Transmis le”), `urgency`, `indication` (“Clinical indication” / “Indication clinique”), `examType` (“Examination” / “Examen”), `technique` (“Technique”), `contrast` (“Contrast: yes/no” / “Injection : oui/non”), `comparison` (“Comparison” / “Comparaison”), `none` (“None” / “Aucune”), `prior(date, note)`, `findings` (“Findings” / “Résultats”), `normal`/`abnormal` (“Normal”/“Abnormal”, “Normal”/“Anormal”), `impression` (“Impression” / “Conclusion”), `recommendations` (“Recommendations” / “Recommandations”), `followUp(n)` (“Follow-up imaging in n months” / “Imagerie de contrôle dans n mois”), `prescription` (“Prescription” / “Ordonnance”), and value maps `examTypes`, `sequences`, `presets`, `urgencies` covering every enum entry.

`report-pdf.ts`:

```ts
import { createRequire } from 'node:module';
import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ConsultReport } from '@mir/contracts';
import { REPORT_LABELS } from './report-pdf-labels';

const resolve = createRequire(__filename).resolve;
// Embedded, not a PDF base-14 font: those cover WinAnsi only, and a doctor's
// "≥ 5 mm" or a name with a non-Latin letter would print as garbage.
const FONT = resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

export interface ReportPdfInput {
  caseRef: string;
  patientAgeYears: number | null;
  patientSex: string | null;
  doctorName: string;
  submittedAt: Date;
  report: ConsultReport;
}

export function buildReportDocument(input: ReportPdfInput) {
  const r = input.report;
  const L = REPORT_LABELS[r.language];
  const header: [string, string][] = [
    [L.caseRef, input.caseRef],
    [L.patient, L.patientValue(input.patientAgeYears, input.patientSex)],
    [L.doctor, input.doctorName],
    [L.submitted, `${input.submittedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`],
    [L.urgency, L.urgencies[r.urgency]],
  ];
  const exam = r.examType === 'other' ? (r.examTypeOther ?? '') : L.examTypes[r.examType];
  const sections = [
    { heading: L.indication, lines: [r.indication] },
    { heading: L.examType, lines: [exam] },
    {
      heading: L.technique,
      lines: [r.technique.sequences.map((s) => L.sequences[s]).join(', ') || '—', L.contrast(r.technique.contrast)],
    },
    {
      heading: L.comparison,
      lines: [r.comparison.kind === 'none' ? L.none : L.prior(r.comparison.date, r.comparison.note)],
    },
    {
      heading: L.findings,
      lines: r.findings.map(
        (f) => `${f.region} — ${f.status === 'normal' ? L.normal : L.abnormal}${f.description ? `: ${f.description}` : ''}`,
      ),
    },
    { heading: L.impression, lines: r.impression.map((line, i) => `${i + 1}. ${line}`) },
    {
      heading: L.recommendations,
      lines: [
        ...r.recommendations.presets.map((p) =>
          p === 'follow_up_imaging' && r.recommendations.followUpMonths !== null
            ? L.followUp(r.recommendations.followUpMonths)
            : L.presets[p],
        ),
        ...(r.recommendations.other.trim() ? [r.recommendations.other] : []),
      ],
    },
    ...(r.prescription.length === 0
      ? []
      : [{ heading: L.prescription, lines: r.prescription.map((p) => `${p.drug} · ${p.dose} · ${p.frequency} · ${p.duration}`) }]),
  ];
  return { title: L.title, header, sections };
}

export function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const model = buildReportDocument(input);
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${model.title} ${input.caseRef}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('body', FONT);
    doc.registerFont('bold', FONT_BOLD);
    doc.font('bold').fontSize(16).text(model.title);
    doc.moveDown(0.5).fontSize(10);
    for (const [k, v] of model.header) doc.font('bold').text(`${k}: `, { continued: true }).font('body').text(v);
    for (const s of model.sections) {
      doc.moveDown(0.8).font('bold').fontSize(12).text(s.heading);
      doc.font('body').fontSize(10);
      for (const line of s.lines) doc.text(line);
    }
    doc.end();
  });
}

@Injectable()
export class ReportPdfService {
  constructor(
    private readonly reports: ReportsService,
    private readonly cases: CasesService,
    private readonly bus: EventBus,
  ) {}

  async forCase(caseId: string): Promise<{ filename: string; bytes: Buffer }> {
    const stored = await this.reports.get(caseId);
    if (stored === null || stored.status !== 'submitted' || stored.submittedAt === null) {
      throw new NotFoundException('Report not found');
    }
    const c = await this.cases.getCase(caseId);
    const bytes = await renderReportPdf({
      caseRef: c.caseRef,
      patientAgeYears: c.patientAgeYears,
      patientSex: c.patientSex,
      doctorName: c.doctorName ?? '—',
      submittedAt: stored.submittedAt,
      report: consultReportSchema.parse(stored.content),
    });
    await this.bus.publish({ type: 'CaseReportDownloaded', caseId, patientId: c.patientId, format: 'pdf', ...actorFields() });
    return { filename: `${c.caseRef}-report.pdf`, bytes };
  }
}
```

(`actorFields()` is the helper Task 3 shares from `cases.service.ts`. Import `ReportsService`, `CasesService`, `EventBus`, `consultReportSchema` at the top.)

Controller — constructor gains `private readonly pdf: ReportPdfService` (update Task 3's `new CasesController(cases, directory, reports)` in `reports.test.ts` to pass `new ReportPdfService(reports, cases, bus)` as the fourth argument); add `Res` and `Response` imports as `dicomweb.controller.ts` does:

```ts
@RequiresRole('tunisia_doctor', 'libya_doctor', 'admin')
@Get('cases/:id/report.pdf')
async reportPdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
  const { filename, bytes } = await this.pdf.forCase(id);
  res.status(200);
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.setHeader('cache-control', 'no-store, private');
  res.end(bytes);
}
```

`ParseUUIDPipe` on `:id` with the `.pdf` suffix: Express puts `report.pdf` in its own segment, so `:id` is only the uuid. Provide `ReportPdfService` in `cases.module.ts`.

- [ ] **Step 4: Run** `npx vitest run src/modules/cases && npx tsc --noEmit -p . && pnpm build` → PASS; start the built API once (`$SP/api-restart.sh`) to prove the font path resolves from `dist/` and the route audit accepts the new routes.

- [ ] **Step 5: Commit** — `feat(cases): the report as a PDF — case ref, age, sex, doctor; never the name`

---

### Task 5: The web client and the report form

**Files:**
- Create: `apps/web/lib/report/draft.ts`, `draft.test.ts`, `apps/web/lib/report/download.ts`, `apps/web/components/report/ReportForm.tsx`, `apps/web/components/report/ReportView.tsx`
- Modify: `apps/web/lib/api/endpoints.ts`, `apps/web/lib/i18n/dictionary.ts`

**Interfaces:**
- Consumes: Task 1 schemas; routes from Tasks 3–4.
- Produces:
  - `api.cases.report(id): Promise<{ status: ReportStatus; content: ConsultReportDraft; submittedAt: string | null }>`
  - `api.cases.saveReport(id, draft: ConsultReportDraft): Promise<void>`
  - `api.cases.answer(id, report: ConsultReport): Promise<{ status: 'answered' }>`
  - `downloadReportPdf(caseId: string, caseRef: string): Promise<void>`
  - `emptyReport(indication: string, language: 'en' | 'fr'): ConsultReportDraft`
  - `completeReport(draft: ConsultReportDraft): ConsultReport | null`
  - `<ReportForm caseId caseRef initial onSubmitted />`, `<ReportView report caseId caseRef />`

- [ ] **Step 1: Failing tests** — `apps/web/lib/report/draft.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { completeReport, emptyReport } from './draft';

describe('report drafts', () => {
  it('starts from the referral reason, in the chosen language, with one empty row each', () => {
    const d = emptyReport('Headaches', 'fr');
    expect(d.indication).toBe('Headaches');
    expect(d.language).toBe('fr');
    expect(d.findings).toEqual([{ region: '', status: 'normal', description: '' }]);
    expect(d.impression).toEqual(['']);
    expect(d.comparison).toEqual({ kind: 'none' });
    expect(d.urgency).toBe('routine');
  });

  it('is not complete until the required fields are', () => {
    const d = emptyReport('Headaches', 'en');
    expect(completeReport(d)).toBeNull();
    const filled = {
      ...d,
      examType: 'mri_brain' as const,
      findings: [{ region: 'Brain', status: 'normal' as const, description: '' }],
      impression: ['Normal study.'],
    };
    expect(completeReport(filled)?.impression).toEqual(['Normal study.']);
  });

  it('keeps a prior comparison', () => {
    const d = {
      ...emptyReport('x', 'en'),
      examType: 'mri_knee' as const,
      findings: [{ region: 'Knee', status: 'abnormal' as const, description: 'Tear' }],
      impression: ['Meniscal tear.'],
      comparison: { kind: 'prior' as const, date: '2026-01-02', note: '' },
    };
    expect(completeReport(d)?.comparison).toEqual({ kind: 'prior', date: '2026-01-02', note: '' });
  });
});
```

- [ ] **Step 2: Run** `cd apps/web && npx vitest run lib/report` → FAIL.

- [ ] **Step 3: Implement.**

`draft.ts`:

```ts
import { consultReportSchema, type ConsultReport, type ConsultReportDraft } from '@mir/contracts';

export function emptyReport(indication: string, language: 'en' | 'fr'): ConsultReportDraft {
  return {
    indication,
    examTypeOther: null,
    technique: { sequences: [], contrast: false },
    comparison: { kind: 'none' },
    findings: [{ region: '', status: 'normal', description: '' }],
    impression: [''],
    recommendations: { presets: [], followUpMonths: null, other: '' },
    prescription: [],
    urgency: 'routine',
    language,
  };
}

/** The draft as a submittable report, or null while anything required is missing. */
export function completeReport(draft: ConsultReportDraft): ConsultReport | null {
  const comparison =
    draft.comparison?.kind === 'prior'
      ? { kind: 'prior' as const, date: draft.comparison.date ?? '', note: draft.comparison.note ?? '' }
      : { kind: 'none' as const };
  const parsed = consultReportSchema.safeParse({ ...draft, comparison });
  return parsed.success ? parsed.data : null;
}
```

`download.ts` — `authedFetch(`/api/cases/${caseId}/report.pdf`)`, `res.ok` else throw, blob → object URL → anchor `download = `${caseRef}-report.pdf`` → click → revoke (same pattern as the viewer's `downloadOriginal`).

Endpoints (`lib/api/endpoints.ts`, inside `cases`): `report: (id) => apiFetch(`/cases/${id}/report`)`, `saveReport: (id, draft) => apiFetch(`/cases/${id}/report`, { method: 'PUT', body: JSON.stringify(draft) })`, and change `answer` to `(id, report) => apiFetch(`/cases/${id}/answer`, { method: 'POST', body: JSON.stringify({ report }) })`. (Follow how neighbouring calls pass a JSON body.)

`ReportForm` (client component; inputs from `components/ui`; every label a `report*` dictionary key; logical utilities only):
1. Indication — `<Textarea maxLength={2000}>`.
2. Exam type — `<Select>` over `EXAM_TYPES`; `other` reveals `<Input maxLength={120}>`.
3. Technique — a checkbox per `SEQUENCES` entry; a "Contrast" checkbox.
4. Comparison — radio none/prior; prior reveals `<Input type="date">` + note `<Input maxLength={500}>`.
5. Findings — rows: region `<Input maxLength={120}>` · normal/abnormal two-button toggle · description `<Textarea maxLength={2000}>`; "Add finding" (max 30) / remove (never below one).
6. Impression — numbered `<Textarea maxLength={1000}>` lines; "Add line" (max 10) / remove (never below one).
7. Recommendations — checkbox per preset; `follow_up_imaging` reveals `<Input type="number" min={1} max={60}>` months; "Other" `<Input maxLength={500}>`.
8. Prescription (optional) — rows drug · dose · frequency · duration; "Add medication" (max 10).
9. Urgency — radio routine/urgent/critical.
10. Report language — radio English / Français.

Autosave: a `useEffect` on the draft with a 2 s debounce calls `api.cases.saveReport`; the status line (`data-testid="report-save-state"`) shows saving / saved-at time / failed (retried on the next change). The first render does not save (skip when the draft equals `initial`). Submit (`data-testid="report-submit"`) is disabled until `completeReport(draft) !== null`; while disabled, a line lists what is missing (`data-testid="report-missing"`: indication, exam type, a finding region, an impression line, the exam name for "other", the follow-up interval). Submit calls `api.cases.answer(caseId, complete)` and then `onSubmitted()`; a failure shows the error and keeps the form.

`ReportView`: the same sections read-only (UI-locale labels from the dictionary), plus "Download PDF" (`data-testid="report-download-pdf"`) calling `downloadReportPdf`.

Dictionary: every `report*` key in ar, fr and en — section titles, each exam type, each sequence, each preset, urgency values, language names, add/remove buttons, save states, the missing-fields line, and the download label.

- [ ] **Step 4: Run** `npx vitest run lib/report && npx vitest run lib/i18n && npx tsc --noEmit -p . && npx eslint components/report lib/report lib/api/endpoints.ts` → PASS, clean.

- [ ] **Step 5: Commit** — `feat(web): the structured report form with autosave, and its read-only view`

---

### Task 6: The diagnostic viewer

**Files:**
- Create: `apps/web/lib/viewer/series.ts`, `series.test.ts`, `apps/web/components/viewer/StudyViewer.tsx`
- Modify: `apps/web/package.json`, `apps/web/lib/viewer/cornerstone.ts`, `apps/web/app/viewer/[studyUid]/page.tsx`, `apps/web/e2e/viewer.spec.ts`, `apps/api/src/modules/imaging/internal/dicomweb.controller.ts`, `apps/api/src/modules/imaging/dicomweb-series-path.test.ts`, dictionary.

**Interfaces:**
- Produces:
  - API `GET /dicom-web/studies/:studyUid/series/:seriesUid/metadata` → DICOM JSON array for the series (no pixels), audited as `metadata`.
  - `groupSeries(instances: { sopInstanceUid: string; seriesInstanceUid: string }[]): { seriesInstanceUid: string; sopInstanceUids: string[] }[]`
  - ```ts
    interface CornerstoneViewer {
      loadSeries(seriesInstanceUid: string, sopInstanceUids: string[], startIndex: number): Promise<void>;
      setSlice(index: number): Promise<void>;
      onSliceChange(cb: (index: number) => void): () => void;
      setTool(tool: 'windowLevel' | 'pan' | 'zoom' | 'length' | 'angle'): void;
      invert(): void;
      autoWindow(): void;
      reset(): void;
      destroy(): void;
    }
    ```
  - `<StudyViewer studyUid: string; compact?: boolean />`

- [ ] **Step 1: Failing tests**
  - `apps/web/lib/viewer/series.test.ts`:
    ```ts
    it('groups by series in first-appearance order', () => {
      expect(groupSeries([
        { sopInstanceUid: 'a1', seriesInstanceUid: 'A' },
        { sopInstanceUid: 'b1', seriesInstanceUid: 'B' },
        { sopInstanceUid: 'a2', seriesInstanceUid: 'A' },
      ])).toEqual([
        { seriesInstanceUid: 'A', sopInstanceUids: ['a1', 'a2'] },
        { seriesInstanceUid: 'B', sopInstanceUids: ['b1'] },
      ]);
    });
    it('is empty for no instances', () => expect(groupSeries([])).toEqual([]));
    ```
  - `apps/api/src/modules/imaging/dicomweb-series-path.test.ts`:
    ```ts
    it('asks Orthanc for series metadata under the resolved study', async () => {
      const paths: string[] = [];
      await controller(paths).seriesMetadata('twin.1', 'ser.1');
      expect(paths).toEqual(['/dicom-web/studies/twin.1/series/ser.1/metadata']);
    });
    ```
  - `apps/web/e2e/viewer.spec.ts` (API still stubbed): replace the three banner tests with one asserting `page.getByTestId('diagnostic-banner')` has count 0; where CT presets were asserted, assert `tool-invert`, `tool-auto-window`, `tool-reset` are hidden while the viewer stays on the preview (the stub 404s metadata); add a two-series stub (instances alternate between two `seriesInstanceUid`s) asserting `series-picker` has two options and that choosing the second shows `1 / 60` in `image-position`; a one-instance stub asserts `slice-slider` is disabled.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

API route next to `instanceMetadata`:

```ts
@RequiresRole('tunisia_doctor', 'libya_doctor')
@Get('studies/:studyUid/series/:seriesUid/metadata')
@Header('cache-control', 'no-store')
async seriesMetadata(@Param('studyUid') studyUid: string, @Param('seriesUid') seriesUid: string): Promise<unknown> {
  // The RESOLVED uid: for a doctor the path names the de-identified twin.
  const study = await this.access.authoriseStudyAccess(studyUid, 'metadata');
  const upstream = await this.orthanc.retrieve(
    `/dicom-web/studies/${encodeURIComponent(study.orthancStudyUid)}/series/${encodeURIComponent(seriesUid)}/metadata`,
    'application/dicom+json',
  );
  if (!upstream.ok) throw new NotFoundException('Series metadata not found');
  return upstream.json();
}
```

`series.ts`:

```ts
export interface SeriesGroup { seriesInstanceUid: string; sopInstanceUids: string[] }
export function groupSeries(instances: { sopInstanceUid: string; seriesInstanceUid: string }[]): SeriesGroup[] {
  const groups = new Map<string, string[]>();
  for (const i of instances) {
    const list = groups.get(i.seriesInstanceUid) ?? [];
    list.push(i.sopInstanceUid);
    groups.set(i.seriesInstanceUid, list);
  }
  return [...groups].map(([seriesInstanceUid, sopInstanceUids]) => ({ seriesInstanceUid, sopInstanceUids }));
}
```

`cornerstone.ts`:
- `pnpm --filter web add @cornerstonejs/tools@$(node -p "require('@cornerstonejs/core/package.json').version")` (run in `apps/web`).
- `ensureInitialised` also imports `@cornerstonejs/tools`, and once: `tools.init()` and `tools.addTool(X)` for `StackScrollTool`, `WindowLevelTool`, `PanTool`, `ZoomTool`, `LengthTool`, `AngleTool`.
- `createViewer` creates tool group `mir-tools-${studyUid}` (`tools.ToolGroupManager.createToolGroup`), adds every tool, adds the viewport, and binds: StackScroll → `MouseBindings.Wheel`; WindowLevel → `Primary`; Pan → `Auxiliary`; Zoom → `Secondary`. `setTool(t)` sets the chosen tool active on `Primary` and the previous primary tool passive (Length/Angle stay visible as annotations).
- `loadSeries(series, sops, start)`: fetch `${apiBase}/dicom-web/studies/${studyUid}/series/${series}/metadata` once with `authedFetch`; for each instance JSON, read its SOP uid from tag `00080018` and `loader.wadors.metaDataManager.add(imageIdFor(sop, series), json)`; then `viewport.setStack(sops.map((s) => imageIdFor(s, series)), start)`; `tools.utilities.stackPrefetch.enable(element)` for the small neighbourhood prefetch; `viewport.render()`.
- `setSlice(i)`: `await viewport.setImageIdIndex(i)`.
- `onSliceChange(cb)`: `element.addEventListener(core.Enums.Events.STACK_NEW_IMAGE, handler)` where `handler` calls `cb(viewport.getCurrentImageIdIndex())`; return the remover.
- `invert()`: `viewport.setProperties({ invert: !viewport.getProperties().invert }); viewport.render()`.
- `autoWindow()`: remember `invert`, `viewport.resetProperties()`, re-apply `invert`, render.
- `reset()`: `viewport.resetCamera(); viewport.resetProperties(); viewport.render()`.
- `destroy()`: destroy the tool group, then the engine.
- Remove `showInstance`, `setWindow`, `resetWindow`, `windowToRange` and the header paragraph that calls this "NOT a diagnostic viewer" (the owner decided otherwise; spec decisions).

`StudyViewer.tsx`: move the body of today's page into it, keeping the load order, the `mir:viewer-first-image` mark, the 15 s timeout and their comments. Changes:
- `groups = groupSeries(instances)`; state `seriesIndex` and `slice`; the preview thumbnail follows `groups[seriesIndex].sopInstanceUids[slice]`;
- after the upgrade: `viewer.loadSeries(group.seriesInstanceUid, group.sopInstanceUids, slice)` and `viewer.onSliceChange(setSlice)` so the wheel keeps the counter in sync; when the user moves the slider or prev/next, call `viewer.setSlice(i)`;
- controls: `prev-image`, `next-image`, `image-position` ("n / N"), `slice-slider` `<input type="range" min={0} max={N-1}>`, all disabled when `N === 1`;
- `series-picker` `<Select>` only when `groups.length > 1`; a change sets `slice` to 0 and calls `loadSeries` for the new group;
- toolbar only when `fidelity === 'full'`: a one-active toggle group `tool-window-level`, `tool-pan`, `tool-zoom`, `tool-length`, `tool-angle`, plus buttons `tool-invert`, `tool-auto-window`, `tool-reset`;
- no `DiagnosticUseBanner`, no CT presets; keep `download-original`, `study-info`, `first-image-rendered`, `full-fidelity-rendered`, `viewer-error`, `current-image`;
- root `<section data-testid="viewer" data-study-uid={studyUid} data-fidelity={fidelity}>`; viewport `aspect-square max-w-lg`, or `w-full aspect-square` with `compact`;
- the viewport container gets `onContextMenu={(e) => e.preventDefault()}` so right-drag zoom works.

The page:

```tsx
'use client';
import { use } from 'react';
import { Main } from '../../../components/ui';
import { StudyViewer } from '../../../components/viewer/StudyViewer';
import { useT } from '../../../lib/i18n/provider';

export default function ViewerPage({ params }: { params: Promise<{ studyUid: string }> }) {
  const { studyUid } = use(params);
  const t = useT();
  return (
    <Main>
      <h1 className="text-xl font-bold tracking-tight">{t.viewerTitle}</h1>
      <StudyViewer studyUid={studyUid} />
    </Main>
  );
}
```

Dictionary: `viewerToolWindowLevel`, `viewerToolPan`, `viewerToolZoom`, `viewerToolLength`, `viewerToolAngle`, `viewerInvert`, `viewerAutoWindow`, `viewerReset`, `viewerSeries`, `viewerSlice` in ar/fr/en. Remove the now-unused `viewerWindowSoft/Lung/Bone` keys only if the dictionary test does not require them.

- [ ] **Step 4: Run** API `npx vitest run src/modules/imaging`; web `npx vitest run lib/viewer && npx tsc --noEmit -p . && npx eslint components/viewer lib/viewer app/viewer`; rebuild web (`$SP/web-restart.sh`) and `npx playwright test e2e/viewer.spec.ts --workers=1` → PASS; the budget test still logs < 600 KB before first image.

- [ ] **Step 5: Commit** — `feat(viewer): diagnostic tools — stack scroll, W/L, pan, zoom, measure, invert; series picker; banner and CT presets removed`

---

### Task 7: The Read & report workspace

**Files:**
- Modify: `apps/web/app/cases/[ref]/page.tsx`, `apps/web/app/doctor/page.tsx`, dictionary.

**Interfaces:**
- Consumes: `StudyViewer` (Task 6); `ReportForm`, `ReportView`, `emptyReport`, `api.cases.report` (Task 5); the page's existing `studies` (live studies list with `studyInstanceUid`).

- [ ] **Step 1: Implement.**
  - Case page, `side === 'destination' && status === 'accepted'`: remove the `answer-case` button and the `'answer'` branch of `act`; render `<div className="grid gap-5 lg:grid-cols-2" data-testid="read-and-report">` with, on the start side, `<StudyViewer studyUid={chosenStudy} compact />` (a `<Select data-testid="workspace-study">` when there are several studies; `<EmptyState>{t.caseNoStudy}</EmptyState>` when none) and, on the end side, `<ReportForm caseId={record.id} caseRef={item.ref} initial={draft ?? emptyReport(record.reason ?? '', 'en')} onSubmitted={load} />`. Load the draft with `api.cases.report(record.id)`; a 404 means "no draft yet".
  - Case page, status `answered` or `closed`, either side: `<ReportView report={...} caseId={record.id} caseRef={item.ref} />` from `api.cases.report`.
  - `app/doctor/page.tsx`: replace the `answer-case` button with `<Link href={`/cases/${c.id}`} data-testid="write-report" className={buttonVariants({ variant: 'primary' })}>{t.inboxWriteReport}</Link>`; delete the `'answer'` branch of `act` and the `inboxAnswered` notice use.
  - Dictionary: `inboxWriteReport`, `caseReadAndReport`, `caseReportTitle`, `caseNoStudy` in ar/fr/en.

- [ ] **Step 2: Browser walk** (production build on 3210, API on 3110, the plan-2 walker pattern; apply 0034 to the local database first): Karim opens an accepted case with a study → the viewer reaches `full` → he fills part of the form, waits 2.5 s, reloads, the draft is back (Review Focus 1) → submit stays disabled and `report-missing` lists what is left → he completes and submits → the case is `answered`; the read-only report and "Download PDF" appear → the PDF downloads (starts `%PDF-`) → extract its text with `pdfjs-dist` (`getDocument(bytes).promise` → `getPage(n).getTextContent()`) and assert it contains the case ref and not the patient's name → the clinic opens the same case, sees the report, downloads the PDF → ops' audit log lists `CaseReportDownloaded`. On a second case, two quick submits yield one payout (Review Focus 2).

- [ ] **Step 3: Run** web unit, `npx tsc --noEmit -p .`, lint, full Playwright `--workers=2`.

- [ ] **Step 4: Commit** — `feat(web): Read & report — the viewer beside the form; the report and its PDF for both sides`

---

### Task 8: Verification pass

- [ ] Full API suite, contracts, web unit, Playwright (`--workers=2`); the Task 7 walk for doctor, clinic and ops; the viewer on the real seeded MR series (`test-data/dicom/03-mr-series`): wheel scroll moves `n / N`, W/L drag changes contrast, the length tool draws, invert and reset work, frame requests stay near the visible slice (network log). Record results and anything deferred at the bottom of this file.
