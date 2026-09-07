import type { Locale } from '@mir/contracts';

/**
 * Notification templates — BUILD_SPEC PHASE 12.
 *
 * THE RULE: "notification content must NEVER include clinical details or
 * images. 'Your appointment is confirmed' — not the diagnosis, modality, or
 * body part."
 *
 * Why this matters more than it looks: an SMS is delivered to a lock screen,
 * passes through at least one carrier in each country, and is stored in
 * plaintext on the handset. A message reading "Your chest CT is ready" tells
 * everyone who glances at the phone that this person had a chest CT. In a
 * small community that is a disclosure, and neither the patient nor the
 * platform can retract it.
 *
 * HOW IT IS ENFORCED, RATHER THAN INTENDED:
 * every template declares exactly which variables it accepts, and the type of
 * `TemplateVariables` contains ONLY non-clinical fields. There is no
 * `modality`, no `bodyPart`, no `studyDescription`, no `diagnosis` — so a
 * template cannot reference one, because the name does not exist. The test
 * suite additionally scans every rendered template for clinical vocabulary.
 */

/**
 * The complete set of values a notification may contain.
 *
 * Adding a field here is the decision point. If a future field would tell a
 * reader something about the patient's health, it does not belong in a
 * notification at all — put it behind the login instead.
 */
export interface TemplateVariables {
  /** Given name only. Never the full name plus DOB, which together identify. */
  firstName?: string;
  /** Non-clinical, non-identifying: a claim or OTP code. */
  code?: string;
  /**
   * The case's pseudonymous handle, e.g. MIR-2026-0417.
   *
   * The ONLY case-level fact these messages may carry. It identifies the case
   * to both sides without naming the patient to anyone who intercepts the SMS.
   */
  caseRef?: string;
  /** Doctor's display name — a professional, not a patient. */
  doctorName?: string;
  /** Deep link into the app. Carries no query parameters with data. */
  link?: string;
  /** Whole number of files, for upload progress. Not a study description. */
  fileCount?: string;
}

export type TemplateId =
  | 'patient_claim'
  | 'consent_request'
  | 'upload_complete'
  | 'case_accepted'
  | 'case_declined'
  | 'case_answered'
  | 'consent_revoked'
  | 'payment_failed';

export type Channel = 'sms' | 'email';

interface TemplateDefinition {
  /** Variables this template is allowed to use. */
  allowed: (keyof TemplateVariables)[];
  sms: Record<Locale, string>;
  emailSubject: Record<Locale, string>;
  emailBody: Record<Locale, string>;
}

/**
 * Templates are data, not code.
 *
 * `{{name}}` placeholders only — no expressions, no function calls. A template
 * language that can evaluate arbitrary expressions can reach a clinical field
 * through some object it was handed, and then the guarantee above depends on
 * what every caller passes rather than on what the template says.
 */
