import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DicomWebController } from './internal/dicomweb.controller';

/**
 * Orthanc's WADO-RS addresses an instance as
 *   /studies/{study}/series/{series}/instances/{instance}
 * and 404s the series-less form. The proxy used the series-less form, so
 * metadata and frames 404'd for every caller and full-resolution viewing never
 * worked (spec 2026-09-21 §6). These tests pin the upstream path.
 */
function controller(paths: string[]) {
  const access = {
    authoriseStudyAccess: async () => ({
      studyId: 's',
      studyInstanceUid: 'orig.1',
      patientId: 'p',
      orthancStudyUid: 'twin.1',
    }),
  };
  const orthanc = {
    retrieve: async (path: string) => {
      paths.push(path);
      return new Response(JSON.stringify([{}]), { status: 200 });
    },
  };
  return new DicomWebController(access as never, orthanc as never, {} as never, {} as never);
}

describe('DICOMweb instance paths carry the series', () => {
  it('asks Orthanc for metadata under the series', async () => {
    const paths: string[] = [];
    await controller(paths).instanceMetadata('twin.1', 'ser.1', 'sop.1');
    expect(paths).toEqual(['/dicom-web/studies/twin.1/series/ser.1/instances/sop.1/metadata']);
  });

  it('asks Orthanc for series metadata under the resolved study', async () => {
    const paths: string[] = [];
    await controller(paths).seriesMetadata('twin.1', 'ser.1');
    expect(paths).toEqual(['/dicom-web/studies/twin.1/series/ser.1/metadata']);
  });

  it('asks Orthanc for a frame under the series', async () => {
    const paths: string[] = [];
    const res = fakeResponse();
    await controller(paths).frames('twin.1', 'ser.1', 'sop.1', '1', res as never);
    expect(paths).toEqual(['/dicom-web/studies/twin.1/series/ser.1/instances/sop.1/frames/1']);
    // The body is relayed through, not dropped.
    expect(Buffer.concat(res.chunks).toString()).toBe('[{}]');
  });
});

describe('relaying pixel data', () => {
  it('stops pulling from Orthanc when the viewer goes away mid-transfer', async () => {
    let cancelled = false;
    // An upstream that never ends on its own, like a large multipart study.
    const body = new ReadableStream<Uint8Array>({
      pull: (c) => c.enqueue(new Uint8Array(1024)),
      cancel: () => {
        cancelled = true;
      },
    });
    const orthanc = { retrieve: async () => new Response(body, { status: 200 }) };
    const access = {
      authoriseStudyAccess: async () => ({ orthancStudyUid: 'twin.1' }),
    };
    const ctl = new DicomWebController(access as never, orthanc as never, {} as never, {} as never);
    const res = fakeResponse();
    res.once('data', () => res.destroy()); // the viewer navigates away

    await ctl.frames('twin.1', 'ser.1', 'sop.1', '1', res as never);

    expect(cancelled).toBe(true);
  });
});

/** A real writable (the relay pipes into it) with the Express bits the controller calls. */
function fakeResponse(): PassThrough & { chunks: Buffer[] } {
  const res = Object.assign(new PassThrough(), {
    chunks: [] as Buffer[],
    status: () => res,
    setHeader: () => res,
    json: () => res,
  });
  res.on('data', (c: Buffer) => res.chunks.push(c));
  return res;
}
