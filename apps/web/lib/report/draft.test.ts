import { describe, expect, it } from 'vitest';
import { completeReport, emptyReport, missingFields } from './draft';

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

  it('names what is missing', () => {
    expect(missingFields(emptyReport('', 'en'))).toEqual([
      'indication',
      'examType',
      'region',
      'impression',
    ]);
    expect(
      missingFields({
        ...emptyReport('x', 'en'),
        examType: 'other',
        recommendations: { presets: ['follow_up_imaging'], followUpMonths: null, other: '' },
      }),
    ).toEqual(['examOther', 'region', 'impression', 'followUp']);
  });
});
