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
