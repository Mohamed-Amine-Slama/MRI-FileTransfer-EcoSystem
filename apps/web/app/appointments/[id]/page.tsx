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
 * Appointment detail.
 *
 * This screen used to be DECISION D2 in one place: the patient authorised a
 * card here and was charged only when the Tunisian doctor accepted. Migration
 * 0023 removed the card along with the patient account, so the checkout card,
 * the amount, and the authorise button are gone — there is no payer on this
 * screen to show a price to.
 *
 * What survives is the D3 gate: imaging stays hidden until the receiving doctor
 * accepts, unless triage is on. That was never about money; it just happened to
 * be worded as if it were.
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const record = await api.scheduling.getAppointment(appointmentId);
      setAppointment(record);
    } catch (err) {
      setError(err instanceof ApiError && err.isNotFound ? t.notAuthorised : t.genericError);
      return;
    }
    try {
      const { studies: rows } = await api.imaging.studiesForAppointment(appointmentId);
      setStudies(rows);
    } catch {
      // D3: imaging is not visible until the referral is accepted. An empty
      // list here is a legitimate state, not a failure — the locked notice on
      // the studies card explains it.
      setStudies([]);
    }
  }, [appointmentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  // Locked until the receiving doctor answers. `declined` locks it too: a
  // refused referral is not a reason to keep showing the imaging.
  const imagingLocked = appointment.status === 'pending' || appointment.status === 'declined';

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

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <Card title={t.patientStudies}>
        {imagingLocked ? (
          <Alert tone="warning" testId="imaging-locked">
            {t.inboxLockedUntilAccepted}
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
