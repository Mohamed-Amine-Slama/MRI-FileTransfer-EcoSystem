import {
  Module,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { raw } from 'express';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@mir/contracts';
import { APP_CONFIG } from '../../shared/config/config.module';
import type { AppConfig } from '../../shared/config/config.schema';
import { DatabaseService } from '../../shared/db/database.service';
import { RequestContextMiddleware } from '../../shared/context/request-context.middleware';
import { setContext } from '../../shared/context/request-context';
import {
  appUrl,
  createPatient,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { GlobalExceptionFilter } from '../../shared/errors/global-exception.filter';
import { LocalBlobStore } from '../../shared/storage/local-blob-store';
import { BLOB_STORE } from '../../shared/storage/storage.module';
import { UploadService } from './internal/upload.service';
import { UploadsController } from './internal/uploads.controller';
import { corruptByte } from '../../shared/testing/corrupt-byte';

/**
 * BUILD_SPEC P7.2 gate:
 * "Do not proceed until you have tested with the network actually severed
 *  mid-upload."
 *
 * The existing P7.2 coverage abandons an in-process service call. That is a
 * cooperative teardown the server is told about. A dropped Libyan mobile link
 * is not: it is an RST, or silence. The difference is exactly the bug class
 * this gate exists to find — a half-written chunk, a server that considers a
 * request complete when the client does not, and a resume offset computed from
 * either one.
 *
 * So a TCP proxy sits between client and API, and mid-transfer both sockets
 * are destroyed: RST, no FIN, no chance for either side to flush.
 *
 * What is under test is the SERVER's resume contract. The client here is
 * deliberately dumb — it holds no state the server relies on, and after the
 * sever it asks the server where to continue from.
 */

let h: Harness;
let db: DatabaseService;
let app: INestApplication;
let blobs: LocalBlobStore;
let storageRoot: string;

// Small chunks so a 2 MiB file produces enough of them for a sever to land
// mid-transfer rather than between files.
const CHUNK = 32 * 1024;

class TestAuthGuard {
  canActivate(context: {
    switchToHttp: () => { getRequest: () => { headers: Record<string, string> } };
  }): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers['x-test-user'];
    const role = req.headers['x-test-role'] as Role | undefined;
    if (userId === undefined || role === undefined) return false;
    setContext({
      userId,
      role,
      ipAddress: '41.208.1.5',
      userAgent: 'vitest',
      requestId: 'severed',
    });
    return true;
  }
}

/**
 * A TCP proxy that can be severed mid-flight.
 *
 * `destroy()` on both sockets sends RST with no FIN. That is what a dropped
 * link looks like at the transport layer, and it is materially different from
 * an aborted fetch, which is a cooperative close the peer is notified of.
 */
class SeverableProxy {
  private server?: Server;
  private readonly sockets = new Set<Socket>();
  port = 0;

  async listen(targetPort: number): Promise<void> {
    this.server = createServer((client) => {
      const upstream = connect(targetPort, '127.0.0.1');
      this.sockets.add(client);
      this.sockets.add(upstream);

      client.pipe(upstream);
      upstream.pipe(client);

      const drop = (): void => {
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      // A severed socket emits ECONNRESET on both ends. Swallow it here: the
      // proxy tearing down is the point, not a failure of the proxy.
      client.on('error', drop);
      upstream.on('error', drop);
      client.on('close', drop);
      upstream.on('close', drop);
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        this.port = typeof addr === 'object' && addr !== null ? addr.port : 0;
        resolve();
      });
    });
  }

  /** Sever every live connection with an RST. */
  sever(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  async close(): Promise<void> {
    this.sever();
    await new Promise<void>((resolve) => {
      if (this.server === undefined) return resolve();
      this.server.close(() => resolve());
    });
  }
}

const authHeaders = (userId: string): Record<string, string> => ({
  'x-test-user': userId,
  'x-test-role': 'libya_doctor',
});

/**
 * Deliberately NOT retrying. A client that retries internally would paper over
 * the severed connection before the test could observe it.
 */
async function postJson<T>(url: string, userId: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(userId) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function getJson<T>(url: string, userId: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(userId) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function putChunk(url: string, userId: string, data: Buffer): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', ...authHeaders(userId) },
    body: new Uint8Array(data),
  });
  if (!res.ok) throw new Error(`PUT ${url} -> ${res.status}`);
}

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 5 } as AppConfig);
  storageRoot = await mkdtemp(join(tmpdir(), 'mir-severed-'));
  blobs = new LocalBlobStore(storageRoot);

  const config = {
    UPLOAD_CHUNK_SIZE_BYTES: CHUNK,
    UPLOAD_SESSION_TTL_HOURS: 72,
  } as AppConfig;

  @Module({
    controllers: [UploadsController],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: DatabaseService, useValue: db },
      { provide: BLOB_STORE, useValue: blobs },
      UploadService,
      Reflector,
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  })
  class TestModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(RequestContextMiddleware).forRoutes('*');
    }
  }

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use('/uploads/files', raw({ type: 'application/octet-stream', limit: '80mb' }));
  await app.init();
  // A real listening socket: the whole point is that bytes cross a TCP
  // connection that can be cut.
  await app.listen(0, '127.0.0.1');
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await h?.close();
  if (storageRoot !== undefined) await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

