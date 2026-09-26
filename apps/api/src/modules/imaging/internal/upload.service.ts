import { gunzipSync } from 'node:zlib';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sha256 } from '@mir/dicom-utils';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import { BLOB_STORE } from '../../../shared/storage/storage.module';
import type { BlobStore } from '../../../shared/storage/blob-store';

/**
 * Resumable upload — BUILD_SPEC P7.1, P7.2.
 *
 * THE CONSTRAINT THAT SHAPES ALL OF THIS:
 * a 200 MB-1 GB study, over hundreds of files, on an intermittent Libyan
 * uplink. Any design where an interruption costs more than one chunk of
 * progress will be abandoned by doctors, and an abandoned upload is a referral
 * that does not happen.
 *
 * So: chunks are small (5 MiB default), the resume point is durable in
 * PostgreSQL rather than in memory, and re-registering a file returns where to
 * continue from instead of starting over.
 *
 * CHECKSUM POSITION: the client's SHA-256 is recorded but never trusted. The
 * server recomputes over the assembled bytes and compares. A mismatch means
 * the transfer is corrupt — the file is reset for retry, never accepted and
 * never "repaired" (ADR-4).
 */

export interface CreateSessionInput {
  patientId: string;
  expectedFileCount: number;
}

export interface RegisterFileInput {
  sessionId: string;
  /** Stable client-side id, e.g. a hash of the file's path in the folder. */
  clientFileId: string;
  fileName: string;
  /** Size of the ORIGINAL file, before any transfer encoding. */
  sizeBytes: number;
  /** SHA-256 of the ORIGINAL file, before any transfer encoding. */
  sha256: string;
  /**
   * Transfer encoding of the chunks that will follow (P7.3 step 4).
   * 'gzip' is container-level compression only — it never alters pixel data
   * or the DICOM transfer syntax (ADR-5).
   */
  contentEncoding?: 'identity' | 'gzip';
}

export interface FileUploadState {
  fileId: string;
  /** Byte offset the client should resume from. Zero for a new file. */
  receivedBytes: number;
  nextChunkIndex: number;
  chunkSizeBytes: number;
  status: string;
}

export class ChecksumMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super('Uploaded file failed checksum verification and was rejected');
    this.name = 'ChecksumMismatchError';
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

