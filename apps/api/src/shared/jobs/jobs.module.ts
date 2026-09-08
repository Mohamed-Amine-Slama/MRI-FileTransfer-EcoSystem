import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
// TYPE-ONLY, and that matters — see the note on the factory below. A type
// import is erased at compile time and loads nothing at runtime.
import type { Queue } from 'bullmq';
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
 */
@Global()
@Module({
  providers: [
    {
      provide: IMAGING_QUEUE,
      inject: [APP_CONFIG],
      /**
       * WHY THE IMPORTS ARE DYNAMIC AND THE FACTORY IS ASYNC.
       *
       * `bullmq` and `ioredis` are large CommonJS packages. Imported at the top
       * level of a file that SWC transforms to ESM, their interop deadlocks
       * Vitest's module runner — and it deadlocks on IMPORT, not on use. The
       * symptom is brutal to diagnose: `await import('../../app.module')` in
       * the route-access audit never resolves, the test dies on its timeout,
       * and the stack points at the import line rather than at anything to do
       * with queues. Importing either package directly inside a test works
       * fine, which is what makes the cause so easy to miss.
       *
       * Loading them here instead keeps them off the module graph that SWC
       * transforms. It also means a process that never resolves this token
       * never pays to load them at all.
       */
      useFactory: async (config: AppConfig): Promise<Queue> => {
        const [{ Queue: BullQueue }, { default: IORedis }] = await Promise.all([
          import('bullmq'),
          import('ioredis'),
        ]);

        /**
         * The client is constructed here and handed to BullMQ rather than
         * letting BullMQ build one from a connection string, because BullMQ
         * loads ioredis with its own dynamic import and its diagnostic
         * explicitly recommends passing a constructed instance instead.
         *
         * lazyConnect keeps the promise the route-access audit documents:
         * building the DI graph must open no connection. It is also the better
         * production shape — a process that never enqueues should not hold
         * Redis open to prove that it could.
         *
         * maxRetriesPerRequest: null is BullMQ's requirement, not a preference.
         * ioredis otherwise gives up on a command after a fixed number of
         * retries, which for a blocking queue read means dropping the job.
         */
        const connection = new IORedis(config.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: null,
        });

        return new BullQueue('imaging', {
          connection,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 5_000 },
            // A bounded history: enough to diagnose a bad night, not enough to
            // grow without limit.
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          },
        });
      },
    },
  ],
  exports: [IMAGING_QUEUE],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(@Inject(IMAGING_QUEUE) private readonly queue: Queue) {}

  /**
   * Close on shutdown. Without this the process hangs on SIGTERM, which in a
   * rolling deploy reads as a failed health check rather than as a slow exit.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
