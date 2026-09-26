import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { consultReportSchema, type ConsultReport } from '@mir/contracts';
import { DatabaseService } from '../../../shared/db/database.service';
import { EventBus } from '../../../shared/events/event-bus';
import { REPORT_LABELS } from './report-pdf-labels';
import { actorFields, CasesService } from './cases.service';
import { ReportsService } from './reports.service';

/**
 * Embedded, not a PDF base-14 font: those cover WinAnsi only, and a doctor's
 * "≥ 5 mm" would print as garbage. Resolved lazily, like the migrator's path:
 * `__filename` exists in the CommonJS build but not under the test runner.
 */
function font(file: string): string {
  const from = typeof __filename !== 'undefined' ? __filename : join(process.cwd(), 'index.js');
  return createRequire(from).resolve(`dejavu-fonts-ttf/ttf/${file}`);
}

/** What the PDF prints. There is deliberately NO name field. */
export interface ReportPdfInput {
  caseRef: string;
  patientAgeYears: number | null;
  patientSex: string | null;
  doctorName: string;
  submittedAt: Date;
  report: ConsultReport;
}

export interface ReportDocument {
  title: string;
  header: [string, string][];
  sections: { heading: string; lines: string[] }[];
}

/** The PDF's content as data — every word the renderer will print. */
export function buildReportDocument(input: ReportPdfInput): ReportDocument {
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
      lines: [
        r.technique.sequences.map((s) => L.sequences[s]).join(', ') || '—',
        L.contrast(r.technique.contrast),
      ],
    },
    {
      heading: L.comparison,
      lines: [r.comparison.kind === 'none' ? L.none : L.prior(r.comparison.date, r.comparison.note)],
    },
    {
      heading: L.findings,
      lines: r.findings.map(
        (f) =>
          `${f.region} — ${f.status === 'normal' ? L.normal : L.abnormal}${f.description ? `: ${f.description}` : ''}`,
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
      : [
          {
            heading: L.prescription,
            lines: r.prescription.map((p) => `${p.drug} · ${p.dose} · ${p.frequency} · ${p.duration}`),
          },
        ]),
  ];
  return { title: L.title, header, sections };
}

export function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const model = buildReportDocument(input);
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `${model.title} ${input.caseRef}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('body', font('DejaVuSans.ttf'));
    doc.registerFont('bold', font('DejaVuSans-Bold.ttf'));
    doc.font('bold').fontSize(16).text(model.title);
    doc.moveDown(0.5).fontSize(10);
    for (const [k, v] of model.header) {
      doc.font('bold').text(`${k}: `, { continued: true }).font('body').text(v);
    }
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
    private readonly db: DatabaseService,
  ) {}

  /** 404 unless the caller may read a SUBMITTED report on this case. */
  async pdfInputFor(caseId: string): Promise<ReportPdfInput & { patientId: string }> {
    const stored = await this.reports.get(caseId);
    if (stored === null || stored.status !== 'submitted' || stored.submittedAt === null) {
      throw new NotFoundException('Report not found');
    }
    const c = await this.cases.getCase(caseId);
    // The doctor's side gets age and sex from `cases_patient_brief`, which has
    // no row for the lab: the lab reads the patient record it already may.
    // Same formula as the brief (0028) so both sides print the same age.
    const demo =
      c.patientAgeYears === null && c.patientSex === null
        ? await this.db.tx(
            async (tx) =>
              (
                await tx.query<{ age_years: number | null; sex: string | null }>(
                  `SELECT LEAST(90, EXTRACT(YEAR FROM age(a.created_at::date, p.date_of_birth))::int) AS age_years,
                          p.sex
                     FROM cases_cases a JOIN patients_patients p ON p.id = a.patient_id
                    WHERE a.id = $1`,
                  [caseId],
                )
              ).rows[0],
          )
        : undefined;
    return {
      patientId: c.patientId,
      caseRef: c.caseRef,
      patientAgeYears: c.patientAgeYears ?? demo?.age_years ?? null,
      patientSex: c.patientSex ?? demo?.sex ?? null,
      doctorName: c.doctorName ?? '—',
      submittedAt: stored.submittedAt,
      report: consultReportSchema.parse(stored.content),
    };
  }

  async forCase(caseId: string): Promise<{ filename: string; bytes: Buffer }> {
    const { patientId, ...input } = await this.pdfInputFor(caseId);
    const bytes = await renderReportPdf(input);
    await this.bus.publish({
      type: 'CaseReportDownloaded',
      caseId,
      patientId,
      format: 'pdf',
      ...actorFields(),
    });
    return { filename: `${input.caseRef}-report.pdf`, bytes };
  }
}
