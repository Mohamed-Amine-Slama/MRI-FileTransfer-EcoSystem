/**
 * Public API of the `cases` module (consult-model spec Part 1).
 *
 * Accepting a case lives here rather than in `billing`: it used to be
 * billing's because capturing the patient's card was what confirmed a booking,
 * and migration 0023 removed the card.
 *
 * Deliberately NOT exported: the controller, and any way to write a case's
 * status directly. Every status move goes through a verb that names the
 * transition it performs, so the machine in `@mir/contracts` stays the only
 * description of what may follow what.
 */
export { CasesService } from './internal/cases.service';
export type { Case, CaseSummary, SubmitInput } from './internal/cases.service';
export { DirectoryService } from './internal/directory.service';
export type { DirectoryEntry } from './internal/directory.service';
export { CasesModule } from './cases.module';
