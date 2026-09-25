import 'reflect-metadata';
import { raw } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './shared/config/config.schema';
import { assertAllRoutesDeclareAccess } from './shared/authz/route-access-audit';
import { ScrubbingLogger } from './shared/observability/scrubbing.logger';

/**
 * Load a local `.env` for development only.
 *
 * Deployed environments inject configuration from AWS Secrets Manager
 * (BUILD_SPEC §6); there is no `.env` file on a deployed host, and silently
 * reading one in production would be a way to shadow real secrets with a
 * stale file someone left on the box.
 */
async function loadLocalEnv(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') return;
  const dotenv = await import('dotenv');
  dotenv.config();
}

async function bootstrap(): Promise<void> {
  await loadLocalEnv();

  // P1.6 — validate configuration before anything else is constructed. A
  // process that boots with invalid config and fails at request time turns a
  // deployment mistake into a patient-facing outage discovered by a doctor
  // mid-upload.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, {
    // Real upload traffic goes through the resumable transport (P7), never
    // through the JSON body parser.
    bodyParser: true,
    // P13 — hold framework startup lines until the scrubbing logger is
    // installed on the next line. Without this, everything Nest logs while
    // constructing modules is written by the default console logger and has
    // already escaped by the time `useLogger` runs.
    bufferLogs: true,
  });

  // P13 — every log line goes through the scrubber. This is the wiring that
  // was missing: log-scrubber.ts was tested but unreachable from a running
  // process, so GlobalExceptionFilter printed exception messages verbatim.
  app.useLogger(new ScrubbingLogger());

  // Express advertises itself by default. Disabled at the adapter as well as
  // stripped in SecurityHeadersMiddleware, so it is never set in the first
  // place on any path (P14.3, §6).
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // P7.2 — chunk uploads arrive as raw application/octet-stream and must reach
  // the handler as a Buffer, not a parsed body.
  //
  // Scoped to the chunk route prefix rather than applied globally: handing
  // every endpoint an unparsed body would break the JSON controllers. The
  // limit is headroom over UPLOAD_CHUNK_SIZE_BYTES (5 MiB default, 64 MiB
  // ceiling per the config schema) — it bounds a single request, while the
  // declared-size check in UploadService bounds the file.
  app.use(
    '/uploads/files',
    raw({ type: 'application/octet-stream', limit: '80mb' }),
  );

  // BUILD_SPEC §6: errors must not leak internals. Nest's default 500 body is
  // already opaque; the global exception filter added in P4.2 enforces the
  // rest (404-not-403 for unauthorised reads of a specific record).

  // P1.5 — refuse to serve if any route lacks an access declaration. This runs
  // before listen(), so an undeclared endpoint never accepts a request.
  assertAllRoutesDeclareAccess(app);

  // Without this Nest installs no SIGTERM handler: the onApplicationShutdown /
  // onModuleDestroy hooks (BullMQ worker and queue close, pool drain) never
  // run, and as PID 1 in the container node ignores SIGTERM outright — every
  // deploy waits out the grace period and SIGKILLs in-flight ingest jobs.
  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap().catch((err: unknown) => {
  // Config and authorization failures must be loud and fatal, not swallowed
  // into an unhandled rejection that leaves a half-started process behind.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
