'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type Appointment } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { AppointmentStatusBadge } from '../../components/AppointmentStatusBadge';
import {
  Alert,
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
} from '../../components/ui';

/** Appointment list for patients and referring doctors. */
export default function AppointmentsPage(): React.JSX.Element {
  return (
    <RoleGate allow={['libya_doctor']}>
      <AppointmentsList />
    </RoleGate>
  );
}

function AppointmentsList(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { appointments: rows } = await api.scheduling.listAppointments();
        setAppointments(rows);
      } catch {
        setError(t.genericError);
        setAppointments([]);
      }
    })();
  }, [t]);

  return (
    <Main wide>
      <PageHeader
        title={t.appointmentsTitle}
        actions={
          <Link href="/appointments/new" className={buttonVariants()} data-testid="new-appointment">
            {t.bookingTitle}
          </Link>
        }
      />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {appointments === null ? (
        <Spinner label={t.loading} />
      ) : appointments.length === 0 ? (
        <EmptyState testId="appointments-empty">{t.appointmentsEmpty}</EmptyState>
      ) : (
        <Table data-testid="appointment-list">
          <TableHeader>
            <TableRow>
              <TableHead>{t.colDate}</TableHead>
              <TableHead>{t.bookingDoctor}</TableHead>
              <TableHead>{t.appointmentStatus}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointments.map((a) => (
              <TableRow key={a.id} data-testid="appointment-row" data-status={a.status}>
                <TableCell className="font-medium">
                  <Link
                    href={`/appointments/${a.id}`}
                    className="rounded-sm hover:text-primary hover:underline"
                  >
                    {formatDate(a.startsAt)}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{a.doctorName ?? a.doctorId}</TableCell>
                <TableCell>
                  <AppointmentStatusBadge status={a.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Main>
  );
}
