import {
  Controller,
  Get,
  Module,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicEndpoint, RequiresRole } from '../authz/access-metadata';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { AuthGuard } from './auth.guard';
import { TokenVerifier, TokenVerificationError } from './token-verifier';
import { getContext } from '../context/request-context';
import { RequestContextMiddleware } from '../context/request-context.middleware';

/**
 * BUILD_SPEC P4.2 — the four required authentication cases, plus P4.3 MFA.
 *
 * A real key pair is generated and a real JWKS endpoint is served, so tokens
 * are genuinely signed and genuinely verified. Stubbing the verifier would
 * test the guard's plumbing while leaving the actual signature check unproven.
 */

const ISSUER = 'https://auth.test.local/realms/mir';
const AUDIENCE = 'mir-api';

/**
 * Derived from jose rather than written as `CryptoKey`.
 *
 * `CryptoKey` is a DOM global, and this project's `lib` is ES2022 with no DOM —
 * so the name does not resolve here. Taking the type from the function that
 * produces the value is also the version-proof spelling: jose has changed what
 * `generateKeyPair` returns between majors, and this follows it.
 */
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: JWK;
let jwksServer: import('node:http').Server;
let jwksUrl: string;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  const http = await import('node:http');
  jwksServer = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r));
  const addr = jwksServer.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  jwksUrl = `http://127.0.0.1:${port}/certs`;
});

afterAll(async () => {
  await new Promise<void>((r) => jwksServer.close(() => r()));
});

interface TokenOptions {
  sub?: string;
  roles?: string[];
  audience?: string;
  issuer?: string;
  expiresIn?: string | number;
  amr?: string[];
  acr?: string;
}

async function mintToken(opts: TokenOptions = {}): Promise<string> {
  const jwt = new SignJWT({
    realm_access: { roles: opts.roles ?? ['applicant'] },
    ...(opts.amr !== undefined ? { amr: opts.amr } : {}),
    ...(opts.acr !== undefined ? { acr: opts.acr } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(opts.sub ?? '018f8e6a-0000-7000-8000-000000000001')
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt();

  return jwt.setExpirationTime(opts.expiresIn ?? '5m').sign(privateKey);
}

function testConfig(): AppConfig {
  return {
    KEYCLOAK_ISSUER_URL: ISSUER,
    KEYCLOAK_AUDIENCE: AUDIENCE,
    KEYCLOAK_JWKS_URL: jwksUrl,
    SCHEDULING_TRIAGE_BEFORE_PAYMENT: false,
  } as AppConfig;
}

/** Echoes the ambient request context so tests can assert on it. */
@Controller('probe')
class ProbeController {
  @PublicEndpoint()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  @RequiresRole('applicant')
  @Get('applicant-only')
  applicantOnly(): { userId: string | undefined; role: string | undefined } {
    const ctx = getContext();
    return { userId: ctx?.userId, role: ctx?.role };
  }

  @RequiresRole('libya_doctor')
  @Get('doctor-only')
  doctorOnly(): { ok: true } {
    return { ok: true };
  }
}

async function buildApp(): Promise<INestApplication> {
  @Module({
    controllers: [ProbeController],
    providers: [
      { provide: APP_CONFIG, useValue: testConfig() },
      TokenVerifier,
      Reflector,
      { provide: APP_GUARD, useClass: AuthGuard },
    ],
  })
  class TestModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(RequestContextMiddleware).forRoutes('*');
    }
  }

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('P4.2 API authentication', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. no token -> 401', async () => {
    await request(app.getHttpServer()).get('/probe/applicant-only').expect(401);
  });

  it('2. tampered signature -> 401', async () => {
    const token = await mintToken();
    const parts = token.split('.');
    const sig = parts[2] ?? '';

    // Alter a character in the MIDDLE of the signature, not the last one.
    // base64url's final character can carry padding bits that decode to the
    // same bytes, so flipping it sometimes leaves the signature unchanged and
    // the request legitimately succeeds — a flaky test, not a security hole.
    const chars = [...sig];
    const i = Math.floor(chars.length / 2);
    chars[i] = chars[i] === 'A' ? 'B' : 'A';
    const tampered = `${parts[0]}.${parts[1]}.${chars.join('')}`;

    expect(tampered).not.toBe(token);
    await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${tampered}`)
      .expect(401);
  });

  it('2b. tampered PAYLOAD (self-promotion to admin) -> 401', async () => {
    // The attack the signature check actually exists to stop: take a valid
    // low-privilege token and rewrite the role claim.
    const token = await mintToken({ roles: ['applicant'] });
    const [header, payload, sig] = token.split('.');

    const decoded = JSON.parse(
      Buffer.from(payload ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    decoded['realm_access'] = { roles: ['admin'] };
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

    await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${header}.${forged}.${sig}`)
      .expect(401);
  });

  it('3. expired token -> 401', async () => {
    const token = await mintToken({ expiresIn: Math.floor(Date.now() / 1000) - 3600 });
    await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('4. valid token -> handler runs AND context matches the token subject', async () => {
    const sub = '018f8e6a-0000-7000-8000-00000000abcd';
    const token = await mintToken({ sub, roles: ['applicant'] });

    const res = await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ userId: sub, role: 'applicant' });
  });

  it('rejects a token minted for a different audience', async () => {
    // Same realm, same signing key, different client. Valid signature, wrong
    // recipient — must not be accepted.
    const token = await mintToken({ audience: 'some-other-client' });
    await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token from a different issuer', async () => {
    const token = await mintToken({ issuer: 'https://evil.example/realms/mir' });
    await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a non-bearer authorization scheme', async () => {
    await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);
  });

  it('allows a public endpoint with no token', async () => {
    await request(app.getHttpServer()).get('/probe/open').expect(200);
  });

  it('enforces the declared role — right token, wrong route -> 403', async () => {
    const token = await mintToken({ roles: ['applicant'] });
    await request(app.getHttpServer())
      .get('/probe/doctor-only')
      .set('authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('does not leak the reason a token was rejected', async () => {
    const expired = await mintToken({ expiresIn: Math.floor(Date.now() / 1000) - 3600 });
    const wrongAud = await mintToken({ audience: 'nope' });

    const a = await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${expired}`);
    const b = await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${wrongAud}`);

    // Identical responses. A different message per failure mode tells an
    // attacker which half of a forged token to correct.
    expect(a.body).toEqual(b.body);
    expect(JSON.stringify(a.body)).not.toMatch(/expired|audience|signature|issuer/i);
  });
});

