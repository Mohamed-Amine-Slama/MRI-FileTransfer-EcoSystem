import type { ConsultReport } from '@mir/contracts';

/** A complete, valid report for tests — answering a case now requires one. */
export const sampleReport: ConsultReport = {
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
