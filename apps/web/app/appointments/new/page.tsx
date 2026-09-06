'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { api, type Doctor, type Slot, type Study } from '../../../lib/api/endpoints';
import { useDateFormat, useLocale, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Main,
  PageHeader,
  Spinner,
  Steps,
} from '../../../components/ui';

/**
 * Booking flow — BUILD_SPEC P10.2, DECISION D2.
 *
 * THE CONFLICT PATH IS THE DESIGN.
 * P10.2's gate is that of fifty simultaneous bookings for one slot, exactly one
 * wins and the rest get a clean 409. That 409 is not an error state to
 * apologise for — it is the expected outcome for every patient but one, and it
 * has to leave them one tap from the next slot. So a conflict re-fetches
 * availability and keeps them on the step, rather than dumping them at the
 * start of the flow or showing a dead end.
 *
 * Steps are separated because each one narrows what the next can offer: a slot
 * only means something for a chosen doctor, and studies can only be attached
 * once there is an appointment to attach them to.
 */
export default function NewAppointmentPage(): React.JSX.Element {
  return (
    <RoleGate allow={['libya_doctor']}>
      {/* useSearchParams needs a Suspense boundary for static generation. */}
      <Suspense fallback={<Main><Spinner label="…" /></Main>}>
        <BookingFlow />
      </Suspense>
    </RoleGate>
  );
}

const HORIZON_DAYS = 21;

