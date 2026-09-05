'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api/client';
import { api, type AppointmentKind, type Clinician, type Patient } from '../../lib/api/endpoints';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { APPOINTMENT_KINDS, appointmentKindLabel } from '../../lib/scheduling/labels';
import { Alert, Button, Card, Field, Input, Select } from '../ui';

/**
 * Booking, for the two kinds of patient a practice actually sees.
 *
 * A REGISTERED PATIENT is found by phone number and nothing else — the same
 * privacy control /patients enforces. Searching by name would turn the booking
 * form into a directory of everyone the clinic has ever seen.
 *
 * A WALK-IN is somebody who is not a MIR user and may never be one. They become
 * an ordinary patient record with no claim on it, which is what the `created by
 * a doctor` / `claimed by a user` split in the schema already means. The
 * alternative — a name typed onto the appointment — loses the person the moment
 * they book a second visit, and gives them nothing to claim if they later join.
 *
 * Date of birth and sex are asked for because the patient record requires them.
 * That is real friction at a reception desk and it is deliberate: this is the
 * same record a doctor will later attach imaging to, and a clinical record with
 * no date of birth is one nobody can safely match a scan to.
 */
export function BookAppointment({
  doctorId,
  startsAt,
  endsAt,
  onBooked,
  onCancel,
}: {
  /** The calendar being booked into. A default, not a constraint — see below. */
  doctorId: string;
  startsAt: string;
  endsAt: string;
  onBooked: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const t = useT();
  const { role } = useSession();

  const [mode, setMode] = useState<'existing' | 'walk_in'>('existing');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Registered-patient search.
  const [phone, setPhone] = useState('');
  const [candidates, setCandidates] = useState<Patient[] | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);

  // Walk-in intake.
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | 'O'>('F');

  // Who the appointment is for. A hospital books on behalf of its clinicians,
  // so the doctor is a CHOICE here rather than always the signed-in user —
  // filtered by specialty, but chosen by a person. Routing a patient to a
  // clinician is a clinical decision, and picking automatically would make it
  // unsupervised and only visible once the patient was in the room.
  const [clinicians, setClinicians] = useState<Clinician[] | null>(null);
  const [assignedTo, setAssignedTo] = useState(doctorId);
  const [needed, setNeeded] = useState('');

  // Shared.
  const [start, setStart] = useState(toLocalInput(startsAt));
  const [end, setEnd] = useState(toLocalInput(endsAt));
  const [kind, setKind] = useState<AppointmentKind>('consultation');
  const [reason, setReason] = useState('');

  // An assistant reaches patients only through the phone-search function; the
  // /patients search route is not theirs, so walk-in intake is the only path
  // that works for them and the toggle would be a dead end.
  const canSearchRegistry = role !== 'assistant';

  useEffect(() => {
    void (async () => {
      try {
        const { organisation } = await api.organisations.mine();
        if (organisation === null) return;
        const { clinicians: rows } = await api.organisations.clinicians(organisation.id);
        setClinicians(rows);
      } catch {
        // No organisation, or no permission to read one. Falls back to booking
        // into the calendar this form was opened on, which is the solo-doctor
        // case and needs no picker at all.
        setClinicians([]);
      }
    })();
  }, []);

  /**
   * Clinicians whose specialty matches what was typed.
   *
   * A plain case-insensitive substring match, deliberately. Anything cleverer —
   * synonym lists, fuzzy scoring — would silently rank one colleague above
   * another on a clinical question, and the person booking can already see the
   * whole list when the box is empty.
   */
  const matching =
    clinicians === null
      ? null
      : needed.trim() === ''
        ? clinicians
        : clinicians.filter((c) =>
            (c.specialty ?? '').toLowerCase().includes(needed.trim().toLowerCase()),
          );

  const search = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { candidates: found } = await api.patients.searchByPhone(phone);
      setCandidates(found);
      setPatientId(found[0]?.id ?? null);
    } catch {
      setError(t.genericError);
      setCandidates([]);
    } finally {
      setBusy(false);
    }
  };

  const timesValid = start !== '' && end !== '' && new Date(end) > new Date(start);
  const ready =
    timesValid &&
    (mode === 'existing'
      ? patientId !== null
      : fullName.trim() !== '' && phone.trim() !== '' && dateOfBirth !== '');

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      let id = patientId;

      if (mode === 'walk_in') {
        const created = await api.patients.create({
          phoneE164: phone.trim(),
          fullName: fullName.trim(),
          dateOfBirth,
          sex,
        });
        // A near-duplicate needs a human decision, and a booking form is not
        // where that conversation belongs — merging two patients is the worst
        // thing this system can do, so it stops and sends the receptionist to
        // the full intake screen rather than guessing.
        if (created.kind !== 'created') {
          setError(t.scheduleDuplicateWarning);
          return;
        }
        id = created.patientId;
      }

      if (id === null) return;

      await api.scheduling.book({
        patientId: id,
        doctorId: assignedTo,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        studyIds: [],
        kind,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      onBooked();
    } catch (err) {
      // 409 is the exclusion constraint: somebody took the slot between this
      // form opening and being submitted. That is a normal outcome, not a
      // fault, and it needs its own sentence.
      setError(err instanceof ApiError && err.isConflict ? t.scheduleSlotTaken : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t.scheduleNewAppointment}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error !== null && <Alert tone="danger">{error}</Alert>}

        {canSearchRegistry && (
          <div className="flex gap-2" role="group">
            <Button
              type="button"
              variant={mode === 'existing' ? 'primary' : 'default'}
              data-testid="book-mode-existing"
              onClick={() => setMode('existing')}
            >
              {t.scheduleBookExisting}
            </Button>
            <Button
              type="button"
              variant={mode === 'walk_in' ? 'primary' : 'default'}
              data-testid="book-mode-walkin"
              onClick={() => setMode('walk_in')}
            >
              {t.scheduleBookWalkIn}
            </Button>
          </div>
        )}

        <Field label={t.schedulePhone}>
          <Input
            data-testid="book-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        {mode === 'existing' && canSearchRegistry ? (
          <>
            <Button
              type="button"
              variant="default"
              data-testid="book-search"
              disabled={phone.trim() === '' || busy}
              onClick={() => void search()}
            >
              {t.scheduleSearch}
            </Button>

            {candidates !== null &&
              (candidates.length === 0 ? (
                <Alert tone="warning">{t.scheduleNoMatch}</Alert>
              ) : (
                <Field label={t.schedulePatient}>
                  <Select
                    data-testid="book-patient"
                    value={patientId ?? ''}
                    onChange={(e) => setPatientId(e.target.value)}
                  >
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
          </>
        ) : (
          <>
            <Field label={t.scheduleFullName}>
              <Input
                data-testid="book-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.scheduleDateOfBirth}>
                <Input
                  data-testid="book-dob"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </Field>
              <Field label={t.scheduleSex}>
                <Select
                  data-testid="book-sex"
                  value={sex}
                  onChange={(e) => setSex(e.target.value as 'M' | 'F' | 'O')}
                >
                  <option value="F">{t.scheduleSexF}</option>
                  <option value="M">{t.scheduleSexM}</option>
                  <option value="O">{t.scheduleSexO}</option>
                </Select>
              </Field>
            </div>
          </>
        )}

        {matching !== null && matching.length > 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.scheduleNeeded} hint={t.scheduleNeededHint}>
              <Input
                data-testid="book-needed"
                value={needed}
                maxLength={120}
                onChange={(e) => setNeeded(e.target.value)}
              />
            </Field>
            <Field label={t.scheduleAssignTo}>
              <Select
                data-testid="book-assigned-to"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                {matching.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.specialty === null ? c.displayName : `${c.displayName} — ${c.specialty}`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {matching !== null && matching.length === 0 && needed.trim() !== '' && (
          <Alert tone="warning" testId="no-matching-clinician">
            {t.scheduleNoMatchingClinician}
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.scheduleStart}>
            <Input
              data-testid="book-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label={t.scheduleEnd}>
            <Input
              data-testid="book-end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>

        <Field label={t.scheduleKind}>
          <Select
            data-testid="book-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AppointmentKind)}
          >
            {APPOINTMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {appointmentKindLabel(k, t)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.scheduleReason}>
          <Input
            data-testid="book-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" data-testid="book-submit" disabled={!ready || busy}>
            {t.scheduleBook}
          </Button>
          <Button type="button" variant="default" onClick={onCancel} disabled={busy}>
            {t.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * An instant to the value a `datetime-local` input wants.
 *
 * That input has no concept of a zone, so this deliberately renders the
 * instant in the BROWSER's zone — the one the person filling the form is in.
 * `toISOString().slice(0,16)` would look almost identical and be wrong by the
 * UTC offset, which in Tunis is a silent one-hour error.
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
