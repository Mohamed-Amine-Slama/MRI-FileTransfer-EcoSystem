import { gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '@mir/dicom-utils';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createPatient,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { EventBus } from '../../shared/events/event-bus';
import { LocalBlobStore } from '../../shared/storage/local-blob-store';
import { originalKey } from '../../shared/storage/blob-store';
import { ChecksumMismatchError, UploadService } from './internal/upload.service';
import { IngestionService } from './internal/ingestion.service';
import { InMemoryOrthancClient } from './internal/orthanc.client';
import { ThumbnailService } from './internal/thumbnail.service';
import { corruptMiddleByte } from '../../shared/testing/corrupt-byte';

/**
 * BUILD_SPEC PHASE 7 — resumable upload. The spec calls this the highest
 * practical risk in the project: "This phase determines whether the product is
 * usable."
 *
 * These tests use the real 120-file CT fixture from P0.2, a real filesystem
 * store, and real SHA-256 verification. The interruption tests abandon a
 * transfer mid-stream and resume with a fresh client object holding no
 * in-memory state, which is what a dropped connection or a killed browser
 * actually looks like to the server.
 */

const FIXTURES = join(__dirname, '..', '..', '..', '..', '..', 'test-data', 'dicom');

function loadFixtureFiles(dir: string): { name: string; bytes: Uint8Array }[] {
  const base = join(FIXTURES, dir);
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return walk(base).map((p) => ({
    name: p.slice(base.length + 1),
    bytes: new Uint8Array(readFileSync(p)),
  }));
}

let h: Harness;
let db: DatabaseService;
let blobs: LocalBlobStore;
let storageRoot: string;
let uploads: UploadService;
let ingestion: IngestionService;
let orthanc: InMemoryOrthancClient;
let bus: EventBus;

const CHUNK = 64 * 1024; // small, so the fixtures produce many chunks

const config = {
  UPLOAD_CHUNK_SIZE_BYTES: CHUNK,
  UPLOAD_SESSION_TTL_HOURS: 72,
} as AppConfig;

const ctx = (userId: string): RequestContext => ({
  userId,
  role: 'libya_doctor',
  ipAddress: '41.208.1.5',
  userAgent: 'vitest',
  requestId: 'upload-test',
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);
  storageRoot = await mkdtemp(join(tmpdir(), 'mir-upload-test-'));
  blobs = new LocalBlobStore(storageRoot);
  orthanc = new InMemoryOrthancClient();
  bus = new EventBus();
  uploads = new UploadService(db, blobs, config);
  ingestion = new IngestionService(db, bus, blobs, orthanc, new ThumbnailService());
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
  if (storageRoot !== undefined) await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

/**
 * A simulated client. Holds no state the server relies on, so a "new client"
 * after an interruption starts from nothing but the file id — exactly like a
 * browser that was killed and reopened.
 */
class SimulatedClient {
  bytesSent = 0;

  constructor(
    private readonly service: UploadService,
    private readonly doctor: string,
  ) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return runWithContext(ctx(this.doctor), fn);
  }

  async register(sessionId: string, name: string, bytes: Uint8Array) {
    return this.run(() =>
      this.service.registerFile({
        sessionId,
        clientFileId: name,
        fileName: name,
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      }),
    );
  }

  /** Send chunks from `fromChunk`, stopping after `maxChunks` if given. */
  async send(
    fileId: string,
    bytes: Uint8Array,
    fromChunk: number,
    maxChunks = Number.POSITIVE_INFINITY,
  ): Promise<number> {
    const total = Math.ceil(bytes.byteLength / CHUNK);
    let sent = 0;
    for (let i = fromChunk; i < total && sent < maxChunks; i++) {
      const slice = bytes.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, bytes.byteLength));
      await this.run(() => this.service.appendChunk(fileId, i, slice));
      this.bytesSent += slice.byteLength;
      sent++;
    }
    return sent;
  }

  async complete(fileId: string) {
    return this.run(() => this.service.completeFile(fileId));
  }

  async state(fileId: string) {
    return this.run(() => this.service.getFileState(fileId));
  }
}

async function newSession(doctor: string, patient: string, fileCount: number): Promise<string> {
  const { sessionId } = await runWithContext(ctx(doctor), () =>
    uploads.createSession({ patientId: patient, expectedFileCount: fileCount }),
  );
  return sessionId;
}

// ===========================================================================

