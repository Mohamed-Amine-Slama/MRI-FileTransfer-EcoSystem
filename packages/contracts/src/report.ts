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
export type ExamType = (typeof EXAM_TYPES)[number];

export const SEQUENCES = [
  't1',
  't2',
  'flair',
  'dwi_adc',
  'swi_t2star',
  'stir',
  'pd',
  't1_post_contrast',
] as const;
export type Sequence = (typeof SEQUENCES)[number];

export const RECOMMENDATION_PRESETS = [
  'clinical_correlation',
  'follow_up_imaging',
  'specialist_referral',
  'biopsy',
  'further_imaging',
] as const;
export type RecommendationPreset = (typeof RECOMMENDATION_PRESETS)[number];

export const URGENCIES = ['routine', 'urgent', 'critical'] as const;
export type Urgency = (typeof URGENCIES)[number];

/** English or French only: the two languages a Tunisian report is written in. */
export const REPORT_LANGUAGES = ['en', 'fr'] as const;
export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

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
    if (
      r.recommendations.presets.includes('follow_up_imaging') &&
      r.recommendations.followUpMonths === null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['recommendations', 'followUpMonths'],
        message: 'Give the interval',
      });
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
      .array(
        z.object({
          region: text(120),
          status: z.enum(['normal', 'abnormal']),
          description: text(2000),
        }),
      )
      .max(30),
    impression: z.array(text(1000)).max(10),
    recommendations: recommendationsSchema,
    prescription: z
      .array(
        z.object({ drug: text(120), dose: text(60), frequency: text(60), duration: text(60) }),
      )
      .max(10),
    urgency: z.enum(URGENCIES),
    language: z.enum(REPORT_LANGUAGES),
  })
  .partial();
export type ConsultReportDraft = z.infer<typeof consultReportDraftSchema>;
