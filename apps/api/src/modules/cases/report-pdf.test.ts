import { describe, expect, it } from 'vitest';
import { buildReportDocument, renderReportPdf, type ReportPdfInput } from './internal/report-pdf';
import { sampleReport } from './sample-report';

/** The report PDF — spec 2026-09-21 §5. Pure: no database. */

const input: ReportPdfInput = {
  caseRef: 'MIR-2026-0042',
  patientAgeYears: 47,
  patientSex: 'F',
  doctorName: 'Dr Karim Receiving',
  submittedAt: new Date('2026-09-24T10:00:00Z'),
  report: { ...sampleReport, language: 'fr' },
};

describe('the report PDF', () => {
  it('carries the case reference, age, sex, doctor and time', () => {
    const all = JSON.stringify(buildReportDocument(input));
    for (const s of ['MIR-2026-0042', '47', 'Dr Karim Receiving', '2026-09-24']) {
      expect(all).toContain(s);
    }
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
});
