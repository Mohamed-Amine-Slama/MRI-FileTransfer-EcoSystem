import { Module, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@mir/contracts';
import { APP_CONFIG } from '../../shared/config/config.module';
import type { AppConfig } from '../../shared/config/config.schema';
import { DatabaseService } from '../../shared/db/database.service';
import { EventBus } from '../../shared/events/event-bus';
import { RequestContextMiddleware } from '../../shared/context/request-context.middleware';
import { setContext } from '../../shared/context/request-context';
import {
  appUrl,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { GlobalExceptionFilter } from '../../shared/errors/global-exception.filter';
import { REQUIRES_ROLE_KEY } from '../../shared/authz/access-metadata';
import { PatientsController } from './internal/patients.controller';
import { PatientsService } from './internal/patients.service';

/**
 * BUILD_SPEC P5.1 — "the RLS tests from P3.2 still pass through the HTTP
 * layer, not just at the SQL layer", and P5.2 — the claim flow.
 *
 * These drive real HTTP against a real database. The point is that isolation
 * is proven along the path a request actually takes: middleware, guard,
 * controller, service, RLS. A service-level test would skip the two layers
 * most likely to lose the identity.
 *
 * Authentication is stubbed with a header-driven guard so the suite does not
 * need a Keycloak; token verification itself is covered in auth.test.ts.
 */

let h: Harness;
let db: DatabaseService;
let app: INestApplication;

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
      requestId: 'e2e',
    });
    return true;
  }
}