describe('P7.2 upload survives a severed connection', () => {
  it('resumes from authoritative server state after the link is cut mid-transfer', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);

    // Large enough that severing lands mid-transfer, small enough to keep the
    // suite fast.
    const body = randomBytes(2 * 1024 * 1024);
    const digest = createHash('sha256').update(body).digest('hex');

    const apiAddress = app.getHttpServer().address();
    const apiPort = typeof apiAddress === 'object' && apiAddress !== null ? apiAddress.port : 0;
    expect(apiPort).toBeGreaterThan(0);

    const proxy = new SeverableProxy();
    await proxy.listen(apiPort);
    const base = `http://127.0.0.1:${proxy.port}`;

    try {
      const session = await postJson<{ sessionId: string }>(`${base}/uploads`, doctor, {
        patientId: patient,
        expectedFileCount: 1,
      });

      const file = await postJson<{ fileId: string; chunkSizeBytes: number }>(
        `${base}/uploads/${session.sessionId}/files`,
        doctor,
        {
          clientFileId: 'severed-1',
          fileName: 'CT000001.dcm',
          sizeBytes: body.length,
          sha256: digest,
        },
      );

      const chunkSize = file.chunkSizeBytes;
      const totalChunks = Math.ceil(body.length / chunkSize);
      const severAfter = Math.floor(totalChunks * 0.4);

      let bytesSentBeforeSever = 0;
      let severedError: unknown;

      // --- first attempt: send until the link is cut ------------------------
      try {
        for (let i = 0; i < totalChunks; i += 1) {
          if (i === severAfter) proxy.sever();
          const chunk = Buffer.from(body.subarray(i * chunkSize, (i + 1) * chunkSize));
          await putChunk(`${base}/uploads/files/${file.fileId}/chunks/${i}`, doctor, chunk);
          bytesSentBeforeSever += chunk.length;
        }
      } catch (err) {
        severedError = err;
      }

      // The gate is about a TRANSPORT failure, not an application error. A
      // 4xx here would mean the request was received and rejected, which is a
      // different thing entirely.
      expect(severedError).toBeDefined();
      expect(String(severedError)).toMatch(
        /ECONNRESET|socket hang up|fetch failed|ECONNREFUSED|terminated|other side closed/i,
      );

      // --- resume: ask the server where it actually got to ------------------
      // A fresh proxy, because the old connections are gone. This is the
      // client reconnecting after the link came back.
      await proxy.close();
      const resumed = new SeverableProxy();
      await resumed.listen(apiPort);
      const base2 = `http://127.0.0.1:${resumed.port}`;

      try {
        const state = await getJson<{ receivedBytes: number; nextChunkIndex: number }>(
          `${base2}/uploads/files/${file.fileId}`,
          doctor,
        );

        // Some progress survived, and not all of it — otherwise the sever
        // landed outside the transfer and this test proved nothing.
        expect(state.receivedBytes).toBeGreaterThan(0);
        expect(state.receivedBytes).toBeLessThan(body.length);

        let bytesResent = 0;
        for (let i = state.nextChunkIndex; i < totalChunks; i += 1) {
          const chunk = Buffer.from(body.subarray(i * chunkSize, (i + 1) * chunkSize));
          await putChunk(`${base2}/uploads/files/${file.fileId}/chunks/${i}`, doctor, chunk);
          bytesResent += chunk.length;
        }

        const done = await postJson<{ verified: boolean; sha256: string }>(
          `${base2}/uploads/files/${file.fileId}/complete`,
          doctor,
          {},
        );

        // --- the three things the gate requires -----------------------------

        // 1. Integrity: the assembled file matches the original, byte for byte.
        expect(done.sha256).toBe(digest);
        expect(done.verified).toBe(true);

        // 2. Resume is materially cheaper than starting over. The spec says to
        //    ASSERT this, not merely observe it.
        expect(bytesResent).toBeLessThan(body.length * 0.75);

        // 3. The whole transfer cost materially less than two full uploads,
        //    which is what a client that restarted from zero would have paid.
        expect(bytesSentBeforeSever + bytesResent).toBeLessThan(body.length * 1.5);
      } finally {
        await resumed.close();
      }
    } finally {
      await proxy.close();
    }
  }, 120_000);

  it('does not accept a resumed file whose bytes diverge from the declared checksum', async () => {
    // A severed link that resumes with the WRONG bytes must still be caught.
    // Resume is only safe because the checksum is verified over the assembled
    // whole, not per chunk (ADR-4).
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);

    const body = randomBytes(512 * 1024);
    const digest = createHash('sha256').update(body).digest('hex');

    const apiAddress = app.getHttpServer().address();
    const apiPort = typeof apiAddress === 'object' && apiAddress !== null ? apiAddress.port : 0;
    const proxy = new SeverableProxy();
    await proxy.listen(apiPort);
    const base = `http://127.0.0.1:${proxy.port}`;

    try {
      const session = await postJson<{ sessionId: string }>(`${base}/uploads`, doctor, {
        patientId: patient,
        expectedFileCount: 1,
      });
      const file = await postJson<{ fileId: string; chunkSizeBytes: number }>(
        `${base}/uploads/${session.sessionId}/files`,
        doctor,
        {
          clientFileId: 'severed-2',
          fileName: 'CT000002.dcm',
          sizeBytes: body.length,
          sha256: digest,
        },
      );

      const chunkSize = file.chunkSizeBytes;
      const totalChunks = Math.ceil(body.length / chunkSize);

      for (let i = 0; i < totalChunks; i += 1) {
        const chunk = Buffer.from(body.subarray(i * chunkSize, (i + 1) * chunkSize));
        // Corrupt a chunk in the second half, as a flaky link would.
        if (i === totalChunks - 2) corruptByte(chunk, 0);
        await putChunk(`${base}/uploads/files/${file.fileId}/chunks/${i}`, doctor, chunk);
      }

      const res = await fetch(`${base}/uploads/files/${file.fileId}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(doctor) },
        body: '{}',
      });

      // Rejected as bad input, not as a server fault.
      expect(res.status).toBe(400);
    } finally {
      await proxy.close();
    }
  }, 120_000);
});