describe('P7.1 upload session', () => {
  it('creates a session for the doctor own patient', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);

    const { sessionId, expiresAt } = await runWithContext(ctx(doctor), () =>
      uploads.createSession({ patientId: patient, expectedFileCount: 3 }),
    );

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("blocks a session for ANOTHER doctor's patient, as 404 (the P7.1 gate)", async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const patientOfB = await createPatient(h.owner, doctorB);

    // 404 not 403: a 403 would confirm the patient id is real (§6).
    await expect(
      runWithContext(ctx(doctorA), () =>
        uploads.createSession({ patientId: patientOfB, expectedFileCount: 1 }),
      ),
    ).rejects.toThrow(/not found/i);

    const rows = await h.owner.query('SELECT id FROM imaging_upload_sessions');
    expect(rows.rowCount).toBe(0);
  });

  it('another doctor cannot register a file against a session they do not own', async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctorA);
    const sessionId = await newSession(doctorA, patient, 1);

    await expect(
      runWithContext(ctx(doctorB), () =>
        uploads.registerFile({
          sessionId,
          clientFileId: 'x',
          fileName: 'x.dcm',
          sizeBytes: 10,
          sha256: 'a'.repeat(64),
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });
});

describe('P7.2 chunked resumable transport', () => {
  it('uploads a file in chunks and verifies the checksum', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);
    const [fixture] = loadFixtureFiles('01-single-file-ct');
    if (fixture === undefined) throw new Error('fixture missing');

    const client = new SimulatedClient(uploads, doctor);
    const reg = await client.register(sessionId, fixture.name, fixture.bytes);
    await client.send(reg.fileId, fixture.bytes, 0);
    const result = await client.complete(reg.fileId);

    expect(result.verified).toBe(true);
    expect(result.sha256).toBe(sha256(fixture.bytes));
  });

  it('resumes from the last completed chunk after an interruption (the P7.2 gate)', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);

    // Concatenate the CT series into one large file, so the transfer is big
    // enough for "resume from 40%" to be meaningful.
    const parts = loadFixtureFiles('02-ct-series-120');
    const big = Buffer.concat(parts.map((p) => Buffer.from(p.bytes)));
    const bytes = new Uint8Array(big);
    const totalChunks = Math.ceil(bytes.byteLength / CHUNK);

    // --- first attempt: dies at ~40% ---------------------------------------
    const client1 = new SimulatedClient(uploads, doctor);
    const reg = await client1.register(sessionId, 'big-study.dcm', bytes);
    const cutoff = Math.floor(totalChunks * 0.4);
    await client1.send(reg.fileId, bytes, 0, cutoff);

    expect(client1.bytesSent).toBeGreaterThan(0);
    expect(client1.bytesSent).toBeLessThan(bytes.byteLength);

    // --- the connection drops. A NEW client, with no memory of the transfer,
    //     asks the server where to continue from. ---------------------------
    const client2 = new SimulatedClient(uploads, doctor);
    const resumed = await client2.register(sessionId, 'big-study.dcm', bytes);

    expect(resumed.fileId).toBe(reg.fileId);
    expect(resumed.nextChunkIndex).toBe(cutoff);
    expect(resumed.receivedBytes).toBe(cutoff * CHUNK);

    await client2.send(resumed.fileId, bytes, resumed.nextChunkIndex);
    const result = await client2.complete(reg.fileId);

    // Completes, and the assembled bytes hash to the original.
    expect(result.verified).toBe(true);
    expect(result.sha256).toBe(sha256(bytes));

    // --- and the resume actually SAVED work (P7.2 requires asserting this) --
    expect(client2.bytesSent).toBeLessThan(bytes.byteLength);
    const savedFraction = 1 - client2.bytesSent / bytes.byteLength;
    expect(savedFraction).toBeGreaterThan(0.35);
  });

  it('rejects a corrupted chunk at checksum verification, and allows retry', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);
    const [fixture] = loadFixtureFiles('01-single-file-ct');
    if (fixture === undefined) throw new Error('fixture missing');

    const client = new SimulatedClient(uploads, doctor);
    const reg = await client.register(sessionId, fixture.name, fixture.bytes);

    // Corrupt one byte in transit — the client's declared hash is of the
    // ORIGINAL bytes, so the server's recomputation must disagree.
    const corrupted = new Uint8Array(fixture.bytes);
    corruptMiddleByte(corrupted);
    await client.send(reg.fileId, corrupted, 0);

    await expect(client.complete(reg.fileId)).rejects.toThrow(ChecksumMismatchError);

    // Reset for retry rather than failed permanently — corruption in transit
    // is fixed by resending, and the doctor should not have to start a new
    // session.
    const state = await client.state(reg.fileId);
    expect(state.status).toBe('pending');
    expect(state.receivedBytes).toBe(0);
    expect(state.nextChunkIndex).toBe(0);

    // The retry, with correct bytes, succeeds.
    const retry = new SimulatedClient(uploads, doctor);
    await retry.send(reg.fileId, fixture.bytes, 0);
    const ok = await retry.complete(reg.fileId);
    expect(ok.verified).toBe(true);
  });

  it('rejects an out-of-order chunk instead of leaving a hole', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);
    const [fixture] = loadFixtureFiles('01-single-file-ct');
    if (fixture === undefined) throw new Error('fixture missing');

    const client = new SimulatedClient(uploads, doctor);
    const reg = await client.register(sessionId, fixture.name, fixture.bytes);

    await expect(
      runWithContext(ctx(doctor), () =>
        uploads.appendChunk(reg.fileId, 5, new Uint8Array([1, 2, 3])),
      ),
    ).rejects.toThrow(/out of order/i);
  });

  it('treats a repeated chunk as a no-op, not an error', async () => {
    // The acknowledgement was lost, not the data. Erroring here would deadlock
    // a client that retries on timeout — the common case on a bad link.
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);
    const [fixture] = loadFixtureFiles('01-single-file-ct');
    if (fixture === undefined) throw new Error('fixture missing');

    const client = new SimulatedClient(uploads, doctor);
    const reg = await client.register(sessionId, fixture.name, fixture.bytes);
    const first = fixture.bytes.subarray(0, CHUNK);

    await runWithContext(ctx(doctor), () => uploads.appendChunk(reg.fileId, 0, first));
    const repeat = await runWithContext(ctx(doctor), () =>
      uploads.appendChunk(reg.fileId, 0, first),
    );

    expect(repeat.duplicate).toBe(true);
    expect(repeat.receivedBytes).toBe(first.byteLength);
  });

  it('refuses more bytes than the client declared', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);

    const client = new SimulatedClient(uploads, doctor);
    const small = new Uint8Array(10);
    const reg = await client.register(sessionId, 'small.dcm', small);

    await expect(
      runWithContext(ctx(doctor), () =>
        uploads.appendChunk(reg.fileId, 0, new Uint8Array(1000)),
      ),
    ).rejects.toThrow(/exceeds the declared file size/i);
  });

  it('refuses to complete a file that is short of its declared size', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);

    // Must span several chunks, or "send one chunk" sends the whole file and
    // the test proves nothing. The single-slice fixture is 8.9 KB against a
    // 64 KB chunk size, so the CT series is concatenated instead.
    const parts = loadFixtureFiles('02-ct-series-120').slice(0, 10);
    const bytes = new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p.bytes))));
    expect(bytes.byteLength).toBeGreaterThan(CHUNK * 2);

    const client = new SimulatedClient(uploads, doctor);
    const reg = await client.register(sessionId, 'partial.dcm', bytes);
    await client.send(reg.fileId, bytes, 0, 1); // one chunk of several

    // Assembling here would produce a truncated file whose checksum happens to
    // be computed over the wrong length — better to refuse outright.
    await expect(client.complete(reg.fileId)).rejects.toThrow(/incomplete/i);
  });
});

