/**
 * Orthanc DICOMweb client — BUILD_SPEC ADR-3, P8.
 *
 * Orthanc is the DICOM server (ADR-3: do not hand-roll DICOM storage,
 * indexing, or DICOMweb). It lives in a private subnet and is reachable only
 * from the API — the browser never talks to it directly (P8.2).
 *
 * Orthanc is an INDEX, not the source of record. The source of record is the
 * object in the originals bucket (ADR-4). If Orthanc's database is lost it can
 * be rebuilt by re-STOWing the originals; if the originals are lost, nothing
 * rebuilds them. That asymmetry is why an Orthanc failure during ingestion is
 * logged rather than treated as an ingest failure.
 */

export const ORTHANC_CLIENT = Symbol('ORTHANC_CLIENT');

/** The anonymised copy Orthanc created, as this codebase needs to record it. */
export interface AnonymisedStudy {
  /** Orthanc's own resource id for the twin. */
  orthancId: string;
  /** The twin's freshly allocated StudyInstanceUID. */
  studyInstanceUid: string;
  /**
   * Instances Orthanc could not anonymise. MUST be zero before a twin is
   * released: a partially anonymised study is one where some slices still
   * carry the patient, which is worse than no twin at all.
   */
  failedInstances: number;
}

export interface OrthancClient {
  /** STOW-RS: store one instance. Idempotent — Orthanc dedupes by SOP UID. */
  storeInstance(dicomBytes: Uint8Array): Promise<void>;
  /** QIDO-RS: study metadata, proxied through the API only (P8.2). */
  findStudy(studyInstanceUid: string): Promise<unknown>;
  /**
   * Resolve a StudyInstanceUID to Orthanc's own resource id.
   *
   * WHY A LOOKUP RATHER THAN A STORED COLUMN. `imaging_studies.orthanc_study_id`
   * has existed since migration 0001 and nothing has ever written it. Rather
   * than start populating it now — and owning a foreign system's identifier
   * that can drift whenever Orthanc is rebuilt from the originals (ADR-3 calls
   * Orthanc an index, not a source of record) — the id is resolved on demand.
   * That also means the twin builder works for studies ingested before it
   * existed, with no backfill.
   */
  lookupStudy(studyInstanceUid: string): Promise<string | null>;
  /**
   * Create a de-identified copy as a NEW Orthanc resource with fresh UIDs.
   *
   * Verified against Orthanc 24.10.1: this persists a new study and returns
   * its id. Fresh UIDs are not optional — reusing the originals would make
   * Orthanc dedupe the twin into the original.
   */
  anonymiseStudy(orthancStudyId: string, request: unknown): Promise<AnonymisedStudy>;
}

/**
 * No-op implementation for development and tests.
 *
 * Records what it was asked to store so tests can assert the pipeline reached
 * step 6, without requiring an Orthanc container. The real HTTP client is
 * written in PHASE 8, where it can be tested against an actual Orthanc.
 */
export class InMemoryOrthancClient implements OrthancClient {
  readonly stored: Uint8Array[] = [];
  readonly anonymised: string[] = [];
  /** Set to make storeInstance throw, to prove ingestion survives it. */
  failNext = false;
  /** Set to make anonymiseStudy throw, to prove the twin job retries. */
  failAnonymise = false;
  /** Set non-zero to prove a partial anonymisation never releases a study. */
  failedInstances = 0;
  /** UIDs that lookupStudy should report as absent from Orthanc. */
  readonly missingStudies = new Set<string>();

  async storeInstance(dicomBytes: Uint8Array): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated Orthanc outage');
    }
    this.stored.push(dicomBytes);
  }

  async findStudy(): Promise<unknown> {
    return null;
  }

  /** Answers with a deterministic id so tests need no Orthanc container. */
  async lookupStudy(studyInstanceUid: string): Promise<string | null> {
    return this.missingStudies.has(studyInstanceUid) ? null : `orthanc-${studyInstanceUid}`;
  }

  async anonymiseStudy(orthancStudyId: string): Promise<AnonymisedStudy> {
    if (this.failAnonymise) {
      this.failAnonymise = false;
      throw new Error('simulated anonymisation failure');
    }
    this.anonymised.push(orthancStudyId);
    return {
      orthancId: `twin-${orthancStudyId}`,
      studyInstanceUid: `1.2.826.0.1.3680043.8.498.${this.anonymised.length}`,
      failedInstances: this.failedInstances,
    };
  }
}
