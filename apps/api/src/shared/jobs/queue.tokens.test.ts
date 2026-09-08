import { describe, expect, it } from 'vitest';
import { IMAGING_QUEUE, buildTwinJobName, reapTwinsJobName } from './queue.tokens';

describe('job identity', () => {
  it('names the twin jobs stably — a rename silently orphans queued jobs', () => {
    // These strings live in Redis inside jobs that may outlive a deploy. If a
    // refactor renames one, everything already queued under the old name stops
    // running and nothing reports it. Pinning them here makes that a failing
    // test rather than studies that never reach a doctor.
    expect(buildTwinJobName).toBe('imaging.buildTwin');
    expect(reapTwinsJobName).toBe('imaging.reapTwins');
  });

  it('exposes a distinct DI token', () => {
    expect(IMAGING_QUEUE.toString()).toContain('IMAGING_QUEUE');
  });
});
