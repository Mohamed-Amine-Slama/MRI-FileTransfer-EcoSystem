'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  EXAM_TYPES,
  RECOMMENDATION_PRESETS,
  SEQUENCES,
  URGENCIES,
  type ConsultReportDraft,
} from '@mir/contracts';
import { api } from '../../lib/api/endpoints';
import { useT } from '../../lib/i18n/provider';
import { completeReport, missingFields } from '../../lib/report/draft';
import { Alert, Button, Field, Input, Segmented, Select, Textarea } from '../ui';

type Finding = NonNullable<ConsultReportDraft['findings']>[number];
type Medication = NonNullable<ConsultReportDraft['prescription']>[number];
type SaveState = { kind: 'idle' | 'saving' | 'failed' } | { kind: 'saved'; at: Date };

const AUTOSAVE_MS = 2000;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Check({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      {label}
    </label>
  );
}

/** Replace one row of a list, immutably. */
const at = <T,>(list: T[], i: number, next: T): T[] => list.map((x, j) => (j === i ? next : x));

/**
 * The structured consult report — spec 2026-09-21 §5. Autosaves the draft two
 * seconds after the last change; Submit answers the case with it.
 */
export function ReportForm({
  caseId,
  initial,
  onSubmitted,
}: {
  caseId: string;
  caseRef: string;
  initial: ConsultReportDraft;
  onSubmitted: () => void | Promise<void>;
}): React.JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState<ConsultReportDraft>(initial);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const submitted = useRef(false);

  useEffect(() => {
    if (draft === initial) return; // the first render saves nothing
    const timer = setTimeout(() => {
      if (submitted.current) return;
      setSave({ kind: 'saving' });
      api.cases
        .saveReport(caseId, draft)
        .then(() => setSave({ kind: 'saved', at: new Date() }))
        .catch(() => setSave({ kind: 'failed' }));
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [caseId, draft, initial]);

  const set = (patch: Partial<ConsultReportDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const technique = draft.technique ?? { sequences: [], contrast: false };
  const comparison = draft.comparison ?? { kind: 'none' as const };
  const findings = draft.findings ?? [];
  const impression = draft.impression ?? [];
  const recs = draft.recommendations ?? { presets: [], followUpMonths: null, other: '' };
  const prescription = draft.prescription ?? [];

  const complete = completeReport(draft);
  const missing = missingFields(draft);

  const submit = async (): Promise<void> => {
    if (complete === null) return;
    setSubmitting(true);
    setSubmitError(false);
    submitted.current = true;
    try {
      await api.cases.answer(caseId, complete);
      await onSubmitted();
    } catch {
      submitted.current = false;
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" data-testid="report-form" onSubmit={(e) => e.preventDefault()}>
      <Section title={t.reportIndication}>
        <Textarea
          aria-label={t.reportIndication}
          maxLength={2000}
          value={draft.indication ?? ''}
          onChange={(e) => set({ indication: e.target.value })}
          data-testid="report-indication"
        />
      </Section>

      <Section title={t.reportExamType}>
        <Select
          aria-label={t.reportExamType}
          value={draft.examType ?? ''}
          onChange={(e) =>
            set({ examType: e.target.value === '' ? undefined : (e.target.value as typeof draft.examType) })
          }
          data-testid="report-exam-type"
        >
          <option value="">{t.reportExamChoose}</option>
          {EXAM_TYPES.map((e) => (
            <option key={e} value={e}>
              {t[`reportExam_${e}`]}
            </option>
          ))}
        </Select>
        {draft.examType === 'other' && (
          <Field label={t.reportExamOther}>
            <Input
              maxLength={120}
              value={draft.examTypeOther ?? ''}
              onChange={(e) => set({ examTypeOther: e.target.value })}
              data-testid="report-exam-other"
            />
          </Field>
        )}
      </Section>

      <Section title={t.reportTechnique}>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SEQUENCES.map((s) => (
            <Check
              key={s}
              label={t[`reportSeq_${s}`]}
              checked={technique.sequences.includes(s)}
              onChange={(on) =>
                set({
                  technique: {
                    ...technique,
                    sequences: on
                      ? SEQUENCES.filter((x) => x === s || technique.sequences.includes(x))
                      : technique.sequences.filter((x) => x !== s),
                  },
                })
              }
            />
          ))}
        </div>
        <Check
          label={t.reportContrast}
          checked={technique.contrast}
          onChange={(contrast) => set({ technique: { ...technique, contrast } })}
        />
      </Section>

      <Section title={t.reportComparison}>
        <Segmented
          legend={t.reportComparison}
          name="report-comparison"
          value={comparison.kind}
          options={[
            { value: 'none', label: t.reportComparisonNone },
            { value: 'prior', label: t.reportComparisonPrior },
          ]}
          onChange={(kind) => set({ comparison: { ...comparison, kind } })}
          testId="report-comparison"
        />
        {comparison.kind === 'prior' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.reportPriorDate}>
              <Input
                type="date"
                value={comparison.date ?? ''}
                onChange={(e) => set({ comparison: { ...comparison, date: e.target.value } })}
              />
            </Field>
            <Field label={t.reportPriorNote}>
              <Input
                maxLength={500}
                value={comparison.note ?? ''}
                onChange={(e) => set({ comparison: { ...comparison, note: e.target.value } })}
              />
            </Field>
          </div>
        )}
      </Section>

      <Section title={t.reportFindings}>
        {findings.map((f, i) => {
          const put = (next: Partial<Finding>) => set({ findings: at(findings, i, { ...f, ...next }) });
          return (
            <div key={i} className="space-y-2 rounded-md border p-3" data-testid="report-finding">
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t.reportRegion}>
                  <Input
                    maxLength={120}
                    value={f.region}
                    onChange={(e) => put({ region: e.target.value })}
                    data-testid="report-finding-region"
                  />
                </Field>
                <Segmented
                  legend={t.reportRegion}
                  name={`report-finding-${i}`}
                  value={f.status}
                  options={[
                    { value: 'normal', label: t.reportNormal },
                    { value: 'abnormal', label: t.reportAbnormal },
                  ]}
                  onChange={(status) => put({ status })}
                />
                {findings.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t.reportRemove}
                    onClick={() => set({ findings: findings.filter((_, j) => j !== i) })}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
              <Textarea
                aria-label={t.reportDescription}
                placeholder={t.reportDescription}
                maxLength={2000}
                value={f.description}
                onChange={(e) => put({ description: e.target.value })}
              />
            </div>
          );
        })}
        {findings.length < 30 && (
          <Button
            size="sm"
            onClick={() =>
              set({ findings: [...findings, { region: '', status: 'normal', description: '' }] })
            }
            data-testid="report-add-finding"
          >
            <Plus aria-hidden="true" />
            {t.reportAddFinding}
          </Button>
        )}
      </Section>

      <Section title={t.reportImpression}>
        <ol className="space-y-2">
          {impression.map((line, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="pt-2 text-sm text-muted-foreground">{i + 1}.</span>
              <Textarea
                aria-label={`${t.reportImpression} ${i + 1}`}
                rows={2}
                maxLength={1000}
                value={line}
                onChange={(e) => set({ impression: at(impression, i, e.target.value) })}
                data-testid="report-impression-line"
              />
              {impression.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t.reportRemove}
                  onClick={() => set({ impression: impression.filter((_, j) => j !== i) })}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ol>
        {impression.length < 10 && (
          <Button size="sm" onClick={() => set({ impression: [...impression, ''] })}>
            <Plus aria-hidden="true" />
            {t.reportAddLine}
          </Button>
        )}
      </Section>

      <Section title={t.reportRecommendations}>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {RECOMMENDATION_PRESETS.map((p) => (
            <Check
              key={p}
              label={t[`reportPreset_${p}`]}
              checked={recs.presets.includes(p)}
              testId={`report-preset-${p}`}
              onChange={(on) =>
                set({
                  recommendations: {
                    ...recs,
                    presets: on
                      ? RECOMMENDATION_PRESETS.filter((x) => x === p || recs.presets.includes(x))
                      : recs.presets.filter((x) => x !== p),
                    followUpMonths:
                      p === 'follow_up_imaging' && !on ? null : recs.followUpMonths,
                  },
                })
              }
            />
          ))}
        </div>
        {recs.presets.includes('follow_up_imaging') && (
          <Field label={t.reportFollowUpMonths}>
            <Input
              type="number"
              min={1}
              max={60}
              className="max-w-32"
              value={recs.followUpMonths ?? ''}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                set({
                  recommendations: {
                    ...recs,
                    followUpMonths: Number.isInteger(n) && n >= 1 && n <= 60 ? n : null,
                  },
                });
              }}
              data-testid="report-follow-up-months"
            />
          </Field>
        )}
        <Field label={t.reportOther}>
          <Input
            maxLength={500}
            value={recs.other}
            onChange={(e) => set({ recommendations: { ...recs, other: e.target.value } })}
          />
        </Field>
      </Section>

      <Section title={t.reportPrescription}>
        {prescription.map((m, i) => {
          const put = (next: Partial<Medication>) =>
            set({ prescription: at(prescription, i, { ...m, ...next }) });
          return (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[repeat(4,1fr)_auto]">
              <Input
                aria-label={t.reportDrug}
                placeholder={t.reportDrug}
                maxLength={120}
                value={m.drug}
                onChange={(e) => put({ drug: e.target.value })}
              />
              <Input
                aria-label={t.reportDose}
                placeholder={t.reportDose}
                maxLength={60}
                value={m.dose}
                onChange={(e) => put({ dose: e.target.value })}
              />
              <Input
                aria-label={t.reportFrequency}
                placeholder={t.reportFrequency}
                maxLength={60}
                value={m.frequency}
                onChange={(e) => put({ frequency: e.target.value })}
              />
              <Input
                aria-label={t.reportDuration}
                placeholder={t.reportDuration}
                maxLength={60}
                value={m.duration}
                onChange={(e) => put({ duration: e.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={t.reportRemove}
                onClick={() => set({ prescription: prescription.filter((_, j) => j !== i) })}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          );
        })}
        {prescription.length < 10 && (
          <Button
            size="sm"
            onClick={() =>
              set({
                prescription: [...prescription, { drug: '', dose: '', frequency: '', duration: '' }],
              })
            }
          >
            <Plus aria-hidden="true" />
            {t.reportAddMedication}
          </Button>
        )}
      </Section>

      <Section title={t.reportUrgency}>
        <Segmented
          legend={t.reportUrgency}
          name="report-urgency"
          value={draft.urgency ?? 'routine'}
          options={URGENCIES.map((u) => ({ value: u, label: t[`reportUrgency_${u}`] }))}
          onChange={(urgency) => set({ urgency })}
          testId="report-urgency"
        />
      </Section>

      <Section title={t.reportLanguage}>
        <Segmented
          legend={t.reportLanguage}
          name="report-language"
          value={draft.language ?? 'en'}
          options={[
            { value: 'en', label: t.reportLang_en },
            { value: 'fr', label: t.reportLang_fr },
          ]}
          onChange={(language) => set({ language })}
          testId="report-language"
        />
      </Section>

      <div className="space-y-3 border-t pt-4">
        <p className="text-sm text-muted-foreground" data-testid="report-save-state" aria-live="polite">
          {save.kind === 'saving' && t.reportSaving}
          {save.kind === 'saved' &&
            t.reportSavedAt.replace(
              '{time}',
              save.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
            )}
          {save.kind === 'failed' && t.reportSaveFailed}
        </p>
        {missing.length > 0 && (
          <p className="text-sm" data-testid="report-missing">
            {t.reportMissing} {missing.map((m) => t[`reportMissing_${m}`]).join(' · ')}
          </p>
        )}
        {submitError && <Alert tone="danger">{t.reportSubmitFailed}</Alert>}
        <Button
          variant="primary"
          disabled={complete === null || submitting}
          onClick={() => void submit()}
          data-testid="report-submit"
        >
          {t.reportSubmit}
        </Button>
      </div>
    </form>
  );
}