const as = (server: unknown, userId: string, role: Role) => ({
  get: (url: string) =>
    request(server as never)
      .get(url)
      .set('x-test-user', userId)
      .set('x-test-role', role),
  post: (url: string) =>
    request(server as never)
      .post(url)
      .set('x-test-user', userId)
      .set('x-test-role', role),
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);

  @Module({
    controllers: [PatientsController],
    providers: [
      { provide: APP_CONFIG, useValue: {} as AppConfig },
      { provide: DatabaseService, useValue: db },
      EventBus,
      PatientsService,
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
  await app.init();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

const NEW_PATIENT = {
  phoneE164: '+218912345678',
  fullName: 'محمد علي',
  dateOfBirth: '1985-06-15',
  sex: 'M' as const,
};

describe('P5.1 patients over HTTP', () => {
  it('creates a patient and lists it back', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const server = app.getHttpServer();

    const created = await as(server, doctor, 'libya_doctor')
      .post('/patients')
      .send(NEW_PATIENT)
      .expect(200);

    expect(created.body.kind).toBe('created');

    const listed = await as(server, doctor, 'libya_doctor').get('/patients').expect(200);
    expect(listed.body.patients).toHaveLength(1);
    expect(listed.body.patients[0].fullName).toBe('محمد علي');
  });

  it('isolates two doctors end-to-end (the P5.1 gate)', async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const server = app.getHttpServer();

    const created = await as(server, doctorA, 'libya_doctor')
      .post('/patients')
      .send(NEW_PATIENT)
      .expect(200);
    const patientId = created.body.patientId as string;

    // B lists: sees nothing.
    const bList = await as(server, doctorB, 'libya_doctor').get('/patients').expect(200);
    expect(bList.body.patients).toHaveLength(0);

    // B fetches A's patient by id: 404, NOT 403. A 403 would confirm the
    // record exists (§6).
    await as(server, doctorB, 'libya_doctor').get(`/patients/${patientId}`).expect(404);

    // A can still see it — otherwise this passes against a broken-for-everyone policy.
    await as(server, doctorA, 'libya_doctor').get(`/patients/${patientId}`).expect(200);
  });

  it('does not leak existence through the search endpoint either', async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const server = app.getHttpServer();

    await as(server, doctorA, 'libya_doctor').post('/patients').send(NEW_PATIENT).expect(200);

    const search = await as(server, doctorB, 'libya_doctor')
      .get(`/patients/search?phone=${encodeURIComponent(NEW_PATIENT.phoneE164)}`)
      .expect(200);

    // Doctor B searching A's patient's phone gets nothing back — so the search
    // endpoint cannot be used to enumerate other doctors' patients.
    expect(search.body.candidates).toHaveLength(0);
  });

  describe('P3.3 identity matching over HTTP', () => {
    it('returns confirmation_required on a phone match instead of merging', async () => {
      const doctor = await createUser(h.owner, 'libya_doctor');
      const server = app.getHttpServer();

      await as(server, doctor, 'libya_doctor').post('/patients').send(NEW_PATIENT).expect(200);

      const second = await as(server, doctor, 'libya_doctor')
        .post('/patients')
        .send({ ...NEW_PATIENT, fullName: 'Mohamed Ali', dateOfBirth: '1985-06-15' })
        .expect(200);

      expect(second.body.kind).toBe('confirmation_required');
      expect(second.body.candidates).toHaveLength(1);
      // The doctor is shown name + DOB to decide with.
      expect(second.body.candidates[0].fullName).toBe('محمد علي');
      expect(second.body.candidates[0].dateOfBirth).toBe('1985-06-15');

      // Only one record so far — nothing was silently created or merged.
      const list = await as(server, doctor, 'libya_doctor').get('/patients').expect(200);
      expect(list.body.patients).toHaveLength(1);
    });

    it('creates a SECOND record once the doctor confirms they are different people', async () => {
      const doctor = await createUser(h.owner, 'libya_doctor');
      const server = app.getHttpServer();

      const first = await as(server, doctor, 'libya_doctor')
        .post('/patients')
        .send(NEW_PATIENT)
        .expect(200);

      // A family sharing one handset. Two records is the correct outcome.
      const second = await as(server, doctor, 'libya_doctor')
        .post('/patients')
        .send({
          ...NEW_PATIENT,
          fullName: 'فاطمة علي',
          dateOfBirth: '2010-02-02',
          sex: 'F',
          confirmedDistinctFrom: [first.body.patientId],
        })
        .expect(200);

      expect(second.body.kind).toBe('created');
      expect(second.body.patientId).not.toBe(first.body.patientId);

      const list = await as(server, doctor, 'libya_doctor').get('/patients').expect(200);
      expect(list.body.patients).toHaveLength(2);
    });

    it('rejects a phone number that is not E.164 rather than guessing', async () => {
      const doctor = await createUser(h.owner, 'libya_doctor');
      const res = await as(app.getHttpServer(), doctor, 'libya_doctor')
        .post('/patients')
        .send({ ...NEW_PATIENT, phoneE164: '0912345678' })
        .expect(400);

      // A bare national number is never assumed to be Libyan: guessing "+218"
      // would match a Tunisian patient sharing the trailing digits.
      expect(res.body.message).toMatch(/E\.164/);
    });
  });
});

/**
 * The decorator and the policy have to agree, and nothing else checks that.
 *
 * This suite's guard is a stub that trusts a header, so `@RequiresRole` is not
 * exercised by the requests above — and the service-level suites call the
 * service directly, below the controller entirely. A route can therefore be
 * declared for the wrong roles and every test still passes. That is exactly how
 * `POST /appointments` came to advertise the referring side while
 * `scheduling_appointments` had no INSERT policy for it (migration 0014), and
 * how `POST /patients` kept refusing the receiving side after 0014 gave them
 * one.
 *
 * So: assert the declared roles directly, next to the policy they have to match.
 */
describe('declared roles match the policies behind them', () => {
  // `SetMetadata` used as a METHOD decorator defines metadata on the handler
  // function itself, not on (prototype, propertyKey) — which is also how the
  // Reflector reads it at request time.
  const declared = (method: keyof PatientsController): string[] => {
    const handler = PatientsController.prototype[method] as unknown as object;
    return (Reflect.getMetadata(REQUIRES_ROLE_KEY, handler) as string[] | undefined) ?? [];
  };

  it('lets either doctor register a patient, because either may create one', () => {
    // `patients_creator_insert` admits both and scopes each to
    // `created_by_doctor = app_current_user_id()`. A receiving clinic's walk-in
    // is not part of any referral and still has to be written down somewhere.
    expect(declared('create').sort()).toEqual(['libya_doctor', 'tunisia_doctor']);
  });

  it('lets either doctor search by phone, because either may book', () => {
    expect(declared('search').sort()).toEqual(['libya_doctor', 'tunisia_doctor']);
  });

  it('keeps reading a single record with the two clinical roles', () => {
    // Narrowed by migration 0021: this used to admit 'patient' as well, for a
    // record they had claimed. There is no such account, and the two doctors
    // are each scoped by policy — the referring one to patients they created,
    // the receiving one to patients they have an appointment and consent for.
    expect(declared('getById').sort()).toEqual(['libya_doctor', 'tunisia_doctor']);
  });
});
