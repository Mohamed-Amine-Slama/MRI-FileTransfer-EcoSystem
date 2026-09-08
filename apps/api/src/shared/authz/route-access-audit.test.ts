import { Controller, Get, Module, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PublicEndpoint, RequiresRole } from './access-metadata';
import { assertAllRoutesDeclareAccess, findUndeclaredRoutes } from './route-access-audit';

/** A route with no access declaration — exactly what P1.5 must block. */
@Controller('undeclared')
class UndeclaredController {
  @Get()
  listEverything(): string[] {
    return [];
  }
}

@Controller('declared')
class DeclaredController {
  @PublicEndpoint()
  @Get('open')
  open(): string {
    return 'ok';
  }

  @RequiresRole('libya_doctor')
  @Post('restricted')
  restricted(): string {
    return 'ok';
  }

  /** Not a route. Must not be required to declare access. */
  helper(): string {
    return 'not routable';
  }
}

/** Class-level declaration should cover every handler inside. */
@RequiresRole('admin')
@Controller('class-level')
class ClassLevelController {
  @Get('a')
  a(): string {
    return 'a';
  }

  @Get('b')
  b(): string {
    return 'b';
  }
}

async function buildApp(controllers: unknown[]): Promise<INestApplication> {
  @Module({ imports: [DiscoveryModule], controllers: controllers as never[] })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('P1.5 route access declaration', () => {
  it('flags a route that declares neither decorator', async () => {
    const app = await buildApp([UndeclaredController]);
    try {
      expect(findUndeclaredRoutes(app)).toEqual([
        { controller: 'UndeclaredController', handler: 'listEverything' },
      ]);
    } finally {
      await app.close();
    }
  });

  it('refuses to boot when a route is undeclared (the actual gate)', async () => {
    const app = await buildApp([UndeclaredController]);
    try {
      expect(() => assertAllRoutesDeclareAccess(app)).toThrow(/P1\.5/);
      expect(() => assertAllRoutesDeclareAccess(app)).toThrow(
        /UndeclaredController\.listEverything/,
      );
    } finally {
      await app.close();
    }
  });

  it('accepts @PublicEndpoint and @RequiresRole, and ignores non-route methods', async () => {
    const app = await buildApp([DeclaredController]);
    try {
      expect(findUndeclaredRoutes(app)).toEqual([]);
      expect(() => assertAllRoutesDeclareAccess(app)).not.toThrow();
    } finally {
      await app.close();
    }
  });

  it('honours a class-level declaration for every handler', async () => {
    const app = await buildApp([ClassLevelController]);
    try {
      expect(findUndeclaredRoutes(app)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('reports every undeclared route, not just the first', async () => {
    @Controller('multi')
    class MultiController {
      @Get('one')
      one(): string {
        return '1';
      }

      @Get('two')
      two(): string {
        return '2';
      }
    }

    const app = await buildApp([MultiController]);
    try {
      expect(findUndeclaredRoutes(app)).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('passes for the real application module', async () => {
    // Guards against the audit silently finding nothing because discovery is
    // misconfigured — the real app must be scanned and must be clean.
    //
    // AppModule validates configuration at construction (P1.6), so a complete
    // environment is required just to instantiate it. These point at nothing
    // real: the test only builds the DI graph and enumerates routes; no
    // connection is opened.
    const saved = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://mir_app:x@127.0.0.1:5432/unused',
      REDIS_URL: 'redis://127.0.0.1:6379',
      KEYCLOAK_ISSUER_URL: 'https://auth.invalid/realms/mir',
      KEYCLOAK_AUDIENCE: 'mir-api',
      KEYCLOAK_JWKS_URL: 'https://auth.invalid/realms/mir/protocol/openid-connect/certs',
      AWS_REGION: 'eu-south-1',
      S3_BUCKET_ORIGINALS: 'unused-originals',
      S3_BUCKET_DERIVED: 'unused-derived',
      S3_BUCKET_AUDIT_LOGS: 'unused-audit',
      ORTHANC_URL: 'http://orthanc.invalid:8042',
      ORTHANC_USERNAME: 'unused',
      ORTHANC_PASSWORD: 'unused-local',
      SIGNED_URL_SECRET: 'unused-test-signing-key-at-least-32-chars',
    });

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      expect(() => assertAllRoutesDeclareAccess(app)).not.toThrow();
      // And confirm it actually saw routes rather than an empty registry.
      const discovery = app.get(await import('@nestjs/core').then((m) => m.DiscoveryService));
      expect(discovery.getControllers().length).toBeGreaterThan(0);
    } finally {
      await app.close();
      process.env = saved;
    }
    // Longer than the file default. This test builds the ENTIRE application —
    // every module, every provider — and since JobsModule joined the graph that
    // includes loading bullmq and ioredis, two large CJS packages, before the
    // DI graph can be resolved. Thirty seconds was marginal and failed as a
    // timeout, which reads like a hang rather than like slow startup.
  }, 60_000);
});
