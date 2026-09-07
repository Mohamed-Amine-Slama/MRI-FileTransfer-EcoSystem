import {
  Module,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { raw } from 'express';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
 * BUILD_SPEC P7.1 over HTTP.
 *
 * The P7.1 gate is worded as a STATUS CODE: "creating a session for another
 * doctor's patient -> 404". Until this suite existed, that was asserted as
 * `rejects.toThrow(/not found/i)` against an in-process service call — the
 * authorization was real, but nothing returned 404 because no HTTP transport
 * existed. `apps/web/lib/upload/api-client.ts` had been calling four /uploads
 * endpoints that no controller served.
 *
 * So these drive real HTTP: middleware, guard, controller, service, RLS. The
 * two layers most likely to lose the caller's identity are exactly the two a
 * service-level test skips.
 *
 * Authentication is stubbed with a header-driven guard so the suite does not
 * need a Keycloak; token verification is covered in auth.test.ts.
 */

let h: Harness;
let db: DatabaseService;
let app: INestApplication;
let blobs: LocalBlobStore;
let storageRoot: string;

const CHUNK = 16 * 1024;

/** Stand-in for AuthGuard: trusts two test headers instead of a JWT. */
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
      requestId: 'uploads-e2e',
    });
    return true;
  }
}

const as = (server: unknown, userId: string, role: Role) => {
  const auth = (r: request.Test) => r.set('x-test-user', userId).set('x-test-role', role);
  return {
    get: (url: string) => auth(request(server as never).get(url)),
    post: (url: string) => auth(request(server as never).post(url)),
    put: (url: string) => auth(request(server as never).put(url)),
  };
};

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);
  storageRoot = await mkdtemp(join(tmpdir(), 'mir-uploads-http-'));
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
  // Mirrors main.ts: chunks must arrive as a Buffer, not a parsed body.
  app.use('/uploads/files', raw({ type: 'application/octet-stream', limit: '80mb' }));
  await app.init();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await h?.close();
  if (storageRoot !== undefined) await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

describe('P7.1 upload session over HTTP', () => {
  it('creates a session for the doctor own patient', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);

    const res = await as(app.getHttpServer(), doctor, 'libya_doctor')
      .post('/uploads')
      .send({ patientId: patient, expectedFileCount: 3 })
      .expect(201);

    expect(res.body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("returns 404 -- not 403 -- for another doctor's patient (the P7.1 gate)", async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const patientOfB = await createPatient(h.owner, doctorB);

    const res = await as(app.getHttpServer(), doctorA, 'libya_doctor')
      .post('/uploads')
      .send({ patientId: patientOfB, expectedFileCount: 1 })
      .expect(404);

    // A 403 would confirm the patient id names a real record (BUILD_SPEC §6),
    // and the body must not echo the id back either.
    expect(JSON.stringify(res.body)).not.toContain(patientOfB);

    const rows = await h.owner.query('SELECT id FROM imaging_upload_sessions');
    expect(rows.rowCount).toBe(0);
  });

  it('rejects an unauthenticated session creation', async () => {
    const res = await request(app.getHttpServer() as never)
      .post('/uploads')
      .send({ patientId: randomUUID(), expectedFileCount: 1 });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('rejects a malformed session request with 400', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');

    await as(app.getHttpServer(), doctor, 'libya_doctor')
      .post('/uploads')
      .send({ patientId: 'not-a-uuid', expectedFileCount: 0 })
      .expect(400);
  });
});

describe('P7.2 chunked transfer over HTTP', () => {
  async function openFile(doctor: string, patient: string, body: Buffer) {
    const client = as(app.getHttpServer(), doctor, 'libya_doctor');
    const digest = createHash('sha256').update(body).digest('hex');

    const session = await client
      .post('/uploads')
      .send({ patientId: patient, expectedFileCount: 1 })
      .expect(201);

    const file = await client
      .post(`/uploads/${session.body.sessionId}/files`)
      .send({
        clientFileId: 'f1',
        fileName: 'CT000001.dcm',
        sizeBytes: body.length,
        sha256: digest,
      })
      .expect(201);

    return { client, digest, fileId: file.body.fileId as string, chunkSize: file.body.chunkSizeBytes as number };
  }

  it('round-trips a file: register, chunk, complete, checksum verified', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const body = randomBytes(48 * 1024);

    const { client, digest, fileId, chunkSize } = await openFile(doctor, patient, body);

    for (let i = 0, offset = 0; offset < body.length; i += 1, offset += chunkSize) {
      const chunk = body.subarray(offset, Math.min(offset + chunkSize, body.length));
      await client
        .put(`/uploads/files/${fileId}/chunks/${i}`)
        .set('content-type', 'application/octet-stream')
        .send(chunk)
        .expect(200);
    }

    const done = await client.post(`/uploads/files/${fileId}/complete`).expect(201);
    expect(done.body.sha256).toBe(digest);
    expect(done.body.verified).toBe(true);
  });

  it('reports the resume point from server state', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const body = randomBytes(48 * 1024);

    const { client, fileId, chunkSize } = await openFile(doctor, patient, body);

    await client
      .put(`/uploads/files/${fileId}/chunks/0`)
      .set('content-type', 'application/octet-stream')
      .send(body.subarray(0, chunkSize))
      .expect(200);

    const state = await client.get(`/uploads/files/${fileId}`).expect(200);
    expect(state.body.receivedBytes).toBe(chunkSize);
    expect(state.body.nextChunkIndex).toBe(1);
  });

  it('rejects a file whose bytes do not match the declared checksum', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const body = randomBytes(48 * 1024);

    const { client, fileId, chunkSize } = await openFile(doctor, patient, body);

    // Send the declared number of bytes, but flip one bit in the last chunk.
    // The server recomputes over the assembled bytes and must reject (ADR-4:
    // never accepted, never "repaired").
    for (let i = 0, offset = 0; offset < body.length; i += 1, offset += chunkSize) {
      const chunk = Buffer.from(body.subarray(offset, Math.min(offset + chunkSize, body.length)));
      if (offset + chunkSize >= body.length) corruptByte(chunk, 0);
      await client
        .put(`/uploads/files/${fileId}/chunks/${i}`)
        .set('content-type', 'application/octet-stream')
        .send(chunk)
        .expect(200);
    }

    await client.post(`/uploads/files/${fileId}/complete`).expect(400);
  });

  it('rejects a chunk sent without an octet-stream body', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctor);
    const body = randomBytes(1024);

    const { client, fileId } = await openFile(doctor, patient, body);

    await client
      .put(`/uploads/files/${fileId}/chunks/0`)
      .set('content-type', 'application/json')
      .send({ not: 'bytes' })
      .expect(400);
  });

  it('does not let another doctor register a file against a session they do not own', async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const patient = await createPatient(h.owner, doctorA);

    const session = await as(app.getHttpServer(), doctorA, 'libya_doctor')
      .post('/uploads')
      .send({ patientId: patient, expectedFileCount: 1 })
      .expect(201);

    await as(app.getHttpServer(), doctorB, 'libya_doctor')
      .post(`/uploads/${session.body.sessionId}/files`)
      .send({
        clientFileId: 'x',
        fileName: 'x.dcm',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      })
      .expect(404);
  });
});