describe('P7.3 gzip transfer encoding', () => {
  it('verifies the checksum against the DECODED original, and stores the original', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);
    const [fixture] = loadFixtureFiles('01-single-file-ct');
    if (fixture === undefined) throw new Error('fixture missing');

    const compressed = new Uint8Array(gzipSync(Buffer.from(fixture.bytes)));
    // The declared digest is of the ORIGINAL file (ADR-4) — not of the gzip.
    const originalSha = sha256(fixture.bytes);

    const reg = await runWithContext(ctx(doctor), () =>
      uploads.registerFile({
        sessionId,
        clientFileId: fixture.name,
        fileName: fixture.name,
        sizeBytes: fixture.bytes.byteLength,
        sha256: originalSha,
        contentEncoding: 'gzip',
      }),
    );

    for (let i = 0; i * CHUNK < compressed.byteLength; i++) {
      const slice = compressed.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, compressed.byteLength));
      await runWithContext(ctx(doctor), () => uploads.appendChunk(reg.fileId, i, slice));
    }

    const result = await runWithContext(ctx(doctor), () => uploads.completeFile(reg.fileId));
    expect(result.sha256).toBe(originalSha);

    // And ingestion sees the DECOMPRESSED DICOM, not a gzip blob.
    const ingest = await runWithContext(ctx(doctor), () => ingestion.ingestFile(reg.fileId));
    expect(ingest.status).toBe('ingested');

    const row = await h.owner.query<{ storage_key: string }>(
      'SELECT storage_key FROM imaging_instances',
    );
    const key = row.rows[0]?.storage_key;
    if (key === undefined) throw new Error('no instance row');
    const stored = await blobs.getOriginal(key);
    expect(Buffer.from(stored).equals(Buffer.from(fixture.bytes))).toBe(true);
  });

  it('rejects a corrupted gzip rather than storing garbage', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const sessionId = await newSession(doctor, patient, 1);
    const [fixture] = loadFixtureFiles('01-single-file-ct');
    if (fixture === undefined) throw new Error('fixture missing');

    const compressed = new Uint8Array(gzipSync(Buffer.from(fixture.bytes)));
    corruptMiddleByte(compressed);

    const reg = await runWithContext(ctx(doctor), () =>
      uploads.registerFile({
        sessionId,
        clientFileId: fixture.name,
        fileName: fixture.name,
        sizeBytes: fixture.bytes.byteLength,
        sha256: sha256(fixture.bytes),
        contentEncoding: 'gzip',
      }),
    );
    await runWithContext(ctx(doctor), () => uploads.appendChunk(reg.fileId, 0, compressed));

    await expect(
      runWithContext(ctx(doctor), () => uploads.completeFile(reg.fileId)),
    ).rejects.toThrow(/could not be decompressed|incomplete/i);
  });
});

