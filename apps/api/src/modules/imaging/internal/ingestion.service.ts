import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isDicom, readHeader, sha256, type DicomHeader } from '@mir/dicom-utils';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService, type Tx } from '../../../shared/db/database.service';
import { EventBus } from '../../../shared/events/event-bus';
import { BLOB_STORE } from '../../../shared/storage/storage.module';
import {
  ObjectAlreadyExistsError,
  derivedThumbnailKey,
  originalKey,
  type BlobStore,
} from '../../../shared/storage/blob-store';
import { stagingKey } from './upload.service';
import { ORTHANC_CLIENT, type OrthancClient } from './orthanc.client';
import { ThumbnailService } from './thumbnail.service';
import { decideRelease } from './burned-in';

/**
 * Server-side ingestion — BUILD_SPEC P7.4.
 *
 * Runs once per verified file. The ordering matters and is not arbitrary:
 *
 *   1. re-validate DICOM magic bytes SERVER-SIDE (never trust the client, §17)
 *   2. parse header tags
 *   3. check StudyInstanceUID consistency, FLAG mismatches rather than split
 *   4. write original bytes unmodified to the originals bucket (ADR-4)
 *   5. insert imaging_instances with key, size, checksum
 *   6. push to Orthanc via STOW-RS
 *   7. generate a thumbnail into derived
 *   8. when every file is in, mark the study ready and emit the event
 *
 * Storage comes BEFORE the database row: an object with no row is an orphan a
 * sweep can find and reconcile. A row pointing at an object that was never
 * written is a study that looks complete and fails at read time — which, for
 * imaging, means a doctor opening a scan that is not there.
 *
 * Step 8 is the safety-critical one. A study is marked `ready` only when every
 * expected file has been ingested. Marking it early would let a doctor read an
 * incomplete study and miss a finding (§17).
 */