function BookingFlow(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const formatDate = useDateFormat();
  const { locale } = useLocale();
  const searchParams = useSearchParams();

  // The patient is named in the query string, by the doctor who picked them.
  // It used to fall back to `user.patientId` — the record a signed-in patient
  // had claimed — and migration 0021 removed both the account and the claim.
  const patientId = searchParams.get('patientId');

  const [step, setStep] = useState(0);
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [selectedStudies, setSelectedStudies] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- step 1: doctors -----------------------------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const { doctors: rows } = await api.scheduling.doctors();
        setDoctors(rows);
      } catch {
        setError(t.genericError);
        setDoctors([]);
      }
    })();
  }, [t]);

  // --- step 2: slots for the chosen doctor ---------------------------------
  const loadSlots = useCallback(
    async (chosen: Doctor) => {
      setSlots(null);
      const from = new Date();
      const to = new Date(from.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
      try {
        const { slots: rows } = await api.scheduling.openSlots(
          chosen.id,
          from.toISOString(),
          to.toISOString(),
        );
        setSlots(rows);
      } catch {
        setError(t.genericError);
        setSlots([]);
      }
    },
    [t],
  );

  // --- step 3: the patient's studies ---------------------------------------
  useEffect(() => {
    if (step !== 2 || patientId === null) return;
    void (async () => {
      try {
        const { studies: rows } = await api.imaging.studiesForPatient(patientId);
        setStudies(rows);
      } catch {
        setStudies([]);
      }
    })();
  }, [step, patientId]);

  const confirm = async (): Promise<void> => {
    if (doctor === null || slot === null || patientId === null) return;
    setBusy(true);
    setError(null);
    try {
      const appointment = await api.scheduling.book({
        patientId,
        doctorId: doctor.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        studyIds: selectedStudies,
      });
      // D2: booking creates a pending_payment appointment. Payment is the next
      // screen, not a step inside this one — the appointment exists either way.
      router.push(`/appointments/${appointment.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) {
        // Someone else won the slot. Send them back to a FRESH list rather
        // than leaving the taken slot selected.
        setError(t.bookingSlotTaken);
        setSlot(null);
        setStep(1);
        if (doctor !== null) void loadSlots(doctor);
      } else {
        setError(t.genericError);
      }
    } finally {
      setBusy(false);
    }
  };

  const stepLabels = [t.bookingStepDoctor, t.bookingStepSlot, t.bookingStepStudies, t.bookingStepConfirm];

  // Presentation only: slots grouped by calendar day so the grid reads like a
  // diary. The values sent to the API are the untouched ISO instants.
  const intlLocale = locale === 'ar' ? 'ar-LY' : 'fr-TN';
  const dayLabel = new Intl.DateTimeFormat(intlLocale, { dateStyle: 'full' });
  const timeLabel = new Intl.DateTimeFormat(intlLocale, { timeStyle: 'short' });
  const slotsByDay = (slots ?? []).reduce<Map<string, Slot[]>>((acc, s) => {
    const key = dayLabel.format(new Date(s.startsAt));
    acc.set(key, [...(acc.get(key) ?? []), s]);
    return acc;
  }, new Map());

  return (
    <Main>
      <Breadcrumbs
        items={[{ label: t.appointmentsTitle, href: '/appointments' }, { label: t.bookingTitle }]}
      />
      <PageHeader title={t.bookingTitle} />
      <Steps steps={stepLabels} current={step} />

      {error !== null && (
        <Alert tone={error === t.bookingSlotTaken ? 'warning' : 'danger'} testId="booking-error">
          {error}
        </Alert>
      )}

      {patientId === null && <Alert tone="warning">{t.bookingNoPatient}</Alert>}

      {/* ---- step 1: doctor ---- */}
      {step === 0 && (
        <Card title={t.bookingStepDoctor}>
          {doctors === null ? (
            <Spinner label={t.loading} />
          ) : doctors.length === 0 ? (
            <EmptyState>{t.none}</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="doctor-list">
              {doctors.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    data-testid="choose-doctor"
                    className="flex w-full flex-col gap-1 rounded-lg border bg-card p-4 text-start shadow-sm transition-colors hover:border-primary"
                    onClick={() => {
                      setDoctor(d);
                      setStep(1);
                      void loadSlots(d);
                    }}
                  >
                    <span className="font-semibold">{d.displayName}</span>
                    <span className="text-sm text-muted-foreground">
                      {[d.specialty, d.city].filter((v) => v !== null && v !== '').join(' · ')}
                    </span>
                    <span className="mt-1 text-sm font-medium text-primary">{t.bookingChoose}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---- step 2: slot ---- */}
      {step === 1 && doctor !== null && (
        <Card
          title={`${t.bookingStepSlot} — ${doctor.displayName}`}
          actions={
            <Button size="sm" onClick={() => setStep(0)}>
              {t.back}
            </Button>
          }
        >
          {slots === null ? (
            <Spinner label={t.loading} />
          ) : slots.length === 0 ? (
            <EmptyState testId="no-slots">{t.bookingNoSlots}</EmptyState>
          ) : (
            <div className="space-y-4" data-testid="slot-list">
              {[...slotsByDay.entries()].map(([day, daySlots]) => (
                <div key={day}>
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{day}</h3>
                  <div className="flex flex-wrap gap-2">
                    {daySlots.map((s) => (
                      <button
                        key={s.startsAt}
                        type="button"
                        data-testid="choose-slot"
                        className="min-h-10 rounded-md border bg-card px-4 text-sm font-medium tabular-nums shadow-sm transition-colors hover:border-primary hover:text-primary"
                        onClick={() => {
                          setSlot(s);
                          setStep(2);
                        }}
                      >
                        {timeLabel.format(new Date(s.startsAt))}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ---- step 3: studies ---- */}
      {step === 2 && (
        <Card
          title={t.bookingStepStudies}
          actions={
            <Button size="sm" onClick={() => setStep(1)}>
              {t.back}
            </Button>
          }
        >
          {studies.length === 0 ? (
            <EmptyState>{t.none}</EmptyState>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="study-picker">
              {studies.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/40">
                    <input
                      type="checkbox"
                      data-testid="study-checkbox"
                      className="size-4 accent-primary"
                      checked={selectedStudies.includes(s.id)}
                      onChange={(e) =>
                        setSelectedStudies((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                        )
                      }
                    />
                    <span className="text-sm">{s.description ?? s.studyInstanceUid}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <Button variant="primary" data-testid="studies-next" onClick={() => setStep(3)}>
            {t.next}
          </Button>
        </Card>
      )}

      {/* ---- step 4: confirm ---- */}
      {step === 3 && doctor !== null && slot !== null && (
        <Card
          title={t.bookingStepConfirm}
          actions={
            <Button size="sm" onClick={() => setStep(2)}>
              {t.back}
            </Button>
          }
        >
          <dl className="divide-y rounded-md border text-sm">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="text-muted-foreground">{t.bookingDoctor}</dt>
              <dd className="font-medium">{doctor.displayName}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="text-muted-foreground">{t.bookingSlot}</dt>
              <dd className="font-medium tabular-nums">{formatDate(slot.startsAt)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="text-muted-foreground">{t.patientStudies}</dt>
              <dd className="font-medium tabular-nums">{selectedStudies.length}</dd>
            </div>
          </dl>
          <Alert tone="info">{t.checkoutDescription}</Alert>
          <Button
            variant="primary"
            className="h-11 w-full sm:w-auto"
            data-testid="confirm-booking"
            disabled={busy || patientId === null}
            onClick={() => void confirm()}
          >
            {t.bookingConfirm}
          </Button>
        </Card>
      )}
    </Main>
  );
}
