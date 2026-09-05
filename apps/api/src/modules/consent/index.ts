/**
 * Public API of the `consent` module (BUILD_SPEC §5.1).
 *
 * `imaging` consumes this to decide whether a transfer is unblocked (§5.2).
 * The evidence reader is exported deliberately — reproducing what a patient
 * agreed to is a cross-cutting legal need, not a consent-module private.
 */
export { ConsentService, ConsentTextMismatchError, hashConsentText } from './internal/consent.service';
export type { AttestConsentInput, ConsentEvidence, ConsentTerms } from './internal/consent.service';
export { ConsentModule } from './consent.module';