@Injectable()
export class UploadService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * P7.1 — open an upload session.
   *
   * The patient check is not written here: the INSERT is subject to a WITH
   * CHECK policy requiring `app_created_patient(patient_id)`. Uploading for
   * another doctor's patient fails at the database, and surfaces as 404 rather
   * than 403 so the endpoint cannot be used to probe which patient ids exist.
   */
  async createSession(input: CreateSessionInput): Promise<{ sessionId: string; expiresAt: Date }> {
    const ctx = requireContext();
    const expiresAt = new Date(Date.now() + this.config.UPLOAD_SESSION_TTL_HOURS * 3_600_000);

    const sessionId = await this.db.tx(async (tx) => {
      try {
        const res = await tx.query<{ id: string }>(
          `INSERT INTO imaging_upload_sessions
             (patient_id, created_by, expected_file_count, expires_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [input.patientId, ctx.userId, input.expectedFileCount, expiresAt],
        );
        const row = res.rows[0];
        if (row === undefined) throw new NotFoundException('Patient not found');
        return row.id;
      } catch (err) {
        if (isRlsViolation(err)) {
          // The caller may not upload for this patient. Do not distinguish
          // "does not exist" from "not yours" (§6).
          throw new NotFoundException('Patient not found');
        }
        throw err;
      }
    });

    return { sessionId, expiresAt };
  }

  /**
   * Register a file, or look up where an existing one left off.
   *
   * Idempotent by (session, clientFileId). A client that lost its local state —
   * browser crash, machine restart (P7.3) — re-registers and is told the
   * resume offset rather than uploading from zero.
   */
  async registerFile(input: RegisterFileInput): Promise<FileUploadState> {
    if (!SHA256_HEX.test(input.sha256)) {
      throw new BadRequestException('sha256 must be 64 lowercase hex characters');
    }
    if (input.sizeBytes < 0) {
      throw new BadRequestException('sizeBytes must not be negative');
    }

    const chunkSize = this.config.UPLOAD_CHUNK_SIZE_BYTES;

    return this.db.tx(async (tx) => {
      await this.assertSessionOpen(tx, input.sessionId);

      const findFile = async (): Promise<FileRow | undefined> =>
        (
          await tx.query<FileRow>(
            `SELECT * FROM imaging_upload_files WHERE session_id = $1 AND client_file_id = $2`,
            [input.sessionId, input.clientFileId],
          )
        ).rows[0];

      let found = await findFile();
      if (found === undefined) {
        // ON CONFLICT: the client retries a registration whose response it
        // lost while the first is still running. Both see no row; without this
        // the second INSERT hit the unique key and answered 500.
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO imaging_upload_files
             (session_id, client_file_id, file_name, size_bytes, client_sha256,
              chunk_size_bytes, content_encoding)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (session_id, client_file_id) DO NOTHING
           RETURNING id`,
          [
            input.sessionId,
            input.clientFileId,
            input.fileName,
            input.sizeBytes,
            input.sha256,
            chunkSize,
            input.contentEncoding ?? 'identity',
          ],
        );
        const row = inserted.rows[0];
        if (row !== undefined) {
          return {
            fileId: row.id,
            receivedBytes: 0,
            nextChunkIndex: 0,
            chunkSizeBytes: chunkSize,
            status: 'pending',
          };
        }
        // The concurrent registration committed first; resume from its row.
        found = await findFile();
        if (found === undefined) throw new NotFoundException('Upload session not found');
      }

      // A file re-registered with DIFFERENT content is a different file. The
      // safe move is to discard what was staged rather than splice new bytes
      // onto an old prefix and produce a file that matches neither checksum.
      if (found.client_sha256 !== input.sha256) {
        await this.blobs.discardStaged(stagingKey(input.sessionId, input.clientFileId));
        await tx.query(
          `UPDATE imaging_upload_files
           SET client_sha256 = $1, size_bytes = $2, received_bytes = 0,
               next_chunk_index = 0, status = 'pending', server_sha256 = NULL,
               failure_reason = NULL, updated_at = now()
           WHERE id = $3`,
          [input.sha256, input.sizeBytes, found.id],
        );
        return {
          fileId: found.id,
          receivedBytes: 0,
          nextChunkIndex: 0,
          chunkSizeBytes: found.chunk_size_bytes,
          status: 'pending',
        };
      }

      return {
        fileId: found.id,
        receivedBytes: Number(found.received_bytes),
        nextChunkIndex: found.next_chunk_index,
        chunkSizeBytes: found.chunk_size_bytes,
        status: found.status,
      };
    });
  }

  /** Current resume point. Called by a client that reconnects. */
  async getFileState(fileId: string): Promise<FileUploadState> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<FileRow>(`SELECT * FROM imaging_upload_files WHERE id = $1`, [
        fileId,
      ]);
      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('Upload file not found');
      return {
        fileId: row.id,
        receivedBytes: Number(row.received_bytes),
        nextChunkIndex: row.next_chunk_index,
        chunkSizeBytes: row.chunk_size_bytes,
        status: row.status,
      };
    });
  }

  /**
   * Accept one chunk.
   *
   * Chunks must arrive in order. An out-of-order chunk is rejected rather than
   * buffered: accepting index 7 when 5 is missing would leave a hole that only
   * the final checksum would catch, after the whole file had been transferred
   * over a link that charges by the megabyte.
   *
   * A REPEATED chunk (index below the next expected) is acknowledged as a
   * no-op. That case is common and benign — the acknowledgement was lost, not
   * the data — and treating it as an error would deadlock a retrying client.
   */
  async appendChunk(
    fileId: string,
    chunkIndex: number,
    data: Uint8Array,
  ): Promise<{ receivedBytes: number; nextChunkIndex: number; duplicate: boolean }> {
    return this.db.tx(async (tx) => {
      // Row lock: two concurrent chunk PUTs for one file would otherwise both
      // read the same next_chunk_index and one would be lost.
      const res = await tx.query<FileRow & { session_id: string; client_file_id: string }>(
        `SELECT f.* FROM imaging_upload_files f WHERE f.id = $1 FOR UPDATE`,
        [fileId],
      );
      const file = res.rows[0];
      if (file === undefined) throw new NotFoundException('Upload file not found');

      await this.assertSessionOpen(tx, file.session_id);

      if (chunkIndex < file.next_chunk_index) {
        return {
          receivedBytes: Number(file.received_bytes),
          nextChunkIndex: file.next_chunk_index,
          duplicate: true,
        };
      }

      if (chunkIndex > file.next_chunk_index) {
        throw new BadRequestException(
          `Chunk out of order: expected index ${file.next_chunk_index}, received ${chunkIndex}`,
        );
      }

      if (Number(file.received_bytes) + data.byteLength > Number(file.size_bytes)) {
        // More bytes than the client declared. Refusing here bounds how much
        // storage one session can consume regardless of what the client does.
        //
        // Safe for gzip too: compressed output is smaller than the original for
        // DICOM (the pixel data dominates and is not already compressed), so
        // the original size is a valid upper bound. A client sending MORE
        // compressed bytes than the original size is either broken or hostile.
        throw new BadRequestException('Chunk exceeds the declared file size');
      }

      await this.blobs.appendChunk(
        stagingKey(file.session_id, file.client_file_id),
        chunkIndex,
        data,
      );

      const updated = await tx.query<{ received_bytes: string; next_chunk_index: number }>(
        `UPDATE imaging_upload_files
         SET received_bytes = received_bytes + $1,
             next_chunk_index = next_chunk_index + 1,
             status = 'uploading',
             updated_at = now()
         WHERE id = $2
         RETURNING received_bytes, next_chunk_index`,
        [data.byteLength, fileId],
      );

      const row = updated.rows[0];
      if (row === undefined) throw new NotFoundException('Upload file not found');
      return {
        receivedBytes: Number(row.received_bytes),
        nextChunkIndex: row.next_chunk_index,
        duplicate: false,
      };
    });
  }

  /**
   * Verify the assembled file against the client's checksum (P7.2).
   *
   * On mismatch the staged bytes are discarded and the file is reset to
   * `pending` so the client retries from zero. It is NOT marked failed
   * permanently: the usual cause is a corrupted transfer, which a retry fixes.
   */
  async completeFile(fileId: string): Promise<{ verified: true; sha256: string }> {
    const { sessionId, clientFileId, expectedSha, sizeBytes, receivedBytes, contentEncoding } =
      await this.db.tx(
      async (tx) => {
        const res = await tx.query<FileRow>(`SELECT * FROM imaging_upload_files WHERE id = $1`, [
          fileId,
        ]);
        const row = res.rows[0];
        if (row === undefined) throw new NotFoundException('Upload file not found');
        return {
          sessionId: row.session_id,
          clientFileId: row.client_file_id,
          expectedSha: row.client_sha256,
          sizeBytes: Number(row.size_bytes),
          receivedBytes: Number(row.received_bytes),
          contentEncoding: row.content_encoding,
        };
      },
    );

    // A gzipped transfer's byte count does not match the original size, so
    // completeness is judged after decoding instead.
    if (contentEncoding === 'identity' && receivedBytes !== sizeBytes) {
      throw new BadRequestException(
        `File is incomplete: ${receivedBytes} of ${sizeBytes} bytes received`,
      );
    }

    const key = stagingKey(sessionId, clientFileId);
    const staged = await this.blobs.readStaged(key);

    // Decode BEFORE hashing: client_sha256 is the digest of the original file
    // (ADR-4). Verifying the compressed bytes would prove only that the gzip
    // survived, not that the DICOM inside it did.
    let bytes: Uint8Array;
    try {
      bytes = contentEncoding === 'gzip' ? new Uint8Array(gunzipSync(staged)) : staged;
    } catch {
      await this.blobs.discardStaged(key);
      await this.resetForRetry(fileId, 'malformed_gzip');
      throw new BadRequestException('Uploaded data could not be decompressed');
    }

    if (bytes.byteLength !== sizeBytes) {
      throw new BadRequestException(
        `File is incomplete: ${bytes.byteLength} of ${sizeBytes} bytes after decoding`,
      );
    }

    const actual = sha256(bytes);

    if (actual !== expectedSha) {
      await this.blobs.discardStaged(key);
      await this.resetForRetry(fileId, 'checksum_mismatch', actual);
      throw new ChecksumMismatchError(expectedSha, actual);
    }

    // Replace the staged payload with the DECODED original, so everything
    // downstream (ingestion, storage, Orthanc) sees the real DICOM bytes and
    // never has to know a transfer encoding was involved.
    if (contentEncoding === 'gzip') {
      await this.blobs.discardStaged(key);
      await this.blobs.appendChunk(key, 0, bytes);
    }

    await this.db.tx(async (tx) => {
      await tx.query(
        `UPDATE imaging_upload_files
         SET status = 'received', server_sha256 = $1, failure_reason = NULL, updated_at = now()
         WHERE id = $2`,
        [actual, fileId],
      );
    });

    return { verified: true, sha256: actual };
  }

  /** Reset a file so the client can retry from zero. */
  private async resetForRetry(
    fileId: string,
    reason: string,
    serverSha?: string,
  ): Promise<void> {
    await this.db.tx(async (tx) => {
      await tx.query(
        `UPDATE imaging_upload_files
         SET status = 'pending', received_bytes = 0, next_chunk_index = 0,
             server_sha256 = $1, failure_reason = $2, updated_at = now()
         WHERE id = $3`,
        [serverSha ?? null, reason, fileId],
      );
    });
  }

  private async assertSessionOpen(
    tx: import('pg').PoolClient,
    sessionId: string,
  ): Promise<void> {
    const res = await tx.query<{ status: string; expires_at: Date }>(
      `SELECT status, expires_at FROM imaging_upload_sessions WHERE id = $1`,
      [sessionId],
    );
    const row = res.rows[0];
    // RLS filters sessions belonging to another doctor, so "not visible" and
    // "does not exist" arrive here identically — which is the intent.
    if (row === undefined) throw new NotFoundException('Upload session not found');
    if (row.status !== 'open') {
      throw new BadRequestException(`Upload session is ${row.status}`);
    }
    if (row.expires_at.getTime() <= Date.now()) {
      throw new BadRequestException('Upload session has expired');
    }
  }
}

interface FileRow {
  id: string;
  session_id: string;
  client_file_id: string;
  file_name: string;
  size_bytes: string;
  client_sha256: string;
  server_sha256: string | null;
  chunk_size_bytes: number;
  received_bytes: string;
  next_chunk_index: number;
  status: string;
  content_encoding: 'identity' | 'gzip';
}

export function stagingKey(sessionId: string, clientFileId: string): string {
  // clientFileId is caller-supplied, so it is hashed rather than placed in a
  // path. A client sending "../../originals/..." must not be able to steer a
  // staging write.
  return `${sessionId}/${sha256(new TextEncoder().encode(clientFileId))}`;
}

function isRlsViolation(err: unknown): boolean {
  // 42501 insufficient_privilege — raised when a WITH CHECK policy rejects a row.
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '42501';
}
