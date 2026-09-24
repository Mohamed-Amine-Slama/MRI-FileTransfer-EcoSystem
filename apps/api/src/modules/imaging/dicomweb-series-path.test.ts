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
    const res = {
      status: () => res,
      setHeader: () => res,
      write: () => true,
      end: () => res,
      json: () => res,
    };
    await controller(paths).frames('twin.1', 'ser.1', 'sop.1', '1', res as never);
    expect(paths).toEqual(['/dicom-web/studies/twin.1/series/ser.1/instances/sop.1/frames/1']);
  });
});
