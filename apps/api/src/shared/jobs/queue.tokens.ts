/**
 * Job identity — kept in its own file so a consumer can import the token and
 * the payload type without pulling bullmq (and therefore ioredis) into its
 * module graph. The same reason payment-rail.tokens.ts exists.
 */

export const IMAGING_QUEUE = Symbol('IMAGING_QUEUE');

/**
 * Job names are PERSISTED IN REDIS, in jobs that may already be queued when a
 * new build deploys. Renaming one orphans everything queued under the old name
 * and the failure is silent — the jobs simply never run, and under sub-project
 * 2 that means studies that never become visible to their doctor.
 *
 * Change these only with a drain.
 */
export const buildTwinJobName = 'imaging.buildTwin';
export const reapTwinsJobName = 'imaging.reapTwins';

/** Enqueued when a study's last file lands. */
export interface BuildTwinJob {
  studyId: string;
  /**
   * The uploading doctor, carried rather than looked up.
   *
   * The twin is built under a real identity, not a privileged connection — and
   * resolving that identity from the study would itself require a session.
   */
  actorId: string;
}

/**
 * Enqueued when an uploaded file's checksum verifies (POST
 * /uploads/files/:id/complete). Until 2026-09-21 nothing enqueued or consumed
 * this work: files were received and verified, then sat in staging forever,
 * and no study ever reached a doctor. See ImagingWorker.
 */
export const ingestFileJobName = 'imaging.ingestFile';

/**
 * Enqueued when ingest could not STOW an instance to Orthanc (ADR-3: Orthanc
 * is rebuilt from the originals). Carries the original's blob key only — the
 * job reads the bytes back and re-sends them, touching no table, so it needs
 * no identity.
 */
export const restowInstanceJobName = 'imaging.restowInstance';

export interface RestowInstanceJob {
  storageKey: string;
}

/**
 * Retry budget for work that waits on Orthanc: 12 attempts, exponential from
 * 30s, ~34 hours in all. The queue default (5 attempts from 5s, ~2.5 minutes)
 * dead-letters a twin during any Orthanc outage longer than a coffee break.
 */
export const DURABLE_RETRY = {
  attempts: 12,
  backoff: { type: 'exponential', delay: 30_000 },
} as const;

export interface IngestFileJob {
  fileId: string;
  /** The uploading doctor. Ingestion runs under their identity, like the twin. */
  actorId: string;
}
