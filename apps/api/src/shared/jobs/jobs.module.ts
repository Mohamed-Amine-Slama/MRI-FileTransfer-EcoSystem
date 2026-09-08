import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { IMAGING_QUEUE } from './queue.tokens';

/**
 * The background worker — BUILD_SPEC §4 lists "Redis + BullMQ" in the stack,
 * and until sub-project 2 nothing in the codebase used it.
 *
 * WHY A QUEUE ARRIVES WITH THE TWIN. Anonymising a study is slow and can fail
 * against a service outside this process. Ingest currently does its derived
 * work — Orthanc STOW, thumbnails — inside the request transaction and lets it
 * fail with a log, which is correct for a thumbnail: a missing thumbnail is a
 * slow viewer. It is NOT correct for the twin. Under the sub-project 2 design
 * the doctor reads only the twin, so a twin that silently failed to build is a
 * case nobody can open, and that needs retries and a dead letter rather than a
 * warning in a log nobody reads.
 *
 * ATTEMPTS AND BACKOFF are set here rather than per-enqueue so that every
 * producer inherits them. A job enqueued without a retry policy is the failure
 * mode this module exists to prevent.
 */
@Global()
@Module({
  providers: [
    {
      provide: IMAGING_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Queue =>
        new Queue('imaging', {
          connection: { url: config.REDIS_URL },
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 5_000 },
            // Keep a bounded history: enough to diagnose a bad night, not
            // enough to grow without limit.
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          },
        }),
    },
  ],
  exports: [IMAGING_QUEUE],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(@Inject(IMAGING_QUEUE) private readonly queue: Queue) {}

  /**
   * Close the Redis connection on shutdown. Without this the process hangs on
   * SIGTERM, which in a rolling deploy reads as a failed health check.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