export const TEMPLATES: Record<TemplateId, TemplateDefinition> = {
  patient_claim: {
    allowed: ['code', 'link'],
    sms: {
      ar: 'رمز التحقق الخاص بك هو {{code}}. صالح لمدة 30 دقيقة.',
      fr: 'Votre code de vérification est {{code}}. Valable 30 minutes.',
    },
    emailSubject: {
      ar: 'رمز التحقق',
      fr: 'Code de vérification',
    },
    emailBody: {
      ar: 'رمز التحقق الخاص بك هو {{code}}. صالح لمدة 30 دقيقة.',
      fr: 'Votre code de vérification est {{code}}. Valable 30 minutes.',
    },
  },

  consent_request: {
    allowed: ['firstName', 'link'],
    sms: {
      // Deliberately does not say what is being transferred.
      ar: 'لديك طلب موافقة بانتظارك. افتح التطبيق: {{link}}',
      fr: 'Une demande de consentement vous attend. Ouvrez l’application : {{link}}',
    },
    emailSubject: { ar: 'طلب موافقة', fr: 'Demande de consentement' },
    emailBody: {
      ar: 'مرحبًا {{firstName}}، لديك طلب موافقة بانتظارك. افتح التطبيق: {{link}}',
      fr: 'Bonjour {{firstName}}, une demande de consentement vous attend : {{link}}',
    },
  },

  upload_complete: {
    // fileCount is a number of files. NOT the modality, NOT the body part.
    allowed: ['fileCount', 'link'],
    sms: {
      ar: 'اكتمل رفع {{fileCount}} ملف. افتح التطبيق: {{link}}',
      fr: 'Téléversement de {{fileCount}} fichier(s) terminé : {{link}}',
    },
    emailSubject: { ar: 'اكتمل الرفع', fr: 'Téléversement terminé' },
    emailBody: {
      ar: 'اكتمل رفع {{fileCount}} ملف. افتح التطبيق: {{link}}',
      fr: 'Téléversement de {{fileCount}} fichier(s) terminé : {{link}}',
    },
  },

  /**
   * The doctor took the case. For the lab this is the start of the clock, and
   * the case reference is all it needs to find the right one.
   */
  case_accepted: {
    allowed: ['caseRef', 'doctorName', 'link'],
    sms: {
      ar: 'تم قبول الحالة {{caseRef}} من قبل {{doctorName}}.',
      fr: 'Le dossier {{caseRef}} a été accepté par {{doctorName}}.',
    },
    emailSubject: { ar: 'تم قبول الحالة', fr: 'Dossier accepté' },
    emailBody: {
      ar: 'تم قبول الحالة {{caseRef}} من قبل {{doctorName}}. {{link}}',
      fr: 'Le dossier {{caseRef}} a été accepté par {{doctorName}}. {{link}}',
    },
  },

  /**
   * The doctor refused after reading the summary.
   *
   * The message says to choose another doctor, because that is the action, and
   * it deliberately does not say why: a refusal reason is free text a clinician
   * typed, which is exactly the kind of field the note at the top of this file
   * keeps out of notifications. It is in the app, behind a login.
   */
  case_declined: {
    allowed: ['caseRef', 'link'],
    sms: {
      ar: 'لم تُقبل الحالة {{caseRef}}. اختر طبيبًا آخر: {{link}}',
      fr: "Le dossier {{caseRef}} n'a pas été accepté. Choisissez un autre médecin : {{link}}",
    },
    emailSubject: { ar: 'لم تُقبل الحالة', fr: 'Dossier non accepté' },
    emailBody: {
      ar: 'لم تُقبل الحالة {{caseRef}}. اختر طبيبًا آخر: {{link}}',
      fr: "Le dossier {{caseRef}} n'a pas été accepté. Choisissez un autre médecin : {{link}}",
    },
  },

  /**
   * The diagnosis is ready.
   *
   * Note what is absent: the diagnosis. This message exists to get the lab to
   * open the app, never to deliver a finding over SMS.
   */
  case_answered: {
    allowed: ['caseRef', 'link'],
    sms: {
      ar: 'الرد على الحالة {{caseRef}} جاهز: {{link}}',
      fr: 'La réponse au dossier {{caseRef}} est prête : {{link}}',
    },
    emailSubject: { ar: 'الرد جاهز', fr: 'Réponse disponible' },
    emailBody: {
      ar: 'الرد على الحالة {{caseRef}} جاهز: {{link}}',
      fr: 'La réponse au dossier {{caseRef}} est prête : {{link}}',
    },
  },

  consent_revoked: {
    allowed: ['link'],
    sms: {
      ar: 'تم إلغاء موافقتك. لمزيد من التفاصيل افتح التطبيق: {{link}}',
      fr: 'Votre consentement a été révoqué. Détails : {{link}}',
    },
    emailSubject: { ar: 'إلغاء الموافقة', fr: 'Consentement révoqué' },
    emailBody: {
      ar: 'تم إلغاء موافقتك. لمزيد من التفاصيل افتح التطبيق: {{link}}',
      fr: 'Votre consentement a été révoqué. Détails : {{link}}',
    },
  },

  payment_failed: {
    allowed: ['link'],
    sms: {
      ar: 'تعذّر إتمام الدفع ولم يتم حجز الموعد. حاول مرة أخرى: {{link}}',
      fr: 'Le paiement a échoué, le rendez-vous n’a pas été réservé : {{link}}',
    },
    emailSubject: { ar: 'فشل الدفع', fr: 'Échec du paiement' },
    emailBody: {
      ar: 'تعذّر إتمام الدفع ولم يتم حجز الموعد. حاول مرة أخرى: {{link}}',
      fr: 'Le paiement a échoué, le rendez-vous n’a pas été réservé : {{link}}',
    },
  },
};

export class DisallowedTemplateVariableError extends Error {
  constructor(templateId: string, variable: string) {
    super(
      `Template "${templateId}" does not accept the variable "${variable}". ` +
        'Notification content must never include clinical details (BUILD_SPEC PHASE 12).',
    );
    this.name = 'DisallowedTemplateVariableError';
  }
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Render a template.
 *
 * Rejects any variable the template did not declare, rather than ignoring it.
 * Silently dropping an unexpected `diagnosis` would let a caller believe it
 * had been sent — and would let the next refactor start using it.
 */
export function render(
  templateId: TemplateId,
  channel: Channel,
  locale: Locale,
  variables: TemplateVariables,
): { subject?: string; body: string } {
  const template = TEMPLATES[templateId];

  for (const key of Object.keys(variables)) {
    if (!template.allowed.includes(key as keyof TemplateVariables)) {
      throw new DisallowedTemplateVariableError(templateId, key);
    }
  }

  const fill = (text: string): string =>
    text.replace(PLACEHOLDER, (_match, name: string) => {
      const value = variables[name as keyof TemplateVariables];
      // An unfilled placeholder becomes empty rather than leaking the literal
      // `{{doctorName}}` into a patient's SMS.
      return value ?? '';
    });

  if (channel === 'sms') {
    return { body: fill(template.sms[locale]) };
  }
  return {
    subject: fill(template.emailSubject[locale]),
    body: fill(template.emailBody[locale]),
  };
}

/** Every placeholder used by any template, for the completeness test. */
export function placeholdersUsedBy(templateId: TemplateId): Set<string> {
  const t = TEMPLATES[templateId];
  const found = new Set<string>();
  for (const text of [
    ...Object.values(t.sms),
    ...Object.values(t.emailSubject),
    ...Object.values(t.emailBody),
  ]) {
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1];
      if (name !== undefined) found.add(name);
    }
  }
  return found;
}
