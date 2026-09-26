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
      {
        ...valid,
        recommendations: { presets: ['follow_up_imaging'], followUpMonths: null, other: '' },
      },
    ],
    ['an Arabic report language', { ...valid, language: 'ar' }],
    [
      'an over-long finding',
      { ...valid, findings: [{ region: 'x', status: 'abnormal', description: 'a'.repeat(2001) }] },
    ],
    [
      'a prior comparison with a bad date',
      { ...valid, comparison: { kind: 'prior', date: '12/03/2026', note: '' } },
    ],
  ])('refuses %s', (_label, report) => {
    expect(consultReportSchema.safeParse(report).success).toBe(false);
  });

  it('keeps its caps on a draft but not its minimums', () => {
    expect(consultReportDraftSchema.safeParse({ findings: [], impression: [] }).success).toBe(true);
    expect(consultReportDraftSchema.safeParse({ indication: 'a'.repeat(2001) }).success).toBe(false);
  });
});