export interface IngestResult {
  status: 'ingested' | 'rejected' | 'already_present';
  reason?: string;
  instanceId?: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Inject(ORTHANC_CLIENT) private readonly orthanc: OrthancClient,
    private readonly thumbnails: ThumbnailService,
  ) {}

  /**
   * Ingest one verified file.
   *
   * Idempotent: re-running for a file already ingested is a no-op, which is
   * what makes job retries safe (P7.4 gate).
   */
  async ingestFile(fileId: string): Promise<IngestResult> {
    const file = await this.loadFile(fileId);

    if (file.status === 'ingested') {
      return { status: 'already_present' };
    }

    const bytes = await this.blobs.readStaged(
      stagingKey(file.session_id, file.client_file_id),
    );

    // --- 1. server-side re-validation ---------------------------------------
    // The client already checked. That is irrelevant: client-side validation is
    // trivially bypassed, and this is the boundary that decides what enters the
    // source of record.
    if (!isDicom(bytes)) {
      return this.reject(fileId, 'not_dicom');
    }

    // --- 2. parse header ----------------------------------------------------
    let header: DicomHeader;
    try {
      header = readHeader(bytes);
    } catch (err) {
      const reason =
        typeof err === 'object' && err !== null && 'reason' in err
          ? String((err as { reason: unknown }).reason)
          : 'malformed';
      return this.reject(fileId, reason);
    }

    // The checksum was verified at assembly (P7.2); recompute here so the
    // value stored alongside the object is one THIS code derived from the
    // bytes it actually wrote.
    const digest = sha256(bytes);

    return this.db.tx(async (tx) => {
      const session = await this.loadSession(tx, file.session_id);

      // --- 3. study consistency --------------------------------------------
      if (
        session.study_instance_uid !== null &&
        session.study_instance_uid !== header.studyInstanceUID
      ) {
        // Two different studies in one upload. Splitting silently would file
        // half a scan under a study the doctor never named; flagging stops the
        // session for review instead.
        await tx.query(
          `UPDATE imaging_upload_files
           SET status = 'rejected', failure_reason = 'study_uid_mismatch', updated_at = now()
           WHERE id = $1`,
          [fileId],
        );
        this.logger.warn(
          `study UID mismatch in session ${file.session_id}: expected ` +
            `${session.study_instance_uid}, file has ${header.studyInstanceUID}`,
        );
        return { status: 'rejected' as const, reason: 'study_uid_mismatch' };
      }

      const studyId = await this.ensureStudy(tx, session, header);

      // --- 4. write the original, unmodified --------------------------------
      const key = originalKey({
        patientId: session.patient_id,
        studyInstanceUid: header.studyInstanceUID,
        seriesInstanceUid: header.seriesInstanceUID,
        sopInstanceUid: header.sopInstanceUID,
      });

      try {
        await this.blobs.putOriginal(key, bytes);
      } catch (err) {
        if (!(err instanceof ObjectAlreadyExistsError)) throw err;
        // Already stored by an earlier attempt. Originals are immutable, so
        // the existing object is authoritative and this is a retry, not a
        // conflict.
      }

      // --- 5. instance row ---------------------------------------------------
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO imaging_instances
           (study_id, sop_uid, series_uid, storage_key, size_bytes, sha256)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (study_id, sop_uid) DO NOTHING
         RETURNING id`,
        [
          studyId,
          header.sopInstanceUID,
          header.seriesInstanceUID,
          key,
          bytes.byteLength,
          digest,
        ],
      );

      const instanceId = inserted.rows[0]?.id;
      const isNew = instanceId !== undefined;

      if (isNew) {
        await tx.query(
          `UPDATE imaging_studies
           SET file_count = file_count + 1, total_bytes = total_bytes + $1
           WHERE id = $2`,
          [bytes.byteLength, studyId],
        );
      }

      await tx.query(
        `UPDATE imaging_upload_files
         SET status = 'ingested', storage_key = $1, updated_at = now()
         WHERE id = $2`,
        [key, fileId],
      );

      // --- 6/7. Orthanc and thumbnail ---------------------------------------
      // Both are derived state: recoverable from the original at any time. If
      // either fails the ingest still counts, because the source of record —
      // the object and its row — is already durable. Losing a thumbnail is a
      // slow viewer; losing the original is a lost scan.
      if (isNew) {
        try {
          await this.orthanc.storeInstance(bytes);
        } catch (err) {
          this.logger.error(
            `Orthanc STOW-RS failed for ${header.sopInstanceUID}: ${errMessage(err)}`,
          );
        }
        try {
          const thumb = await this.thumbnails.generate(bytes);
          await this.blobs.putDerived(
            derivedThumbnailKey({
              patientId: session.patient_id,
              studyInstanceUid: header.studyInstanceUID,
              sopInstanceUid: header.sopInstanceUID,
            }),
            thumb.bytes,
          );
        } catch (err) {
          // Derived data. A missing thumbnail slows the viewer's first paint;
          // it does not lose the scan, so it must not fail the ingest.
          this.logger.warn(`thumbnail generation failed: ${errMessage(err)}`);
        }
      }

      // --- 8. completion -----------------------------------------------------
      await this.maybeCompleteStudy(tx, file.session_id, studyId);

      return {
        status: isNew ? ('ingested' as const) : ('already_present' as const),
        ...(instanceId !== undefined ? { instanceId } : {}),
      };
    });
  }

  /**
   * Mark the study ready only when every expected file is in.
   *
   * `expected_file_count` comes from the client at session creation, so it is
   * compared against files actually INGESTED, not merely received. A study
   * whose files are still being verified stays `processing`.
   */
  private async maybeCompleteStudy(tx: Tx, sessionId: string, studyId: string): Promise<void> {
    const counts = await tx.query<{
      expected: number;
      ingested: string;
      outstanding: string;
    }>(
      `SELECT s.expected_file_count AS expected,
              COUNT(*) FILTER (WHERE f.status = 'ingested')::text AS ingested,
              COUNT(*) FILTER (WHERE f.status NOT IN ('ingested','rejected'))::text AS outstanding
       FROM imaging_upload_sessions s
       LEFT JOIN imaging_upload_files f ON f.session_id = s.id
       WHERE s.id = $1
       GROUP BY s.expected_file_count`,
      [sessionId],
    );

    const row = counts.rows[0];
    if (row === undefined) return;

    const ingested = Number(row.ingested);
    const outstanding = Number(row.outstanding);

    if (ingested < row.expected || outstanding > 0) {
      // Not finished. Deliberately leaves the study in 'processing' — a
      // partial study must never be readable as though complete (§17).
      return;
    }

    const updated = await tx.query<{ id: string; patient_id: string; file_count: number; total_bytes: string }>(
      // A quarantined study is excluded, not just left alone: completing the
      // upload is not what clears a burned-in suspicion. It stays quarantined
      // until someone looks at it, and the doctor's policy (migration 0029)
      // refuses it in the meantime.
      `UPDATE imaging_studies
       SET status = 'ready'
       WHERE id = $1 AND status NOT IN ('ready','quarantined')
       RETURNING id, patient_id, file_count, total_bytes`,
      [studyId],
    );

    await tx.query(
      `UPDATE imaging_upload_sessions SET status = 'completed', updated_at = now()
       WHERE id = $1`,
      [sessionId],
    );

    const study = updated.rows[0];
    if (study === undefined) return; // already completed by a concurrent job

    const ctx = requireContext();
    await this.bus.publish({
      type: 'StudyUploadCompleted',
      studyId: study.id,
      patientId: study.patient_id,
      fileCount: study.file_count,
      totalBytes: Number(study.total_bytes),
      containsLossy: false,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async ensureStudy(
    tx: Tx,
    session: SessionRow,
    header: DicomHeader,
  ): Promise<string> {
    if (session.study_id !== null) return session.study_id;

    const ctx = requireContext();

    // The study may already exist from an earlier session for the same patient
    // and StudyInstanceUID — a doctor re-uploading a CD, for instance. The
    // unique constraint makes that idempotent rather than duplicating.
    // Sub-project 2: a study that may carry the patient's name in its PIXELS
    // never reaches 'processing', because 'processing' is the state the twin
    // builder picks up. Quarantine is sticky in the conflict branch below for
    // the same reason a 'ready' study is: one clean slice arriving after a
    // dirty one must not release the study.
    const decision = decideRelease(header);

    const res = await tx.query<{ id: string }>(
      `INSERT INTO imaging_studies
         (patient_id, uploaded_by, study_instance_uid, modality, study_date, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (patient_id, study_instance_uid) DO UPDATE
         SET status = CASE
                        WHEN imaging_studies.status IN ('ready','quarantined')
                          THEN imaging_studies.status
                        WHEN EXCLUDED.status = 'quarantined'
                          THEN 'quarantined'
                        ELSE 'processing'
                      END
       RETURNING id`,
      [
        session.patient_id,
        ctx.userId,
        header.studyInstanceUID,
        header.modality,
        parseDicomDate(header.studyDate),
        decision,
      ],
    );

    const studyId = res.rows[0]?.id;
    if (studyId === undefined) throw new NotFoundException('Study could not be created');

    await tx.query(
      `UPDATE imaging_upload_sessions
       SET study_id = $1, study_instance_uid = $2, updated_at = now()
       WHERE id = $3`,
      [studyId, header.studyInstanceUID, session.id],
    );

    return studyId;
  }

  private async reject(fileId: string, reason: string): Promise<IngestResult> {
    await this.db.tx(async (tx) => {
      await tx.query(
        `UPDATE imaging_upload_files
         SET status = 'rejected', failure_reason = $1, updated_at = now()
         WHERE id = $2`,
        [reason, fileId],
      );
    });
    return { status: 'rejected', reason };
  }

  private async loadFile(fileId: string): Promise<FileRow> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<FileRow>(`SELECT * FROM imaging_upload_files WHERE id = $1`, [
        fileId,
      ]);
      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('Upload file not found');
      return row;
    });
  }

  private async loadSession(tx: Tx, sessionId: string): Promise<SessionRow> {
    const res = await tx.query<SessionRow>(
      `SELECT * FROM imaging_upload_sessions WHERE id = $1`,
      [sessionId],
    );
    const row = res.rows[0];
    if (row === undefined) throw new NotFoundException('Upload session not found');
    return row;
  }
}

interface FileRow {
  id: string;
  session_id: string;
  client_file_id: string;
  status: string;
  client_sha256: string;
}

interface SessionRow {
  id: string;
  patient_id: string;
  created_by: string;
  expected_file_count: number;
  status: string;
  study_id: string | null;
  study_instance_uid: string | null;
}

/** DICOM DA is `YYYYMMDD`; anything else is treated as absent rather than guessed. */
function parseDicomDate(value: string | undefined): string | null {
  if (value === undefined || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
