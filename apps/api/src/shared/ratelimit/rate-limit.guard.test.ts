import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicEndpoint } from '../authz/access-metadata';
import { GlobalExceptionFilter } from '../errors/global-exception.filter';
import { RateLimit, RateLimitGuard } from './rate-limit.guard';
import { MemoryRateLimitStore, RATE_LIMITS, RateLimiter } from './rate-limiter';

/**
 * BUILD_SPEC P4.5 — the limiter must be IN THE REQUEST PATH.
 *
 * `rate-limiter.test.ts` proves the algorithm: windows roll, lockouts double,
 * violations survive. It proved that while the API applied no rate limiting to
 * any route at all, because nothing outside that test referenced the class.
 *
 * So these tests never call `RateLimiter` directly. Every assertion goes
 * through a real HTTP request and the real guard chain — the only thing that
 * distinguishes a working control from a well-tested unreachable one.
 */

@Controller()
class ProbeController {
  @PublicEndpoint()
  @RateLimit('login')
  @Get('limited')
  limited(): { ok: true } {
    return { ok: true };
  }

  @PublicEndpoint()
  @Get('unlimited')
  unlimited(): { ok: true } {
    return { ok: true };
  }

  @PublicEndpoint()
  @RateLimit('otpRequest', { keyBy: 'param:id' })
  @Get('per-target/:id')
  perTarget(): { ok: true } {
    return { ok: true };
  }
}

let app: INestApplication;

beforeAll(async () => {
  @Module({
    controllers: [ProbeController],
    providers: [
      { provide: RateLimiter, useFactory: () => new RateLimiter(new MemoryRateLimitStore()) },
      { provide: APP_GUARD, useClass: RateLimitGuard },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('P4.5 rate limiting is enforced over HTTP', () => {
  it('allows the budget, then returns 429 with Retry-After', async () => {
    const server = app.getHttpServer() as never;
    const budget = RATE_LIMITS.login.limit;

    for (let i = 0; i < budget; i += 1) {
      await request(server).get('/limited').expect(200);
    }

    const blocked = await request(server).get('/limited').expect(429);

    // Retry-After is what makes a 429 actionable rather than just a wall.
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // The body must not disclose which budget was hit or how much remains —
    // that tells an attacker exactly how to pace themselves.
    expect(JSON.stringify(blocked.body)).not.toContain('login');
    expect(JSON.stringify(blocked.body)).not.toMatch(/remaining|limit|budget/i);
  }, 60_000);

  it('does NOT throttle routes that are not marked', async () => {
    // The failure mode on the other side: a global limiter that treats a
    // doctor scrolling a 300-instance study as abuse and denies care. Opt-in
    // is the design; this is the assertion that keeps it opt-in.
    const server = app.getHttpServer() as never;
    for (let i = 0; i < RATE_LIMITS.login.limit * 3; i += 1) {
      await request(server).get('/unlimited').expect(200);
    }
  }, 60_000);

  it('budgets a third-party target separately, so one target cannot throttle another', async () => {
    // The mistake this test exists to prevent: keying the SMS budget on the
    // DOCTOR. otpRequest allows 3 per 15 minutes, so a clinic onboarding a
    // fourth patient in a morning would be refused — legitimate work denied by
    // a control meant to stop phone bombing.
    const server = app.getHttpServer() as never;
    const budget = RATE_LIMITS.otpRequest.limit;

    // Exhaust one target completely.
    for (let i = 0; i < budget; i += 1) {
      await request(server).get('/per-target/patient-a').expect(200);
    }
    await request(server).get('/per-target/patient-a').expect(429);

    // A DIFFERENT target is unaffected — this is the whole point.
    await request(server).get('/per-target/patient-b').expect(200);
  }, 60_000);

  it('app.module registers the guard, after AuthGuard', () => {
    // This defect was "the control exists and nothing invokes it". A source
    // assertion is blunt, but it is the shape of check that catches it.
    const mod = readFileSync(resolve(__dirname, '..', '..', 'app.module.ts'), 'utf8');

    expect(mod, 'RateLimitGuard must be registered as an APP_GUARD').toMatch(
      /APP_GUARD,\s*useClass:\s*RateLimitGuard/,
    );

    // Order is load-bearing: registered before AuthGuard, the request context
    // has no verified userId yet and every caller keys to an IP bucket.
    const authAt = mod.indexOf('useClass: AuthGuard');
    const rateAt = mod.indexOf('useClass: RateLimitGuard');
    expect(authAt).toBeGreaterThan(-1);
    expect(rateAt).toBeGreaterThan(authAt);
  });

  it('the routes that start uploads carry a budget', () => {
    // Naming the routes in a test rather than in a comment: if someone removes
    // a decorator, this fails instead of the protection silently disappearing.
    //
    // The two claim routes that used to be asserted here are gone. Migration
    // 0021 removed patient accounts, and with them the SMS claim code and the
    // six-digit guessing surface it created — so there is no longer an
    // 'otpRequest' budget to protect on the patients controller.
    const uploads = readFileSync(
      resolve(__dirname, '..', '..', 'modules/imaging/internal/uploads.controller.ts'),
      'utf8',
    );

    expect(uploads, 'upload initiation must be throttled').toMatch(
      /@RateLimit\('uploadInit'\)\s*\n\s*@Post\(\)/,
    );
  });
});
