'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { api, type Appointment, type Study } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { AppointmentStatusBadge } from '../../../components/AppointmentStatusBadge';
import { isLiveAppointment } from '../../../lib/scheduling/status';
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Main,
  PageHeader,
  Spinner,
  buttonVariants,
} from '../../../components/ui';

/**
 * Appointment detail, including payment authorisation.
 *
 * DECISION D2 in one screen: the patient AUTHORISES here and is charged only
 * when the Tunisian doctor accepts. The copy has to make that explicit, because
 * "pay now" for a consultation that may never be accepted is precisely the
 * trust problem the manual-capture flow exists to solve — and a patient who
 * believes they have already been charged will not book again.
 */
export default function AppointmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const { id } = use(params);
  return (
    <RoleGate allow={['libya_doctor', 'tunisia_doctor']}>
      <AppointmentDetail appointmentId={id} />
    </RoleGate>
  );
}

function AppointmentDetail({ appointmentId }: { appointmentId: string }): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [payment, setPayment] = useState<{
    status: string;
    amountMinor: number | null;
    currency: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const record = await api.scheduling.getAppointment(appointmentId);
      setAppointment(record);
    } catch (err) {
      setError(err instanceof ApiError && err.isNotFound ? t.notAuthorised : t.genericError);
      return;
    }
    // The fee is resolved server-side; the client never proposes an amount.
    try {
      setPayment(await api.billing.status(appointmentId));
    } catch {
      setPayment(null);
    }
    try {
      const { studies: rows } = await api.imaging.studiesForAppointment(appointmentId);
      setStudies(rows);
    } catch {
      // D3: imaging is not visible before payment. An empty list here is a
      // legitimate state, not a failure — the notice below explains it.
      setStudies([]);
    }
  }, [appointmentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const authorise = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.billing.authorise(appointmentId);
      setNotice(t.checkoutAuthorised);
      await load();
    } catch {
      setError(t.checkoutFailed);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.scheduling.cancel(appointmentId);
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && appointment === null) {
    return (
      <Main>
        <Alert tone="danger" testId="appointment-error">
          {error}
        </Alert>
      </Main>
    );
  }

  if (appointment === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const awaitingPayment = appointment.status === 'pending_payment';
  const imagingLocked = appointment.status === 'pending_payment';

  return (
    <Main data-testid="appointment-detail" data-status={appointment.status}>
      <Breadcrumbs
        items={[
          { label: t.appointmentsTitle, href: '/appointments' },
          { label: formatDate(appointment.startsAt) },
        ]}
      />
      <PageHeader
        title={formatDate(appointment.startsAt)}
        description={appointment.doctorName ?? appointment.doctorId}
        actions={<AppointmentStatusBadge status={appointment.status} />}
      />

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      {awaitingPayment && (
        <Card title={t.checkoutTitle} className="border-info/40">
          <Alert tone="info" testId="capture-explanation">
            {t.checkoutDescription}
          </Alert>
          {payment?.amountMinor != null && (
            <p data-testid="payment-amount" className="flex items-baseline gap-2">
              <span className="text-sm text-muted-foreground">{t.checkoutAmount}:</span>{' '}
              {/* Minor units throughout, converted only for display. */}
              <span className="text-2xl font-bold tabular-nums">
                {(payment.amountMinor / 100).toFixed(2)}
              </span>{' '}
              <span className="text-sm font-medium text-muted-foreground">
                {payment.currency ?? ''}
              </span>
            </p>
          )}
          <Button
            variant="primary"
            className="h-11 w-full sm:w-auto"
            data-testid="authorise-payment"
            disabled={busy}
            onClick={() => void authorise()}
          >
            {t.checkoutPay}
          </Button>
        </Card>
      )}

      <Card title={t.patientStudies}>
        {imagingLocked ? (
          <Alert tone="warning" testId="imaging-locked">
            {t.inboxLockedUntilPayment}
          </Alert>
        ) : studies.length === 0 ? (
          <EmptyState>{t.none}</EmptyState>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="appointment-studies">
            {studies.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="flex-1 text-sm font-medium">
                  {s.description ?? s.studyInstanceUid}
                </span>
                <Link
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  href={`/viewer/${s.studyInstanceUid}`}
                >
                  {t.inboxViewStudies}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isLiveAppointment(appointment.status) && (
        <div>
          <Button
            variant="danger"
            data-testid="cancel-appointment"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {t.cancel}
          </Button>
        </div>
      )}
    </Main>
  );
}
