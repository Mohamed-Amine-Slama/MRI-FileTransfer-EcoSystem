/**
 * Domain events — BUILD_SPEC §5.2.
 *
 * "Adding a feature should mean adding a subscriber, not editing an existing
 * module." That property only holds if events carry enough context for a new
 * subscriber to act without reaching back into the emitting module's tables —
 * which the boundary rules forbid anyway (§5.1).
 *
 * WHAT EVENTS MUST NOT CARRY:
 * no clinical detail, no image bytes, no patient names. Subscribers include
 * notifications (P12), which must never put clinical information into an SMS.
 * Keeping payloads to identifiers means a careless template cannot leak a
 * diagnosis, because the data was never in the event to begin with.
 */

export interface DomainEventBase {
  /** Who caused this. Absent only for system-initiated events. */
  actorId: string | undefined;
  actorRole: string | undefined;
  occurredAt: Date;
  requestId: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
}

export interface PatientCreated extends DomainEventBase {
  type: 'PatientCreated';
  patientId: string;
  createdByDoctor: string;
}

export interface ConsentGranted extends DomainEventBase {
  type: 'ConsentGranted';
  consentId: string;
  patientId: string;
  /** The named receiving doctor. Consent is never open-ended (P5.3). */
  grantedTo: string;
  termsVersion: string;
  termsLocale: string;
}

export interface ConsentRevoked extends DomainEventBase {
  type: 'ConsentRevoked';
  consentId: string;
  patientId: string;
  grantedTo: string;
}

export interface StudyUploadCompleted extends DomainEventBase {
  type: 'StudyUploadCompleted';
  studyId: string;
  patientId: string;
  fileCount: number;
  totalBytes: number;
  /** True if any instance used a lossy transfer syntax (P6.1). */
  containsLossy: boolean;
}

/**
 * A case was submitted by the referring lab.
 *
 * Carries no price: at submission there is no doctor and therefore no quote,
 * because the doctor's tier is a term in the price.
 */
export interface CaseSubmitted extends DomainEventBase {
  type: 'CaseSubmitted';
  caseId: string;
  patientId: string;
  organisationId: string;
  specialty: string;
}

/**
 * The lab chose a doctor and the platform locked a price.
 *
 * The amount is here because the ledger and the audit trail both need to know
 * what was promised, and reading it back off the row later would not prove what
 * the lab was shown at the moment they committed.
 */
export interface CaseQuoted extends DomainEventBase {
  type: 'CaseQuoted';
  caseId: string;
  patientId: string;
  doctorId: string;
  amountMinor: number;
  currency: string;
}

/**
 * The case was cancelled or withdrawn.
 *
 * `reason` is a short coordination note, never a clinical one — it reaches the
 * other side, and this system holds no medical record to quote from.
 */
export interface CaseCancelled extends DomainEventBase {
  type: 'CaseCancelled';
  caseId: string;
  patientId: string;
  /**
   * Null when the lab withdrew before choosing anyone. Not optional: the
   * difference between "cancelled on a doctor" and "cancelled before there was
   * one" is exactly what a later dispute turns on, so the absence is recorded
   * rather than left out.
   */
  doctorId: string | null;
  reason?: string;
}

/**
 * The doctor refused the case after reading the summary.
 *
 * Distinct from CaseCancelled because the lab reads them differently: a refusal
 * means pick someone else, a cancellation is their own withdrawal. The payment
 * hold survives this event.
 */
export interface CaseDeclined extends DomainEventBase {
  type: 'CaseDeclined';
  caseId: string;
  patientId: string;
  doctorId: string;
}

/**
 * An accepted case passed its answer deadline without a diagnosis.
 *
 * Raised by the periodic sweep, not by a request, so its actor is the system
 * identity rather than a person. This is the refund trigger.
 */
export interface CaseExpired extends DomainEventBase {
  type: 'CaseExpired';
  caseId: string;
  patientId: string;
  doctorId: string;
}

/**
 * The receiving doctor accepted the case.
 *
 * This replaces `PaymentSucceeded`, which is what used to confirm a booking:
 * the patient's card was captured on acceptance, and the payment event was the
 * only signal anything downstream got. Migration 0023 removed the card, which
 * left that event with no publisher — an audit branch nothing reached and a
 * notification nothing sent.
 *
 * Carries no money, because acceptance never was a payment. It is also the
 * moment imaging unlocks, which is why audit cares about it.
 */
export interface CaseAccepted extends DomainEventBase {
  type: 'CaseAccepted';
  caseId: string;
  patientId: string;
  doctorId: string;
}


export interface StudyAccessed extends DomainEventBase {
  type: 'StudyAccessed';
  /**
   * Internal study id. UNDEFINED when access was refused — the row was
   * invisible to the caller, so we genuinely do not know which study (if any)
   * they were reaching for. Modelling it as `string` forced a DICOM UID into a
   * uuid column, which made the audit INSERT fail and lost the very denial it
   * was recording.
   */
  studyId: string | undefined;
  /** The DICOM Study Instance UID the caller asked for. Always known. */
  studyInstanceUid: string;
  /** Undefined on a refusal, for the same reason as studyId. */
  patientId: string | undefined;
  /** What the actor did: metadata query, image retrieval, thumbnail. */
  accessKind: 'metadata' | 'pixel_data' | 'thumbnail';
  /** False when the attempt was refused — denied attempts are audited too. */
  granted: boolean;
}

export type DomainEvent =
  | PatientCreated
  | ConsentGranted
  | ConsentRevoked
  | StudyUploadCompleted
  | CaseSubmitted
  | CaseQuoted
  | CaseCancelled
  | CaseDeclined
  | CaseExpired
  | CaseAccepted
  | StudyAccessed;

export type DomainEventType = DomainEvent['type'];
