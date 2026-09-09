import { Injectable, NotFoundException } from '@nestjs/common';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import { EventBus } from '../../../shared/events/event-bus';
import { SignedUrlService } from '../../../shared/storage/signed-url.service';

/**
 * Authorization and audit for study access — BUILD_SPEC P8.2.
 *
 * Every DICOMweb request passes through here, and every one of them produces a
 * `StudyAccessed` audit event — INCLUDING the ones that are refused.
 *
 * WHY DENIED ATTEMPTS ARE AUDITED:
 * a compromised doctor account looks, at first, exactly like a doctor clicking
 * around studies they cannot see. If only successful reads are recorded, the
 * reconnaissance phase of a breach leaves no trace at all, and the incident
 * timeline starts at the first thing that worked. P4.5's anomaly sweep reads
 * these rows.
 *
 * WHY THE ANSWER IS 404 AND NOT 403:
 * a 403 confirms the study exists. Combined with time-ordered UUIDv7 ids, that
 * turns the endpoint into an enumeration oracle for how many studies a given
 * patient has (§6).
 */

export type AccessKind = 'metadata' | 'pixel_data' | 'thumbnail';

export interface AuthorisedStudy {
  studyId: string;
  studyInstanceUid: string;
  patientId: string;
  /**
   * The UID to ask Orthanc for — sub-project 2.
   *
   * The de-identified twin's for a receiving doctor, the original's for the
   * lab that owns it. Never derive this from the caller's path parameter: that
   * is the value that would let a doctor request the original by guessing it.
   */
  orthancStudyUid: string;
}

export interface StudySummary {
  id: string;
  studyInstanceUid: string;
  description: string | null;
  studyDate: string | null;
  modality: string;
  instanceCount: number;
}

interface StudyRow {
  id: string;
  study_instance_uid: string;
  description: string | null;
  study_date: string | null;
  modality: string;
  file_count: number;
}

@Injectable()
export class StudyAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    private readonly signedUrls: SignedUrlService,
  ) {}

  /**
   * List studies for the worklist, scoped by patient or by case.
   *
   * No audit event is written here, and that is deliberate: this returns
   * headers — description, date, counts — and never pixel data or metadata for
   * a specific image. `StudyAccessed` means someone LOOKED at a scan, and
   * diluting it with every list render would make the anomaly sweep in P4.5
   * useless for spotting a doctor working through studies they shouldn't.
   *
   * Visibility is still RLS's decision, including the D3 payment gate: a
   * Tunisian doctor listing by case sees nothing until the case
   * is confirmed.
   */
  async listStudies(filter: { patientId?: string; caseId?: string }): Promise<StudySummary[]> {
    return this.db.tx(async (tx) => {
      const rows =
        filter.caseId !== undefined
          ? await tx.query<StudyRow>(
              `SELECT s.id, s.study_instance_uid, s.description, s.study_date,
                      s.modality, s.file_count
               FROM imaging_studies s
               JOIN cases_case_studies l ON l.study_id = s.id
               WHERE l.case_id = $1
               ORDER BY s.study_date DESC NULLS LAST`,
              [filter.caseId],
            )
          : await tx.query<StudyRow>(
              `SELECT s.id, s.study_instance_uid, s.description, s.study_date,
                      s.modality, s.file_count
               FROM imaging_studies s
               WHERE s.patient_id = $1
               ORDER BY s.study_date DESC NULLS LAST`,
              [filter.patientId],
            );

      return rows.rows.map((r) => ({
        id: r.id,
        studyInstanceUid: r.study_instance_uid,
        description: r.description,
        // DATE columns are parsed as plain strings (see pg-types) so a study
        // dated 2025-01-14 never shifts a day by timezone.
        studyDate: r.study_date,
        modality: r.modality,
        instanceCount: r.file_count,
      }));
    });
  }

  /**
   * Resolve a study the caller is allowed to see, or throw 404.
   *
   * Authorization is NOT re-implemented here. The query runs under row-level
   * security, so the row simply is not visible unless the policies allow it —
   * consent, case linkage and the payment gate all included. A
   * TypeScript-side permission check would be a second, weaker copy of that
   * logic which could drift (ADR-6).
   */
  async authoriseStudyAccess(
    studyInstanceUid: string,
    kind: AccessKind,
  ): Promise<AuthorisedStudy> {
    const ctx = requireContext();

    // WHICH COLUMN THE UID IS MATCHED AGAINST IS THE WHOLE CONTROL.
    //
    // A receiving doctor addresses the TWIN's uid and is resolved through
    // `twin_study_uid`; the lab addresses the original. Neither can reach the
    // other's copy by presenting its uid, because the uid they present is only
    // ever compared against the column their own role is allowed to use. A
    // doctor who somehow learned an original uid gets the same 404 as for a
    // study that does not exist — which matters, because a StudyInstanceUID is
    // itself a linkable identifier.
    //
    // RLS is still the outer gate: the policy from migration 0029 additionally
    // requires status = 'ready', a linked case and a live consent. This is the
    // application half of ADR-6's two layers, not a replacement for it.
    const byTwin = ctx.role === 'tunisia_doctor';

    const found = await this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        patient_id: string;
        study_instance_uid: string;
        twin_study_uid: string | null;
      }>(
        byTwin
          ? `SELECT id, patient_id, study_instance_uid, twin_study_uid
             FROM imaging_studies
             WHERE twin_study_uid = $1 AND status = 'ready'`
          : `SELECT id, patient_id, study_instance_uid, twin_study_uid
             FROM imaging_studies
             WHERE study_instance_uid = $1 AND status IN ('ready', 'processing')`,
        [studyInstanceUid],
      );
      return res.rows[0];
    });

    if (found === undefined) {
      // Audit the refusal before throwing. `patientId` is unknown precisely
      // because the row was invisible — recording the attempt is still the
      // point.
      await this.bus.publish({
        type: 'StudyAccessed',
        studyId: undefined,
        studyInstanceUid,
        patientId: undefined,
        accessKind: kind,
        granted: false,
        actorId: ctx.userId,
        actorRole: ctx.role,
        occurredAt: new Date(),
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new NotFoundException('Study not found');
    }

    await this.bus.publish({
      type: 'StudyAccessed',
      studyId: found.id,
      studyInstanceUid: found.study_instance_uid,
      patientId: found.patient_id,
      accessKind: kind,
      granted: true,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      studyId: found.id,
      studyInstanceUid: found.study_instance_uid,
      patientId: found.patient_id,
      // The doctor's twin uid is the one they presented; the lab's is the
      // original. Read back from the row rather than echoed from the argument,
      // so a caller cannot influence what the proxy fetches.
      orthancStudyUid: byTwin ? (found.twin_study_uid ?? '') : found.study_instance_uid,
    };
  }

  /**
   * Issue a short-lived, subject-bound URL for one instance.
   *
   * Authorization happens first, so an unauthorised caller never receives a
   * token at all — the signature is not the access-control mechanism, it is
   * what makes an already-authorised grant expire.
   */
  async issueInstanceUrl(
    studyInstanceUid: string,
    sopInstanceUid: string,
  ): Promise<{ url: string; expiresAt: number }> {
    const ctx = requireContext();
    await this.authoriseStudyAccess(studyInstanceUid, 'pixel_data');

    const resource = `/dicom-web/studies/${studyInstanceUid}/instances/${sopInstanceUid}`;
    const { token, expiresAt } = this.signedUrls.sign(resource, ctx.userId);
    return { url: `${resource}?token=${token}`, expiresAt };
  }
}
