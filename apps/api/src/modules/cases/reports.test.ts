import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createPatient,
  createPractice,
  grantConsent,
  seedAcceptingDoctors,
  seedDoctor,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { EventBus } from '../../shared/events/event-bus';
import { CasesController } from './internal/cases.controller';
import { CasesService } from './internal/cases.service';
import { DirectoryService } from './internal/directory.service';
import { ReportPdfService } from './internal/report-pdf';
import { ReportsService } from './internal/reports.service';
import { LedgerService } from '../ledger';
import { PricingService } from '../pricing';
import { sampleReport } from './sample-report';

/**
 * The structured report — spec 2026-09-21 §5. Drafting, and answering by
 * submitting it, through the real services against a real database.
 */

let h: Harness;
let db: DatabaseService;
let bus: EventBus;
let cases: CasesService;
let reports: ReportsService;
let directory: DirectoryService;
let pdf: ReportPdfService;
let downloads: string[] = [];

const config = { CASES_ANSWER_WINDOW_HOURS: 72, CASES_QUOTE_TTL_MINUTES: 30 } as AppConfig;

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'reports-test',
});
const asDoctor = <T>(id: string, fn: () => Promise<T>) =>
  runWithContext(ctx(id, 'tunisia_doctor'), fn);
const asLab = <T>(id: string, fn: () => Promise<T>) => runWithContext(ctx(id, 'libya_doctor'), fn);

const report = sampleReport;

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 10 } as AppConfig);
  bus = new EventBus();
  const ledger = new LedgerService(db);
  cases = new CasesService(db, bus, config, ledger, new PricingService(db));
  reports = new ReportsService(db, bus, ledger);
  directory = new DirectoryService(db);
  pdf = new ReportPdfService(reports, cases, bus, db);
  bus.subscribe('CaseReportDownloaded', async (e) => {
    downloads.push(e.caseId);
  });
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  downloads = [];
  await truncateAll(h.owner);
});

/** A priced, paid and accepted case with a real doctor on it. */
async function acceptedCase(): Promise<{
  lab: string;
  doctor: string;
  patient: string;
  caseId: string;
}> {
  const { doctorId: lab } = await createPractice(h.owner, 'libya_doctor');
  const patient = await createPatient(h.owner, lab);
  await seedAcceptingDoctors(h.owner, { specialty: 'radiology', count: 4 });
  const doctor = await seedDoctor(h.owner, { specialty: 'radiology', accepting: true });
  const item = await asLab(lab, () => cases.submit({ patientId: patient, specialty: 'radiology' }));
  await asLab(lab, () => cases.quote(item.id, doctor));
  await asLab(lab, () => cases.markPaid(item.id));
  await asDoctor(doctor, () => cases.accept(item.id));
  return { lab, doctor, patient, caseId: item.id };
}

async function statusOf(caseId: string): Promise<string | undefined> {
  const r = await h.owner.query<{ status: string }>('SELECT status FROM cases_cases WHERE id = $1', [
    caseId,
  ]);
  return r.rows[0]?.status;
}

describe('drafting a report', () => {
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
});

describe('answering with the report', () => {
  it('submitting answers the case, stores the report and pays the doctor once', async () => {
    const { lab, doctor, caseId } = await acceptedCase();
    await asDoctor(doctor, () => reports.submitWithAnswer(caseId, report));
    expect(await statusOf(caseId)).toBe('answered');

    const seen = await asLab(lab, () => reports.get(caseId));
    expect(seen?.status).toBe('submitted');
    expect(seen?.content).toEqual(report);

    // A double click: the second submit finds no accepted case.
    await expect(asDoctor(doctor, () => reports.submitWithAnswer(caseId, report))).rejects.toThrow(
      /not found/i,
    );
    const payouts = await h.owner.query(
      "SELECT 1 FROM billing_ledger_entries WHERE case_id = $1 AND kind = 'doctor_payout'",
      [caseId],
    );
    expect(payouts.rowCount).toBe(1);
  });

  it('a submitted report can no longer be edited', async () => {
    const { doctor, caseId } = await acceptedCase();
    await asDoctor(doctor, () => reports.submitWithAnswer(caseId, report));
    await expect(
      asDoctor(doctor, () => reports.saveDraft(caseId, { indication: 'changed' })),
    ).rejects.toThrow(/not found/i);
  });

  it('the answer route refuses a missing or incomplete report', async () => {
    const { doctor, caseId } = await acceptedCase();
    const controller = new CasesController(cases, directory, reports, pdf);
    await expect(asDoctor(doctor, () => controller.answer(caseId, {}))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      asDoctor(doctor, () => controller.answer(caseId, { report: { ...report, impression: [] } })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await statusOf(caseId)).toBe('accepted');
  });
});

describe('the report as a PDF', () => {
  it('the clinic downloads a submitted report, and the download is published', async () => {
    const { lab, doctor, caseId } = await acceptedCase();
    await asDoctor(doctor, () => reports.submitWithAnswer(caseId, report));
    const got = await asLab(lab, () => pdf.forCase(caseId));
    expect(got.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(got.filename).toMatch(/^MIR-.*-report\.pdf$/);
    expect(downloads).toEqual([caseId]);
  });

  it('a draft is not downloadable', async () => {
    const { lab, doctor, caseId } = await acceptedCase();
    await asDoctor(doctor, () => reports.saveDraft(caseId, { indication: 'x' }));
    await expect(asLab(lab, () => pdf.forCase(caseId))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('both sides print the same age and sex', async () => {
    const { lab, doctor, patient, caseId } = await acceptedCase();
    // The doctor's brief needs consent; the lab's fallback reads the record.
    await grantConsent(h.owner, patient, doctor, lab);
    await asDoctor(doctor, () => reports.submitWithAnswer(caseId, report));
    const asClinic = await asLab(lab, () => pdf.pdfInputFor(caseId));
    const asReader = await asDoctor(doctor, () => pdf.pdfInputFor(caseId));
    expect(asClinic.patientAgeYears).not.toBeNull();
    expect(asClinic.patientSex).not.toBeNull();
    expect([asClinic.patientAgeYears, asClinic.patientSex]).toEqual([
      asReader.patientAgeYears,
      asReader.patientSex,
    ]);
  });
});
