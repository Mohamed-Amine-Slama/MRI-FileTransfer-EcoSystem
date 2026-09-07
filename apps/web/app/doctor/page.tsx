'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Appointment } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { AppointmentStatusBadge } from '../../components/AppointmentStatusBadge';
import {
  Alert,
  Button,
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
} from '../../components/ui';

/**
 * Receiving doctor's inbox — the Tunisian side of the referral.
 *
 * ACCEPTING IS WHAT TAKES THE MONEY (D2: capture on acceptance), so the button
 * says so. A doctor who thinks "accept" merely acknowledges the referral will
 * accept everything to triage it, and the patient is charged for consultations
 * that were never going to happen.
 *
 * Declining is not destructive: the authorisation is released and the patient
 * can book elsewhere. That asymmetry is why decline is a plain button and
 * accept is the primary one.
 */
export default function DoctorInboxPage(): React.JSX.Element {
  return (
    <RoleGate allow={['tunisia_doctor']}>
      <Inbox />
    </RoleGate>
  );
}

function Inbox(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { appointments: rows } = await api.scheduling.listAppointments();
      setAppointments(rows);
    } catch {
      setError(t.genericError);
      setAppointments([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'accept' | 'decline'): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      if (action === 'accept') {
        await api.scheduling.accept(id);
        setNotice(t.inboxAccepted);
      } else {
        await api.scheduling.decline(id);
        setNotice(null);
      }
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Main wide>
      <PageHeader title={t.inboxTitle} />

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      {appointments === null ? (
        <Spinner label={t.loading} />
      ) : appointments.length === 0 ? (
        <EmptyState testId="inbox-empty">{t.inboxEmpty}</EmptyState>
      ) : (
        <Table data-testid="inbox-list">
          <TableHeader>
            <TableRow>
              <TableHead>{t.colPatient}</TableHead>
              <TableHead>{t.colDate}</TableHead>
              <TableHead>{t.appointmentStatus}</TableHead>
              <TableHead>
                <span className="sr-only">{t.colActions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointments.map((a) => (
              <TableRow key={a.id} data-testid="inbox-row" data-status={a.status}>
                <TableCell className="font-medium">
                  <Link
                    href={`/appointments/${a.id}`}
                    className="rounded-sm hover:text-primary hover:underline"
                  >
                    {a.patientName ?? a.patientId}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(a.startsAt)}</TableCell>
                <TableCell>
                  <AppointmentStatusBadge status={a.status} />
                </TableCell>
                <TableCell>
                  {a.status === 'pending' && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {/* Accepting confirms the referral and unlocks the
                          imaging, so it is the one primary action; declining
                          frees the slot and stays a plain button. The asymmetry
                          is deliberate. It used to be justified by accepting
                          CAPTURING the patient's card (D2); the shape is right
                          for the same reason without the money. */}
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid="accept-referral"
                        disabled={busyId === a.id}
                        onClick={() => void act(a.id, 'accept')}
                      >
                        {t.inboxAccept}
                      </Button>
                      <Button
                        size="sm"
                        data-testid="decline-referral"
                        disabled={busyId === a.id}
                        onClick={() => void act(a.id, 'decline')}
                      >
                        {t.inboxDecline}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Main>
  );
}
