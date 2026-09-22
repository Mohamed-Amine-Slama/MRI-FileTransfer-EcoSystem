'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CONSULT_SPECIALTIES, canSubmitCases, type ConsultSpecialty } from '@mir/contracts';
import { api, type Patient, type Study } from '../../../lib/api/endpoints';
import { getCorridor, SOURCE_ROLES } from '../../../lib/corridor/registry';
import { useCurrentProvider } from '../../../lib/provider/current-provider';
import { useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { CorridorFields, validateFields } from '../../../components/case/CorridorFields';
import { specialtyLabel } from '../../../components/case/labels';
import {
  Alert,
  Button,
  Field,
  Main,
  PageHeader,
  Select,
  Spinner,
  buttonVariants,
} from '../../../components/ui';

/**
 * Case submission — brief §5.2.
 *
 * The intake questions are not written here. They are rendered from the
 * corridor's `intakeFields` (§4.3), so this file contains no field that assumes
 * a country and adding a corridor does not mean editing this screen. What the
 * screen adds is what the API needs to route and price a case: the specialty,
 * and which of the patient's uploaded studies travel with it.
 *
 * SUBMITTING GOES STRAIGHT TO CHOOSING A DOCTOR (spec 2026-09-21 §9). A case
 * with no doctor is a request nobody can answer, and a success screen with a
 * reference on it left the clinic to find the next step themselves — which, on
 * the previous version of this screen, did not exist at all.
 *
 * DRAFTS ARE LOCAL AND DELIBERATELY NARROW (§5.2 P1). A draft holds the
 * structured intake answers, the specialty and a patient id — never an uploaded
 * file, and never anything read out of a medical image. §4.4 forbids medical
 * files lingering in browser storage past the session, so the draft carries the
 * form, not the imaging.
 */
const DRAFT_KEY = 'mir.case-draft';

export default function NewCasePage(): React.JSX.Element {
  return (
    <RoleGate allow={SOURCE_ROLES}>
      <NewCaseForm />
    </RoleGate>
  );
}

function isSpecialty(value: unknown): value is ConsultSpecialty {
  return typeof value === 'string' && (CONSULT_SPECIALTIES as readonly string[]).includes(value);
}

function NewCaseForm(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const { provider, loading: providerLoading } = useCurrentProvider();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [patientId, setPatientId] = useState('');
  const [specialty, setSpecialty] = useState<ConsultSpecialty>('radiology');
  const [studies, setStudies] = useState<Study[]>([]);
  const [studyIds, setStudyIds] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const corridor = provider === null ? null : getCorridor(provider.corridorId);

  useEffect(() => {
    void api.patients
      .list()
      .then(({ patients: rows }) => setPatients(rows))
      .catch(() => setPatients([]));
  }, []);

  // The patient's studies, all ticked by default: sending the imaging is the
  // point of a case, and unticking is the exception.
  useEffect(() => {
    if (patientId === '') {
      setStudies([]);
      setStudyIds([]);
      return;
    }
    let cancelled = false;
    void api.imaging
      .studiesForPatient(patientId)
      .then(({ studies: rows }) => {
        if (cancelled) return;
        const usable = rows.filter((s) => s.status === 'ready' || s.status === 'processing');
        setStudies(usable);
        setStudyIds(usable.map((s) => s.id));
      })
      .catch(() => {
        if (cancelled) return;
        setStudies([]);
        setStudyIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Restore a draft once, on mount.
  useEffect(() => {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (raw === null) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      const draft = parsed as { patientId?: unknown; intake?: unknown; specialty?: unknown };
      if (typeof draft.patientId === 'string') setPatientId(draft.patientId);
      if (isSpecialty(draft.specialty)) setSpecialty(draft.specialty);
      if (typeof draft.intake === 'object' && draft.intake !== null) {
        setValues(draft.intake as Record<string, string>);
      }
      setNotice(t.caseNewDraftRestored);
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [t]);

  const setField = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const toggleStudy = (id: string): void => {
    setStudyIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const saveDraft = (): void => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ patientId, specialty, intake: values, savedAt: new Date().toISOString() }),
    );
    setNotice(t.caseNewDraftSaved);
  };

  const discardDraft = (): void => {
    window.localStorage.removeItem(DRAFT_KEY);
    setPatientId('');
    setSpecialty('radiology');
    setValues({});
    setNotice(null);
  };

  const submit = async (): Promise<void> => {
    if (corridor === null) return;
    const found = validateFields(corridor.intakeFields, values, t.required);
    if (patientId === '') found['patient'] = t.required;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setError(t.caseNewValidationFailed);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // The corridor's intake answers the API has no column for travel in
      // `notes`, labelled, so the receiving doctor still reads them.
      const notes = [
        values['urgency'] ? `urgency: ${values['urgency']}` : null,
        values['preferredDate'] ? `preferred: ${values['preferredDate']}` : null,
      ]
        .filter((v): v is string => v !== null)
        .join(' · ');
      const created = await api.cases.submit({
        patientId,
        specialty,
        studyIds,
        ...(values['referralReason'] ? { reason: values['referralReason'] } : {}),
        ...(notes === '' ? {} : { notes }),
      });
      window.localStorage.removeItem(DRAFT_KEY);
      router.push(`/cases/${created.id}/pick-doctor`);
    } catch {
      setError(t.genericError);
      setSubmitting(false);
    }
  };

  if (providerLoading || patients === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  if (provider === null || !canSubmitCases(provider)) {
    return (
      <Main>
        <PageHeader title={t.caseNewTitle} />
        <Alert tone="warning" testId="not-approved">
          {t.caseNewNotApproved}
        </Alert>
        <Link href="/verification" className={buttonVariants({ variant: 'outline' })}>
          {t.verificationTitle}
        </Link>
      </Main>
    );
  }

  return (
    <Main>
      <PageHeader title={t.caseNewTitle} description={t.caseNewDescription} />

      {notice !== null && <Alert tone="info">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={`${t.caseNewPatient} *`} error={errors['patient'] ?? null}>
          <Select
            value={patientId}
            data-testid="field-patient"
            onChange={(e) => setPatientId(e.target.value)}
          >
            <option value="">{t.caseNewSelectPatient}</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.fullName}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={`${t.caseNewSpecialty} *`}>
          <Select
            value={specialty}
            data-testid="field-specialty"
            onChange={(e) => {
              if (isSpecialty(e.target.value)) setSpecialty(e.target.value);
            }}
          >
            {CONSULT_SPECIALTIES.map((value) => (
              <option key={value} value={value}>
                {specialtyLabel(t, value)}
              </option>
            ))}
          </Select>
        </Field>

        {patientId !== '' && (
          <fieldset className="space-y-2 rounded-md border p-4" data-testid="field-studies">
            <legend className="px-1 text-sm font-medium">{t.caseNewStudies}</legend>
            {studies.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>{t.caseNewNoStudies}</span>
                <Link
                  href="/upload"
                  className="font-semibold text-primary hover:underline"
                  data-testid="upload-first"
                >
                  {t.caseNewUploadFirst}
                </Link>
              </div>
            ) : (
              studies.map((study) => (
                <label key={study.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid="field-study"
                    className="size-4 accent-primary"
                    checked={studyIds.includes(study.id)}
                    onChange={() => toggleStudy(study.id)}
                  />
                  <span>
                    {study.description ?? study.modality}
                    {study.studyDate !== null && (
                      <span className="text-muted-foreground tabular-nums"> · {study.studyDate}</span>
                    )}
                  </span>
                </label>
              ))
            )}
          </fieldset>
        )}

        {corridor !== null && (
          <CorridorFields
            fields={corridor.intakeFields}
            values={values}
            errors={errors}
            onChange={setField}
          />
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" disabled={submitting} data-testid="submit-case">
            {submitting ? t.loading : t.caseNewSubmit}
          </Button>
          <Button type="button" variant="default" onClick={saveDraft}>
            {t.caseNewSaveDraft}
          </Button>
          <Button type="button" variant="ghost" onClick={discardDraft}>
            {t.caseNewDiscardDraft}
          </Button>
        </div>
      </form>
    </Main>
  );
}
