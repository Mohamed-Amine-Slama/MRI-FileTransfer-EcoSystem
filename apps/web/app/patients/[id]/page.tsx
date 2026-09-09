'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { api, type DirectoryEntry, type Patient, type Study } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { useSession } from '../../../lib/session/session';
import { RoleGate } from '../../../components/RoleGate';
import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Main,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from '../../../components/ui';

/**
 * Patient record — studies, and the actions a referring doctor takes.
 *
 * A 404 here means "not available to you" and never "does not exist". §6
 * requires the two to be indistinguishable, so the copy must not tell the
 * doctor a record is absent when RLS simply filtered it — otherwise the page
 * becomes a way to test whether a given patient id exists.
 */
export default function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const { id } = use(params);
  return (
    <RoleGate allow={['libya_doctor', 'tunisia_doctor']}>
      <PatientDetail patientId={id} />
    </RoleGate>
  );
}

function PatientDetail({ patientId }: { patientId: string }): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { role } = useSession();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [consents, setConsents] = useState<
    { consentId: string; grantedTo: string; grantedAt: string }[] | null
  >(null);
  const [doctors, setDoctors] = useState<DirectoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const record = await api.patients.getById(patientId);
      setPatient(record);
    } catch (err) {
      setError(err instanceof ApiError && err.isNotFound ? t.notAuthorised : t.genericError);
      return;
    }
    try {
      const { studies: rows } = await api.imaging.studiesForPatient(patientId);
      setStudies(rows);
    } catch {
      // The record loaded; imaging did not. Show the record rather than
      // failing the whole page — the doctor can still act on it.
      setStudies([]);
    }
  }, [patientId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The referring doctor may read the patient's active consents (they explain
  // the terms and need to know whether the transfer is covered before booking).
  // Fetched only for that role: the API would refuse a Tunisian doctor anyway,
  // and a guaranteed denial row would be audit-log noise, not signal.
  useEffect(() => {
    if (role !== 'libya_doctor') return;
    void (async () => {
      try {
        const [{ consents: rows }, { doctors: docs }] = await Promise.all([
          api.consent.forPatient(patientId),
          api.cases.directory(),
        ]);
        setConsents(rows);
        setDoctors(docs);
      } catch {
        setConsents([]); // The record page still works without this card's data.
      }
    })();
  }, [role, patientId]);

  const issueClaim = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await api.patients.issueClaimToken(patientId);
      // Deliberately does NOT display the code: it goes to the patient's phone,
      // so that holding this session is not holding the claim credential.
      setNotice(t.patientClaimSent);
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && patient === null) {
    return (
      <Main>
        <Alert tone="danger" testId="patient-error">
          {error}
        </Alert>
      </Main>
    );
  }

  if (patient === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  return (
    <Main wide data-testid="patient-detail" data-patient-id={patient.id}>
      <Breadcrumbs
        items={[{ label: t.patientsTitle, href: '/patients' }, { label: patient.fullName }]}
      />
      <PageHeader
        title={patient.fullName}
        description={`${patient.phoneE164} · ${patient.dateOfBirth}`}
        actions={
          <>
            <Button data-testid="issue-claim" disabled={busy} onClick={() => void issueClaim()}>
              {t.patientIssueClaim}
            </Button>
            <Link
              href={`/cases/new?patientId=${patient.id}`}
              className={buttonVariants()}
              data-testid="submit-for-patient"
            >
              {t.casesNew}
            </Link>
          </>
        }
      />

      {notice !== null && (
        <Alert tone="success" testId="claim-sent">
          {notice}
        </Alert>
      )}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <Card title={t.patientStudies}>
        {/*
          Says what to DO, not merely that something is held. A notice that
          reports a state without an action generates a support call.
        */}
        {studies.some((s) => s.status === 'quarantined') && (
          <Alert tone="warning" testId="studies-quarantined-notice">
            {t.studyQuarantinedBody}
          </Alert>
        )}
        {studies.length === 0 ? (
          <EmptyState testId="studies-empty">{t.none}</EmptyState>
        ) : (
          <Table data-testid="study-list">
            <TableHeader>
              <TableRow>
                <TableHead>{t.colDescription}</TableHead>
                <TableHead>{t.colDate}</TableHead>
                <TableHead>{t.colImages}</TableHead>
                <TableHead>
                  <span className="sr-only">{t.colActions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studies.map((s) => (
                <TableRow key={s.id} data-testid="study-row">
                  <TableCell className="font-medium">{s.description ?? s.studyInstanceUid}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.studyDate === null ? '—' : formatDate(s.studyDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.instanceCount}</TableCell>
                  <TableCell className="text-end">
                    {/*
                      A held study offers no view action. Rendering the link
                      anyway would send the lab to a viewer that refuses them,
                      which reads as a broken page rather than as a deliberate
                      hold — and the hold is the thing they need to act on.
                    */}
                    {s.status === 'quarantined' ? (
                      <Badge tone="warning" data-testid="study-quarantined">
                        {t.studyHeldLabel}
                      </Badge>
                    ) : (
                      <Link
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        href={`/viewer/${s.studyInstanceUid}`}
                      >
                        {t.inboxViewStudies}
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {role === 'libya_doctor' && consents !== null && (
        <Card title={t.consentActiveTitle}>
          {consents.length === 0 ? (
            <EmptyState testId="patient-consents-empty">{t.consentNoneActive}</EmptyState>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="patient-consents">
              {consents.map((c) => (
                <li key={c.consentId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="flex-1 text-sm font-medium">
                    {doctors.find((d) => d.id === c.grantedTo)?.displayName ?? c.grantedTo}
                  </span>
                  <span className="text-sm text-muted-foreground">{t.consentGrantedOn}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatDate(c.grantedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Main>
  );
}
