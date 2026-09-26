import { Test } from '@nestjs/testing';
import { Global, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../shared/db/database.service';
import { HealthModule } from './health.module';

/** Stands in for the global DatabaseModule; `ping` is what readiness asks. */
const db = { ping: async (): Promise<boolean> => true };

@Global()
@Module({ providers: [{ provide: DatabaseService, useValue: db }], exports: [DatabaseService] })
class FakeDatabaseModule {}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [FakeDatabaseModule, HealthModule],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok (P1.1 gate)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('exposes nothing beyond the status field', async () => {
    // A health endpoint is unauthenticated. Version strings, hostnames, and
    // dependency states handed out here are free reconnaissance.
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(Object.keys(res.body as object)).toEqual(['status']);
  });
});

describe('GET /health/ready', () => {
  it('is ready when the database answers', async () => {
    db.ping = async () => true;
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('answers 503 when the database is down, and says nothing about why', async () => {
    db.ping = async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
    };
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });
});
