import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
// TYPE-ONLY: bullmq and ioredis load lazily in onModuleInit, so a module graph
// that never starts the worker (tests, scripts) never opens a Redis socket.
import type { Worker } from 'bullmq';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../../shared/context/request-context';
import {
  buildTwinJobName,
  ingestFileJobName,
  restowInstanceJobName,
  type BuildTwinJob,
  type IngestFileJob,
  type RestowInstanceJob,
} from '../../../shared/jobs/queue.tokens';
import { IngestionService } from './ingestion.service';
import { TwinService } from './twin.service';

/**
 * The consumer of the `imaging` queue — spec 2026-09-21 §6.
 *
 * WHAT WAS MISSING. The pipeline had producers and no consumer. A verified
 * upload was never ingested (nothing called `IngestionService.ingestFile`), and
 * the twin jobs ingestion would have enqueued were never run. Every uploaded
 * MRI stayed in staging: no study row, nothing in Orthanc, nothing a doctor
 * could open.
 *
 * IN-PROCESS, BEHIND A FLAG. One API process consumes its own queue. That is
 * the smallest change that makes uploads work, and `IMAGING_WORKER_ENABLED`
 * lets a later deployment move consumption to a dedicated process without a
 * code change — the job contract (names in queue.tokens.ts) is the boundary.
 *
 * WHOSE IDENTITY. Ingestion runs as the uploading doctor, exactly as the upload
 * tests call it: the rows it writes are governed by the same RLS policies as
 * the upload itself. It is never run as a system/admin identity, which has no
 * read on patient imaging by design.
 */
@Injectable()
export class ImagingWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ImagingWorker.name);
  private worker: Worker | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ingestion: IngestionService,
    private readonly twin: TwinService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.IMAGING_WORKER_ENABLED) return;

    const [{ Worker: BullWorker }, { default: IORedis }] = await Promise.all([
      import('bullmq'),
      import('ioredis'),
    ]);
    const connection = new IORedis(this.config.REDIS_URL, { maxRetriesPerRequest: null });

    this.worker = new BullWorker('imaging', (job) => this.handle(job.name, job.data as unknown), {
      connection,
      // Files of one study ingest in parallel; the study is marked ready only
      // when every expected file is in (IngestionService step 8), so order does
      // not matter for correctness.
      concurrency: 4,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`imaging job ${job?.name ?? '?'} ${job?.id ?? ''} failed: ${err.message}`);
    });
    this.logger.log('imaging worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  /** One job. Public so the routing and identity rules are testable without Redis. */
  async handle(name: string, data: unknown): Promise<void> {
    switch (name) {
      case ingestFileJobName: {
        const job = data as IngestFileJob;
        await runWithContext(doctorContext(job.actorId, `ingest-${job.fileId}`), () =>
          this.ingestion.ingestFile(job.fileId),
        );
        return;
      }
      case buildTwinJobName:
        await this.twin.build(data as BuildTwinJob);
        return;
      case restowInstanceJobName:
        await this.ingestion.restow(data as RestowInstanceJob);
        return;
      default:
        // Throwing fails the job visibly in Redis instead of silently acking
        // work nobody performed.
        throw new Error(`Unknown imaging job: ${name}`);
    }
  }
}

function doctorContext(userId: string, requestId: string): RequestContext {
  return {
    userId,
    role: 'libya_doctor',
    ipAddress: undefined,
    userAgent: 'imaging-worker',
    requestId,
  };
}
