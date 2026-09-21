import { describe, expect, it } from 'vitest';
import { requireContext } from '../../shared/context/request-context';
import {
  buildTwinJobName,
  ingestFileJobName,
  type BuildTwinJob,
} from '../../shared/jobs/queue.tokens';
import { ImagingWorker } from './internal/imaging.worker';

/**
 * The worker is the consumer the imaging queue never had (spec 2026-09-21 §6).
 * These tests pin the routing and — the part that matters for RLS — the
 * identity each job runs under.
 */
function worker(seen: { ingest: { fileId: string; userId: string }[]; twin: BuildTwinJob[] }) {
  const ingestion = {
    ingestFile: async (fileId: string) => {
      seen.ingest.push({ fileId, userId: requireContext().userId });
      return { status: 'ingested' as const };
    },
  };
  const twin = {
    build: async (job: BuildTwinJob) => {
      seen.twin.push(job);
    },
  };
  return new ImagingWorker({ IMAGING_WORKER_ENABLED: false } as never, ingestion as never, twin as never);
}

describe('ImagingWorker.handle', () => {
  it('ingests a file under the uploading doctor, not a system identity', async () => {
    const seen = { ingest: [] as { fileId: string; userId: string }[], twin: [] as BuildTwinJob[] };
    await worker(seen).handle(ingestFileJobName, { fileId: 'f-1', actorId: 'u-1' });
    expect(seen.ingest).toEqual([{ fileId: 'f-1', userId: 'u-1' }]);
  });

  it('builds a twin', async () => {
    const seen = { ingest: [] as { fileId: string; userId: string }[], twin: [] as BuildTwinJob[] };
    await worker(seen).handle(buildTwinJobName, { studyId: 's-1', actorId: 'u-1' });
    expect(seen.twin).toEqual([{ studyId: 's-1', actorId: 'u-1' }]);
  });

  it('fails loudly on a job name it does not know', async () => {
    const seen = { ingest: [] as { fileId: string; userId: string }[], twin: [] as BuildTwinJob[] };
    await expect(worker(seen).handle('imaging.nope', {})).rejects.toThrow('imaging.nope');
  });
});
