import type { Appointment } from '../api/endpoints';

export type AppointmentStatus = Appointment['status'];

/**
 * Whether an appointment still occupies its slot and can still be acted on.
 *
 * SPELLED AS AN EXHAUSTIVE RECORD, not a list of statuses to exclude. The
 * version this replaced was `status !== 'cancelled' && status !== 'expired'`,
 * repeated at three call sites — and `expired` was a value the database could
 * not hold, so all three were carrying a condition that never fired while
 * genuinely-finished appointments had no way to be excluded at all.
 *
 * A `Record` keyed by the status union makes adding a status a COMPILE ERROR
 * here rather than a silent omission at whichever call site was overlooked.
 */
const LIVE: Record<AppointmentStatus, boolean> = {
  // Referred, awaiting the receiving doctor's answer.
  pending: true,
  confirmed: true,
  // A refusal frees the slot exactly as a cancellation does — the database's
  // exclusion constraint ignores both — so it must not read as still live here
  // either.
  declined: false,
  cancelled: false,
  // The visit happened, or the slot was lost. Either way it is history: it
  // must not appear as "upcoming", and it must not offer a cancel button.
  completed: false,
  no_show: false,
};

export function isLiveAppointment(status: AppointmentStatus): boolean {
  return LIVE[status];
}

/** Terminal states, for filtering an agenda down to what still needs doing. */
export function isFinishedAppointment(status: AppointmentStatus): boolean {
  return !LIVE[status];
}
