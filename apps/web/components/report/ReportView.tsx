'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import type { ConsultReport } from '@mir/contracts';
import { useT } from '../../lib/i18n/provider';
import { downloadReportPdf } from '../../lib/report/download';
import { Button } from '../ui';

function Block({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {lines.map((l, i) => (
        <p key={i} className="whitespace-pre-line text-sm">
          {l}
        </p>
      ))}
    </section>
  );
}

/** A submitted report, read-only in the reader's UI language, and its PDF. */
export function ReportView({
  report: r,
  caseId,
  caseRef,
}: {
  report: ConsultReport;
  caseId: string;
  caseRef: string;
}): React.JSX.Element {
  const t = useT();
  const [failed, setFailed] = useState(false);

  const download = async (): Promise<void> => {
    setFailed(false);
    try {
      await downloadReportPdf(caseId, caseRef);
    } catch {
      setFailed(true);
    }
  };

  const followUp = (months: number | null) =>
    months === null ? '' : ` — ${t.reportFollowUpMonths}: ${months}`;

  return (
    <div className="space-y-4" data-testid="report-view">
      <Block title={t.reportIndication} lines={[r.indication]} />
      <Block
        title={t.reportExamType}
        lines={[r.examType === 'other' ? (r.examTypeOther ?? '') : t[`reportExam_${r.examType}`]]}
      />
      <Block
        title={t.reportTechnique}
        lines={[
          r.technique.sequences.map((s) => t[`reportSeq_${s}`]).join(', ') || '—',
          ...(r.technique.contrast ? [t.reportContrast] : []),
        ]}
      />
      <Block
        title={t.reportComparison}
        lines={[
          r.comparison.kind === 'none'
            ? t.reportComparisonNone
            : [`${t.reportComparisonPrior} ${r.comparison.date}`, r.comparison.note]
                .filter(Boolean)
                .join(' — '),
        ]}
      />
      <Block
        title={t.reportFindings}
        lines={r.findings.map(
          (f) =>
            `${f.region} — ${f.status === 'normal' ? t.reportNormal : t.reportAbnormal}${f.description ? `: ${f.description}` : ''}`,
        )}
      />
      <Block title={t.reportImpression} lines={r.impression.map((l, i) => `${i + 1}. ${l}`)} />
      <Block
        title={t.reportRecommendations}
        lines={[
          ...r.recommendations.presets.map(
            (p) =>
              t[`reportPreset_${p}`] +
              (p === 'follow_up_imaging' ? followUp(r.recommendations.followUpMonths) : ''),
          ),
          ...(r.recommendations.other.trim() ? [r.recommendations.other] : []),
        ]}
      />
      <Block
        title={t.reportPrescription}
        lines={r.prescription.map((p) => `${p.drug} · ${p.dose} · ${p.frequency} · ${p.duration}`)}
      />
      <Block title={t.reportUrgency} lines={[t[`reportUrgency_${r.urgency}`]]} />

      <Button onClick={() => void download()} data-testid="report-download-pdf">
        <Download aria-hidden="true" />
        {t.reportDownloadPdf}
      </Button>
      {failed && (
        <p role="alert" className="text-sm font-medium text-danger">
          {t.reportDownloadFailed}
        </p>
      )}
    </div>
  );
}
