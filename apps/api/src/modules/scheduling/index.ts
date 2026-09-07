/**
 * Public API of the `scheduling` module (BUILD_SPEC §5.1).
 *
 * Confirming an appointment lives here rather than in `billing` (§5.2): it used
 * to be billing's because capturing the patient's card was what confirmed a
 * booking, and migration 0023 removed the card. Note that double-booking
 * protection is NOT part of this API — it
 * lives in the database's exclusion constraint, where concurrency cannot
 * defeat it, and no caller can opt out of it.
 */
export { SchedulingService, SlotUnavailableError } from './internal/scheduling.service';
export type {
  Appointment,
  AppointmentSummary,
  AvailabilityWindow,
  BookingInput,
  DoctorSummary,
} from './internal/scheduling.service';
export { SchedulingModule } from './scheduling.module';