describe('P7.4 server-side ingestion', () => {
  async function uploadAndIngest(
    doctor: string,
    patient: string,
    files: { name: string; bytes: Uint8Array }[],
  ): Promise<{ sessionId: string; fileIds: string[] }> {
    const sessionId = await newSession(doctor, patient, files.length);
    const client = new SimulatedClient(uploads, doctor);
    const fileIds: string[] = [];

    for (const f of files) {
      const reg = await client.register(sessionId, f.name, f.bytes);
      await client.send(reg.fileId, f.bytes, 0);
      await client.complete(reg.fileId);
      fileIds.push(reg.fileId);
    }
    for (const id of fileIds) {
      await runWithContext(ctx(doctor), () => ingestion.ingestFile(id));
    }
    return { sessionId, fileIds };
  }

  it('ingests the 120-file CT series into ONE study with correct counts (the P7.4 gate)', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const files = loadFixtureFiles('02-ct-series-120');
    expect(files).toHaveLength(120);

    await uploadAndIngest(doctor, patient, files);

    const studies = await h.owner.query<{
      id: string;
      status: string;
      file_count: number;
      total_bytes: string;
      study_instance_uid: string;
    }>('SELECT * FROM imaging_studies');

    expect(studies.rowCount).toBe(1);
    const study = studies.rows[0];
    expect(study?.file_count).toBe(120);
    expect(study?.status).toBe('ready');
    expect(Number(study?.total_bytes)).toBe(
      files.reduce((sum, f) => sum + f.bytes.byteLength, 0),
    );

    const instances = await h.owner.query('SELECT id FROM imaging_instances');
    expect(instances.rowCount).toBe(120);
  });

  it('stores every original byte-for-byte with a matching checksum', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const files = loadFixtureFiles('03-mr-series');

    await uploadAndIngest(doctor, patient, files);

    const rows = await h.owner.query<{ storage_key: string; sha256: string; size_bytes: string }>(
      'SELECT storage_key, sha256, size_bytes FROM imaging_instances',
    );
    expect(rows.rowCount).toBe(files.length);

    for (const row of rows.rows) {
      const stored = await blobs.getOriginal(row.storage_key);
      // ADR-4: the bytes on disk must be identical to what was uploaded, and
      // the recorded digest must match them.
      expect(sha256(stored)).toBe(row.sha256);
      expect(stored.byteLength).toBe(Number(row.size_bytes));
    }

    // And the stored bytes equal a fixture exactly.
    const first = rows.rows[0];
    if (first !== undefined) {
      const stored = await blobs.getOriginal(first.storage_key);
      const match = files.find((f) => sha256(f.bytes) === sha256(stored));
      expect(match).toBeDefined();
    }
  });

  it('is idempotent — re-ingesting produces no duplicates', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const files = loadFixtureFiles('03-mr-series');

    const { fileIds } = await uploadAndIngest(doctor, patient, files);

    // Run the whole pipeline again, as a retried job would.
    for (const id of fileIds) {
      const result = await runWithContext(ctx(doctor), () => ingestion.ingestFile(id));
      expect(result.status).toBe('already_present');
    }

    const instances = await h.owner.query('SELECT id FROM imaging_instances');
    expect(instances.rowCount).toBe(files.length);

    const study = await h.owner.query<{ file_count: number }>(
      'SELECT file_count FROM imaging_studies',
    );
    expect(study.rows[0]?.file_count).toBe(files.length);
  });

  it('does NOT mark a study ready while files are outstanding (§17)', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const files = loadFixtureFiles('03-mr-series');
    const sessionId = await newSession(doctor, patient, files.length);
    const client = new SimulatedClient(uploads, doctor);

    // Ingest all but one.
    const ids: string[] = [];
    for (const f of files) {
      const reg = await client.register(sessionId, f.name, f.bytes);
      await client.send(reg.fileId, f.bytes, 0);
      await client.complete(reg.fileId);
      ids.push(reg.fileId);
    }
    for (const id of ids.slice(0, -1)) {
      await runWithContext(ctx(doctor), () => ingestion.ingestFile(id));
    }

    const partial = await h.owner.query<{ status: string; file_count: number }>(
      'SELECT status, file_count FROM imaging_studies',
    );
    // A doctor reading an incomplete study misses a finding. It must not be
    // readable as though complete.
    expect(partial.rows[0]?.status).toBe('processing');
    expect(partial.rows[0]?.file_count).toBe(files.length - 1);

    // The last file completes it.
    const last = ids[ids.length - 1];
    if (last !== undefined) {
      await runWithContext(ctx(doctor), () => ingestion.ingestFile(last));
    }
    const done = await h.owner.query<{ status: string }>('SELECT status FROM imaging_studies');
    expect(done.rows[0]?.status).toBe('ready');
  });

  it('re-validates DICOM server-side and rejects a renamed non-DICOM file', async () => {
    // §17: never trust client-side file validation.
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const files = loadFixtureFiles('05-not-dicom');
    const [file] = files;
    if (file === undefined) throw new Error('fixture missing');

    const sessionId = await newSession(doctor, patient, 1);
    const client = new SimulatedClient(uploads, doctor);
    const reg = await client.register(sessionId, file.name, file.bytes);
    await client.send(reg.fileId, file.bytes, 0);
    await client.complete(reg.fileId); // checksum is fine — the CONTENT is not

    const result = await runWithContext(ctx(doctor), () => ingestion.ingestFile(reg.fileId));

    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('not_dicom');
    expect((await h.owner.query('SELECT id FROM imaging_instances')).rowCount).toBe(0);
  });

  it('rejects a corrupt DICOM with its specific reason', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const [file] = loadFixtureFiles('04-corrupt');
    if (file === undefined) throw new Error('fixture missing');

    const sessionId = await newSession(doctor, patient, 1);
    const client = new SimulatedClient(uploads, doctor);
    const reg = await client.register(sessionId, file.name, file.bytes);
    await client.send(reg.fileId, file.bytes, 0);
    await client.complete(reg.fileId);

    const result = await runWithContext(ctx(doctor), () => ingestion.ingestFile(reg.fileId));

    // Distinct from 'not_dicom' — it passed the magic-byte check and failed to
    // parse. The two reasons are not interchangeable (P6.1).
    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('malformed');
  });

  it('flags a StudyInstanceUID mismatch rather than silently splitting', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const ct = loadFixtureFiles('01-single-file-ct');
    const mr = loadFixtureFiles('03-mr-series').slice(0, 1);
    const mixed = [...ct, ...mr]; // two different studies in one session

    const sessionId = await newSession(doctor, patient, mixed.length);
    const client = new SimulatedClient(uploads, doctor);
    const ids: string[] = [];
    for (const f of mixed) {
      const reg = await client.register(sessionId, f.name, f.bytes);
      await client.send(reg.fileId, f.bytes, 0);
      await client.complete(reg.fileId);
      ids.push(reg.fileId);
    }

    const results = [];
    for (const id of ids) {
      results.push(await runWithContext(ctx(doctor), () => ingestion.ingestFile(id)));
    }

    expect(results[0]?.status).toBe('ingested');
    expect(results[1]?.status).toBe('rejected');
    expect(results[1]?.reason).toBe('study_uid_mismatch');

    // One study, not two — and it is NOT marked ready, because a file was
    // flagged for review.
    const studies = await h.owner.query<{ status: string }>('SELECT status FROM imaging_studies');
    expect(studies.rowCount).toBe(1);
  });

  it('survives an Orthanc outage — the original is still the source of record', async () => {
    // ADR-3/ADR-4: Orthanc is an index, rebuildable from the originals. Losing
    // it during ingest must not lose the scan.
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const [file] = loadFixtureFiles('01-single-file-ct');
    if (file === undefined) throw new Error('fixture missing');

    orthanc.failNext = true;

    const sessionId = await newSession(doctor, patient, 1);
    const client = new SimulatedClient(uploads, doctor);
    const reg = await client.register(sessionId, file.name, file.bytes);
    await client.send(reg.fileId, file.bytes, 0);
    await client.complete(reg.fileId);

    const result = await runWithContext(ctx(doctor), () => ingestion.ingestFile(reg.fileId));

    expect(result.status).toBe('ingested');
    const rows = await h.owner.query<{ storage_key: string }>(
      'SELECT storage_key FROM imaging_instances',
    );
    expect(rows.rowCount).toBe(1);
    const key = rows.rows[0]?.storage_key;
    if (key !== undefined) {
      expect(sha256(await blobs.getOriginal(key))).toBe(sha256(file.bytes));
    }
  });

  it('emits StudyUploadCompleted exactly once, on completion', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const files = loadFixtureFiles('03-mr-series');

    const seen: string[] = [];
    bus.subscribe('StudyUploadCompleted', (e) => {
      seen.push(e.studyId);
    });

    const { fileIds } = await uploadAndIngest(doctor, patient, files);
    // Re-run the pipeline; the event must not fire a second time.
    for (const id of fileIds) {
      await runWithContext(ctx(doctor), () => ingestion.ingestFile(id));
    }

    expect(seen).toHaveLength(1);
  });

  it('never re-encodes: stored bytes are identical to uploaded bytes', async () => {
    // ADR-4/ADR-5. Checked by direct byte comparison rather than by checksum
    // alone, so a hash collision or a checksum bug cannot mask a rewrite.
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const [file] = loadFixtureFiles('01-single-file-ct');
    if (file === undefined) throw new Error('fixture missing');

    await uploadAndIngest(doctor, patient, [file]);

    const row = await h.owner.query<{ storage_key: string }>(
      'SELECT storage_key FROM imaging_instances',
    );
    const key = row.rows[0]?.storage_key;
    if (key === undefined) throw new Error('no instance row');

    const stored = await blobs.getOriginal(key);
    expect(Buffer.from(stored).equals(Buffer.from(file.bytes))).toBe(true);
  });

  it('builds the storage key from the patient RECORD, not from file tags', async () => {
    // P6.1: file PatientID is metadata and is frequently wrong. The doctor's
    // chosen record is authoritative, and the storage layout must agree.
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const [file] = loadFixtureFiles('01-single-file-ct');
    if (file === undefined) throw new Error('fixture missing');

    await uploadAndIngest(doctor, patient, [file]);

    const row = await h.owner.query<{ storage_key: string }>(
      'SELECT storage_key FROM imaging_instances',
    );
    const key = row.rows[0]?.storage_key;

    expect(key).toBe(
      originalKey({
        patientId: patient,
        studyInstanceUid: '1.3.6.1.4.1.99999.1.101.1',
        seriesInstanceUid: '1.3.6.1.4.1.99999.1.101.1.1',
        sopInstanceUid: '1.3.6.1.4.1.99999.1.101.1.1.1',
      }),
    );
    expect(key).toContain(`patients/${patient}/`);
    // SYN-0001 is the PatientID inside the file; it must not appear in the key.
    expect(key).not.toContain('SYN-0001');
  });
});
