import type {
  ExamType,
  RecommendationPreset,
  ReportLanguage,
  Sequence,
  Urgency,
} from '@mir/contracts';

/**
 * The PDF's words, in the report's language — never the reader's UI language:
 * a report written in French is a French document whoever downloads it.
 */
export interface ReportLabels {
  title: string;
  caseRef: string;
  patient: string;
  patientValue: (age: number | null, sex: string | null) => string;
  doctor: string;
  submitted: string;
  urgency: string;
  indication: string;
  examType: string;
  technique: string;
  contrast: (given: boolean) => string;
  comparison: string;
  none: string;
  prior: (date: string, note: string) => string;
  findings: string;
  normal: string;
  abnormal: string;
  impression: string;
  recommendations: string;
  followUp: (months: number) => string;
  prescription: string;
  examTypes: Record<Exclude<ExamType, 'other'>, string>;
  sequences: Record<Sequence, string>;
  presets: Record<RecommendationPreset, string>;
  urgencies: Record<Urgency, string>;
}

const SEQUENCES: Record<Sequence, string> = {
  t1: 'T1',
  t2: 'T2',
  flair: 'FLAIR',
  dwi_adc: 'DWI/ADC',
  swi_t2star: 'SWI/T2*',
  stir: 'STIR',
  pd: 'PD',
  t1_post_contrast: 'T1 + Gd',
};

const withNote = (head: string, note: string) => (note.trim() ? `${head} — ${note}` : head);

export const REPORT_LABELS: Record<ReportLanguage, ReportLabels> = {
  en: {
    title: 'Radiology report',
    caseRef: 'Case',
    patient: 'Patient',
    patientValue: (age, sex) => `${age === null ? '—' : `${age} y`} · ${sex ?? '—'}`,
    doctor: 'Reporting doctor',
    submitted: 'Submitted',
    urgency: 'Urgency',
    indication: 'Clinical indication',
    examType: 'Examination',
    technique: 'Technique',
    contrast: (given) => `Contrast: ${given ? 'yes' : 'no'}`,
    comparison: 'Comparison',
    none: 'None',
    prior: (date, note) => withNote(`Prior study of ${date}`, note),
    findings: 'Findings',
    normal: 'Normal',
    abnormal: 'Abnormal',
    impression: 'Impression',
    recommendations: 'Recommendations',
    followUp: (n) => `Follow-up imaging in ${n} months`,
    prescription: 'Prescription',
    examTypes: {
      mri_brain: 'MRI brain',
      mri_spine_cervical: 'MRI cervical spine',
      mri_spine_thoracic: 'MRI thoracic spine',
      mri_spine_lumbar: 'MRI lumbar spine',
      mri_knee: 'MRI knee',
      mri_shoulder: 'MRI shoulder',
      mri_abdomen: 'MRI abdomen',
      mri_pelvis: 'MRI pelvis',
    },
    sequences: SEQUENCES,
    presets: {
      clinical_correlation: 'Clinical correlation',
      follow_up_imaging: 'Follow-up imaging',
      specialist_referral: 'Specialist referral',
      biopsy: 'Biopsy',
      further_imaging: 'Further imaging',
    },
    urgencies: { routine: 'Routine', urgent: 'Urgent', critical: 'Critical' },
  },
  fr: {
    title: 'Compte rendu radiologique',
    caseRef: 'Dossier',
    patient: 'Patient',
    patientValue: (age, sex) => `${age === null ? '—' : `${age} ans`} · ${sex ?? '—'}`,
    doctor: 'Médecin rédacteur',
    submitted: 'Transmis le',
    urgency: 'Urgence',
    indication: 'Indication clinique',
    examType: 'Examen',
    technique: 'Technique',
    contrast: (given) => `Injection : ${given ? 'oui' : 'non'}`,
    comparison: 'Comparaison',
    none: 'Aucune',
    prior: (date, note) => withNote(`Examen antérieur du ${date}`, note),
    findings: 'Résultats',
    normal: 'Normal',
    abnormal: 'Anormal',
    impression: 'Conclusion',
    recommendations: 'Recommandations',
    followUp: (n) => `Imagerie de contrôle dans ${n} mois`,
    prescription: 'Ordonnance',
    examTypes: {
      mri_brain: 'IRM cérébrale',
      mri_spine_cervical: 'IRM du rachis cervical',
      mri_spine_thoracic: 'IRM du rachis dorsal',
      mri_spine_lumbar: 'IRM du rachis lombaire',
      mri_knee: 'IRM du genou',
      mri_shoulder: "IRM de l'épaule",
      mri_abdomen: 'IRM abdominale',
      mri_pelvis: 'IRM pelvienne',
    },
    sequences: SEQUENCES,
    presets: {
      clinical_correlation: 'Corrélation clinique',
      follow_up_imaging: 'Imagerie de contrôle',
      specialist_referral: 'Avis spécialisé',
      biopsy: 'Biopsie',
      further_imaging: 'Imagerie complémentaire',
    },
    urgencies: { routine: 'Non urgent', urgent: 'Urgent', critical: 'Critique' },
  },
};