describe('P4.3 MFA for clinical accounts', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a doctor whose token shows no second factor', async () => {
    const token = await mintToken({ roles: ['libya_doctor'] });
    await request(app.getHttpServer())
      .get('/probe/doctor-only')
      .set('authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('accepts a doctor with an OTP in amr', async () => {
    const token = await mintToken({ roles: ['libya_doctor'], amr: ['pwd', 'otp'] });
    await request(app.getHttpServer())
      .get('/probe/doctor-only')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('accepts a doctor with a raised acr', async () => {
    const token = await mintToken({ roles: ['libya_doctor'], acr: '2' });
    await request(app.getHttpServer())
      .get('/probe/doctor-only')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('does not require MFA of an applicant, who can reach no data', async () => {
    const token = await mintToken({ roles: ['applicant'] });
    await request(app.getHttpServer())
      .get('/probe/applicant-only')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('treats acr "1" as single-factor', async () => {
    // Keycloak's default mapping uses 1 for password-only. Accepting it would
    // silently disable the MFA requirement for every doctor.
    const token = await mintToken({ roles: ['tunisia_doctor'], acr: '1' });
    await request(app.getHttpServer())
      .get('/probe/doctor-only')
      .set('authorization', `Bearer ${token}`)
      .expect(403);
  });
});

describe('claim handling', () => {
  const verifier = (): TokenVerifier => new TokenVerifier(testConfig());

  it('rejects a token with no recognised application role', () => {
    expect(() =>
      verifier().identityFrom({ sub: 'x', realm_access: { roles: ['offline_access'] } }),
    ).toThrow(TokenVerificationError);
  });

  it('rejects a token carrying two application roles', () => {
    // One identity, one role. Two makes "which policy applies" ambiguous.
    expect(() =>
      verifier().identityFrom({
        sub: 'x',
        realm_access: { roles: ['applicant', 'admin'] },
      }),
    ).toThrow(/multiple application roles/);
  });

  it('rejects a token with no subject', () => {
    expect(() => verifier().identityFrom({ realm_access: { roles: ['applicant'] } })).toThrow(
      /no subject/,
    );
  });

  it('ignores unrelated realm roles alongside a valid one', () => {
    const id = verifier().identityFrom({
      sub: 'x',
      realm_access: { roles: ['offline_access', 'uma_authorization', 'applicant'] },
    });
    expect(id.role).toBe('applicant');
  });
});
