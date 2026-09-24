import { consultReportSchema, type ConsultReport, type ConsultReportDraft } from '@mir/contracts';

/** A new report: the referral reason as its indication, one empty row each. */
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

export type MissingField =
  | 'indication'
  | 'examType'
  | 'examOther'
  | 'region'
  | 'impression'
  | 'followUp';

const blank = (s: string | null | undefined) => (s ?? '').trim() === '';

/** What the doctor still has to fill before Submit enables — in form order. */
export function missingFields(d: ConsultReportDraft): MissingField[] {
  const out: MissingField[] = [];
  if (blank(d.indication)) out.push('indication');
  if (d.examType === undefined) out.push('examType');
  if (d.examType === 'other' && blank(d.examTypeOther)) out.push('examOther');
  if ((d.findings ?? []).length === 0 || d.findings?.some((f) => blank(f.region))) out.push('region');
  if ((d.impression ?? []).length === 0 || d.impression?.some(blank)) out.push('impression');
  if (
    d.recommendations?.presets.includes('follow_up_imaging') === true &&
    d.recommendations.followUpMonths === null
  ) {
    out.push('followUp');
  }
  return out;
}
