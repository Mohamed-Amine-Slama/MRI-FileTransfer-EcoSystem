'use client';

import Link from '../../components/ui/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FolderUp } from 'lucide-react';
import { validateMedicalFile, type FileRejectionKey } from '@mir/contracts';
import { api, type Patient } from '../../lib/api/endpoints';
import { createUploadApi } from '../../lib/upload/api-client';
import { queueDb, type QueuedFile } from '../../lib/upload/queue-db';
import { Uploader } from '../../lib/upload/uploader';
import { useT } from '../../lib/i18n/provider';
import type { Dictionary } from '../../lib/i18n/dictionary';
import { RoleGate } from '../../components/RoleGate';
import { fileRejectionLabel } from '../../components/case/labels';
import {
  Alert,
  Badge,
  Card,
  Dropzone,
  Field,
  Main,
  PageHeader,
  Progress,
  Select,
} from '../../components/ui';

/**
 * Upload screen — BUILD_SPEC P7.3.
 *
 * Two behaviours matter more than anything visual here:
 *
 * 1. It resumes on mount, with no user action. A doctor whose browser crashed
 *    mid-study reopens the tab and the transfer continues. Requiring them to
 *    click "resume" would mean uploads silently stall whenever nobody notices.
 *
 * 2. Progress and retry state are per file and visible. On a link that drops
 *    every few minutes, "it's working" is not enough information — the doctor
 *    needs to see which files are still owed before they leave the clinic.
 */
export default function UploadPage() {
  return (
    <RoleGate allow={['libya_doctor']}>
      {/* useSearchParams needs a Suspense boundary to keep the route static. */}
      <Suspense fallback={null}>
        <UploadScreen />
      </Suspense>
    </RoleGate>
  );
}

/** One file the picker returned but the upload will not accept (§5.2 P0). */
interface RejectedFile {
  name: string;
  reason: FileRejectionKey;
}

