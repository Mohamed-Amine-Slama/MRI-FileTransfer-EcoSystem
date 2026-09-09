import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BuildTwinJob } from '../../../shared/jobs/queue.tokens';
import { DatabaseService } from '../../../shared/db/database.service';
import { ORTHANC_CLIENT, type OrthancClient } from './orthanc.client';

/**
 * The de-identified twin — spec 2026-09-08, decision S2.
 *
 * A second copy of every study with the patient stripped out of it. The
 * receiving doctor reads ONLY the twin; the original is never on a path they
 * can reach.
 *
 * WHY A TWIN RATHER THAN FILTERING AT READ TIME. Filtering is cheaper — no
 * duplicate storage, no UID remapping, and a policy change applies instantly.
 * It was rejected because it puts the identifiers one proxy bug away from a
 * doctor, and §8 of the requirements calls this a zero-tolerance surface. With
 * a twin, the bytes reachable from the doctor's routes simply do not contain a
 * name, so a mistake in the proxy is a broken image rather than a disclosure.
 *
 * WHY ORTHANC DOES THE WORK. ADR-3: do not hand-roll DICOM manipulation. A tag
 * rewriter over a stream is exactly that, and it is the kind of code whose bugs
 * are silent. `POST /studies/{id}/anonymize` implements the PS3.15 Annex E
 * basic profile, allocates fresh UIDs, and persists the result as its own
 * resource — verified against Orthanc 24.10.1, which returns the new study's
 * Orthanc id and reports FailedInstancesCount.
 *
 * ADR-4 IS NOT VIOLATED. The original bytes are untouched; the twin is a
 * derived artifact, which is exactly the category ADR-4 permits.
 */

/** Ages above 89 identify individuals in a small population (Safe Harbor). */
const MAX_AGE_YEARS = 90;

/**
 * DICOM's Age String (VR "AS") is exactly four characters: three digits and a
 * unit. '45Y' is malformed and some viewers drop it silently.
 */
export function dicomAge(years: number): string {
  const bounded = Math.min(MAX_AGE_YEARS, Math.max(0, Math.trunc(years)));
  return `${String(bounded).padStart(3, '0')}Y`;
}

export interface AnonymisationRequest {
  Keep: string[];
  Replace: Record<string, string>;
  KeepPrivateTags: boolean;
}

/**
 * The tag policy. PS3.15 Annex E basic profile, with three deliberate
 * deviations — all recorded in the spec so they are reviewable rather than
 * discovered:
 *
 *  1. PatientAge is SET, not stripped. It is the only way the doctor learns the
 *     age at all, and an age is a clinical fact where a birth date is an
 *     identifier.
 *  2. PatientSex is kept. It changes how imaging is read.
 *  3. StudyDate is kept, which the basic profile strips. How recent a scan is
 *     changes how it is read, and the patient is already pseudonymous behind a
 *     fresh UID. This one is flagged for counsel alongside L9.
 *
 * NOT kept, deliberately: StudyDescription and SeriesDescription. They are
 * operator-typed free text and routinely contain the patient's name. The
 * clinical context the doctor needs arrives as the case's `reason`, which is
 * authored inside the platform.
 */
export function anonymisationRequest(brief: {
  ageYears: number;
  sex: string;
}): AnonymisationRequest {
  return {
    Keep: ['StudyDate', 'PatientSex', 'Modality', 'BodyPartExamined'],
    Replace: { PatientAge: dicomAge(brief.ageYears) },
    KeepPrivateTags: false,
  };
}

/** What the twin builder needs to know about a study, in one read. */
interface TwinInput {
  study_instance_uid: string;
  status: string;
  twin_study_uid: string | null;
  age_years: number;
  sex: string;
}

@Injectable()
export class TwinService {
  private readonly logger = new Logger(TwinService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(ORTHANC_CLIENT) private readonly orthanc: OrthancClient,
  ) {}

  /**
   * Build the de-identified copy and release the study to its doctor.
   *
   * WHOSE IDENTITY THIS RUNS UNDER. The uploading doctor's — carried on the
   * job rather than looked up, because looking it up would itself need a
   * session. No privileged connection is involved and no policy is bypassed:
   * `studies_uploader_insert` requires the uploader to be the patient's
   * creator, so `patients_creator` already lets them read the date of birth
   * this needs, and `studies_uploader_update` already lets them write the
   * result. A background job that cannot be done under a real identity is
   * usually a sign the model is wrong; this one can.
   *
   * ORDER MATTERS. Orthanc is called BEFORE the row is touched, and the row is
   * only released once the twin is known good. The reverse order would leave a
   * study marked 'ready' with no twin behind it — visible to a doctor and
   * impossible to open.
   */
  async build(job: BuildTwinJob): Promise<void> {
    const ctx = {
      userId: job.actorId,
      role: 'libya_doctor' as const,
      ipAddress: undefined,
      userAgent: 'twin-builder',
      requestId: `twin-${job.studyId}`,
    };

    const input: TwinInput | null = await this.db.txAs(ctx, async (tx) => {
      const res = await tx.query<TwinInput>(
        `SELECT s.study_instance_uid, s.status, s.twin_study_uid,
                LEAST(90, EXTRACT(YEAR FROM age(
                  COALESCE(s.study_date, CURRENT_DATE), p.date_of_birth))::int) AS age_years,
                p.sex
         FROM imaging_studies s
         JOIN patients_patients p ON p.id = s.patient_id
         WHERE s.id = $1`,
        [job.studyId],
      );
      return res.rows[0] ?? null;
    });

    // Gone, or not this actor's to build. Not an error worth retrying: a job
    // for a deleted study would otherwise retry until it dead-letters.
    if (input === null) {
      this.logger.warn(`twin skipped: study ${job.studyId} not visible to its uploader`);
      return;
    }

    // Quarantine is not a delay, it is a refusal. Building a twin of a study
    // whose PIXELS may carry the patient's name would launder the suspicion
    // into something that looks de-identified.
    if (input.status === 'quarantined') return;

    // Redelivery. BullMQ guarantees at-least-once, so this runs more than once
    // in normal operation and must not produce a second twin.
    if (input.twin_study_uid !== null && input.twin_study_uid !== '') return;

    const orthancId = await this.orthanc.lookupStudy(input.study_instance_uid);
    if (orthancId === null) {
      // Retryable: ingest stores to Orthanc best-effort, so the study may
      // simply not have landed yet.
      throw new Error(`Study ${input.study_instance_uid} is not in Orthanc yet`);
    }

    const twin = await this.orthanc.anonymiseStudy(
      orthancId,
      anonymisationRequest({ ageYears: input.age_years, sex: input.sex }),
    );

    if (twin.failedInstances > 0) {
      // A partial twin is the one outcome worse than none: the doctor would
      // open a study believing it de-identified while some slices still carry
      // the patient. Leave the study unreleased and let the job retry.
      throw new Error(
        `Orthanc failed to anonymise ${twin.failedInstances} instance(s) of ${job.studyId}`,
      );
    }

    await this.db.txAs(ctx, async (tx) => {
      await tx.query(
        `UPDATE imaging_studies
         SET twin_study_uid = $1, twin_orthanc_id = $2, status = 'ready'
         WHERE id = $3 AND status <> 'quarantined'`,
        [twin.studyInstanceUid, twin.orthancId, job.studyId],
      );
    });
  }
}