function UploadScreen() {
  const t = useT();
  // §5.4 P0: files belong to a case. The reference arrives on the query string
  // from the case screen, and is shown so the doctor can see which case they
  // are uploading into before selecting a gigabyte of imaging.
  const caseRef = useSearchParams().get('case');
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [resumeCount, setResumeCount] = useState<number | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState('');
  const uploaderRef = useRef<Uploader | null>(null);

  const getUploader = useCallback((): Uploader => {
    uploaderRef.current ??= new Uploader(createUploadApi(), {
      onProgress: (next) => setFiles([...next]),
    });
    return uploaderRef.current;
  }, []);

  // Resume on mount. This is the P7.3 gate: survives reload, crash, restart.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outstanding = await queueDb.outstanding();
      if (cancelled) return;
      setFiles(await queueDb.all());
      if (outstanding.length > 0) {
        setResumeCount(outstanding.length);
        void getUploader().start();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getUploader]);

  // The doctor's own patients, for attaching the study to a record. RLS
  // decides which rows come back; this list is never filtered client-side.
  useEffect(() => {
    void (async () => {
      try {
        const { patients: rows } = await api.patients.list();
        setPatients(rows);
      } catch {
        // Upload is still usable if this fails — the selector simply stays
        // empty and the doctor is blocked from starting, which is better than
        // uploading a study against a guessed patient id.
        setPatients([]);
      }
    })();
  }, []);

  /**
   * Takes the files, wherever they came from — the folder picker or a drop.
   *
   * Deliberately signature-agnostic about the source: the validation, session
   * creation, and queueing below are the P7.3 gate and must be identical on
   * both paths. A drop handler that did its own thing is how one route ends up
   * skipping `validateMedicalFile`.
   */
  const acceptFiles = useCallback(
    async (selected: File[]) => {
      if (selected.length === 0 || patientId === '') return;

      // §5.2 P0: validated BEFORE a session is created and before a single
      // byte leaves the clinic. A folder from a CD routinely contains
      // AUTORUN.INF and a bundled viewer .exe alongside the study; those are
      // dropped here rather than uploaded and refused one at a time.
      const problems: RejectedFile[] = [];
      const accepted: File[] = [];
      for (const file of selected) {
        const reason = validateMedicalFile({ name: file.name, sizeBytes: file.size });
        if (reason === null) {
          accepted.push(file);
        } else {
          problems.push({ name: file.name, reason });
        }
      }
      setRejected(problems);
      if (accepted.length === 0) return;

      const uploadApi = createUploadApi();
      const { sessionId } = await uploadApi.createSession(patientId, accepted.length);
      const uploader = getUploader();
      await uploader.enqueueFiles(sessionId, patientId, accepted);
      void uploader.start();
    },
    [getUploader, patientId],
  );

  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const doneBytes = files.reduce((sum, f) => sum + f.uploadedBytes, 0);
  const pct = totalBytes === 0 ? 0 : Math.round((doneBytes / totalBytes) * 100);
  const doneCount = files.filter((f) => f.status === 'done').length;

  return (
    <Main wide>
      <PageHeader
        title={t.uploadTitle}
        description={t.uploadHint}
        actions={
          caseRef === null ? undefined : (
            <Link
              href={`/cases/${caseRef}`}
              className="text-sm font-semibold text-primary hover:underline"
            >
              {t.uploadForCase} <bdi className="font-mono">{caseRef}</bdi>
            </Link>
          )
        }
      />

      {rejected.length > 0 && (
        <Alert tone="warning" testId="rejected-files">
          <p className="font-semibold">{t.fileRejectedTitle}</p>
          <ul className="mt-1 space-y-0.5">
            {rejected.map((file) => (
              <li key={file.name} className="break-all">
                <bdi className="font-mono text-xs">{file.name}</bdi> —{' '}
                {fileRejectionLabel(t, file.reason)}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {resumeCount !== null && (
        <div data-testid="resume-notice">
          <Alert tone="warning">
            {t.uploadResumeNotice} ({resumeCount})
          </Alert>
        </div>
      )}

      <Card>
        {/* The study is attached to a patient record at the moment the session
            is created, not afterwards. An upload with no owner would be imaging
            that RLS cannot scope to anyone — unreachable, and undeletable by the
            application role. */}
        <div className="max-w-md">
          <Field label={t.colPatient}>
            <Select
              data-testid="patient-select"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
            >
              <option value="">—</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} · {p.phoneE164}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/*
          `directory` keeps the folder picker: a study is a FOLDER of many
          files, often extensionless, often under DICOM/ or IMAGES/ on a clinic
          CD, and no drop handler can offer that. Dragging is the addition, not
          the replacement — a doctor on a tablet has nothing to drag, and a
          keyboard user cannot drag at all.
        */}
        <div className={patientId === '' ? 'opacity-55' : undefined}>
          <span className="mb-1.5 block text-sm font-semibold">{t.uploadFolderLabel}</span>
          <Dropzone
            testId="folder-input"
            label={t.uploadFolderLabel}
            hint={t.uploadDropHint}
            directory
            disabled={patientId === ''}
            onFiles={(selected) => void acceptFiles(selected)}
          >
            <FolderUp className="size-8 text-muted-foreground" aria-hidden="true" />
          </Dropzone>
        </div>
      </Card>

      {files.length > 0 && (
        <Card title={t.uploadFiles}>
          <div data-testid="overall-progress" data-percent={pct} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <strong className="text-lg tabular-nums">{pct}%</strong>
              <span className="tabular-nums text-muted-foreground">
                {doneCount} / {files.length}
              </span>
            </div>
            <Progress value={pct} aria-label={t.uploadFiles} />
          </div>

          <ul data-testid="file-list" className="divide-y rounded-md border">
            {files.map((f) => (
              <li
                key={f.id}
                data-testid="file-row"
                data-status={f.status}
                data-name={f.relativePath}
                className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 break-all font-medium">{f.relativePath}</span>
                <StatusBadge file={f} t={t} />
                {f.lastError !== null && (
                  <span data-testid="file-error" className="text-xs text-warning">
                    {f.lastError}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Main>
  );
}

function StatusBadge({ file, t }: { file: QueuedFile; t: Dictionary }): React.JSX.Element {
  switch (file.status) {
    case 'done':
      return <Badge tone="success">{t.uploadStatusDone}</Badge>;
    case 'uploading':
      return (
        <Badge tone="info">
          {Math.round((file.uploadedBytes / Math.max(1, file.sizeBytes)) * 100)}%
        </Badge>
      );
    case 'verifying':
      return <Badge tone="info">{t.uploadStatusVerifying}</Badge>;
    case 'retrying':
      return (
        <Badge tone="warning">
          {t.uploadStatusRetrying} ({file.attempts})
        </Badge>
      );
    case 'needs_reselect':
      return <Badge tone="warning">{t.uploadStatusReselect}</Badge>;
    case 'failed':
      return <Badge tone="danger">{t.uploadStatusFailed}</Badge>;
    default:
      return <Badge>{t.uploadStatusWaiting}</Badge>;
  }
}
