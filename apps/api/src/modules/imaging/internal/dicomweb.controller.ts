import { Controller, Get, Header, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { DatabaseService } from '../../../shared/db/database.service';
import { BLOB_STORE } from '../../../shared/storage/storage.module';
import { derivedThumbnailKey, type BlobStore } from '../../../shared/storage/blob-store';
import { OrthancHttpClient } from './orthanc.http-client';
import { StudyAccessService } from './study-access.service';
import { requireContext } from '../../../shared/context/request-context';

/**
 * DICOMweb proxy — BUILD_SPEC P8.2.
 *
 * "The frontend never talks to Orthanc directly. The API proxies
 *  WADO-RS/QIDO-RS requests, and for every request: applies RBAC and RLS,
 *  emits a StudyAccessed audit event, issues short-lived signed URLs."
 *
 * This controller is the ONLY route to imaging data. Orthanc sits in a private
 * subnet with no internet route, so there is no second path for a browser to
 * find — the network topology enforces what this code assumes.
 *
 * Note the shape of every handler: authorise first (which also audits), then
 * fetch. Never the other way round. Fetching first and filtering afterwards
 * would mean the bytes left Orthanc before anyone checked whether they should
 * have, and a bug in the filter becomes a disclosure rather than an error.
 */
@Controller('dicom-web')
export class DicomWebController {
  constructor(
    private readonly access: StudyAccessService,
    private readonly orthanc: OrthancHttpClient,
    private readonly db: DatabaseService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
  ) {}

  /**
   * Instance list for a study — P9.1 progressive loading.
   *
   * UIDs only, no pixel data. The viewer uses this to know how many frames
   * exist and to request them ONE AT A TIME. Returning the frames here would
   * be the full-study prefetch the gate forbids.
   */
  @RequiresRole('tunisia_doctor', 'libya_doctor')
  @Get('studies/:studyUid/instances')
  @Header('cache-control', 'no-store')
  async instances(
    @Param('studyUid') studyUid: string,
  ): Promise<{ instances: { sopInstanceUid: string; seriesInstanceUid: string }[] }> {
    const study = await this.access.authoriseStudyAccess(studyUid, 'metadata');
    const ctx = requireContext();

    // WHY THE DOCTOR'S LIST COMES FROM ORTHANC AND THE LAB'S FROM THE DATABASE.
    //
    // Anonymisation reallocates every UID, so the twin's instances do not carry
    // the SOP UIDs recorded in `imaging_instances` — those belong to the
    // original. Serving the stored list to a doctor would hand them identifiers
    // that resolve against nothing in the copy they are allowed to read, and
    // every frame request would 404 for a reason that looks like an outage.
    //
    // The lab keeps the database list: it reads the original, the rows describe
    // exactly that, and it stays readable when Orthanc is unavailable.
    if (ctx.role === 'tunisia_doctor') {
      return { instances: await this.orthanc.listInstances(study.orthancStudyUid) };
    }

    const rows = await this.db.tx(async (tx) => {
      const res = await tx.query<{ sop_uid: string; series_uid: string }>(
        `SELECT sop_uid, series_uid FROM imaging_instances
         WHERE study_id = $1 ORDER BY series_uid, sop_uid`,
        [study.studyId],
      );
      return res.rows;
    });

    return {
      instances: rows.map((r) => ({
        sopInstanceUid: r.sop_uid,
        seriesInstanceUid: r.series_uid,
      })),
    };
  }

  /**
   * Small JPEG preview of one instance — P9.1 "thumbnails first".
   *
   * This is what appears on screen inside the 5-second budget. It is NOT
   * diagnostic: 8-bit, window-levelled by heuristic, downsampled. The viewer's
   * persistent banner says so.
   */
  @RequiresRole('tunisia_doctor', 'libya_doctor')
  @Get('studies/:studyUid/instances/:sopUid/thumbnail')
  async thumbnail(
    @Param('studyUid') studyUid: string,
    @Param('sopUid') sopUid: string,
    @Res() res: Response,
  ): Promise<void> {
    const study = await this.access.authoriseStudyAccess(studyUid, 'thumbnail');
    const ctx = requireContext();

    // WHY THE DOCTOR'S PREVIEW IS RENDERED RATHER THAN FETCHED.
    //
    // Ingest writes thumbnails keyed by the ORIGINAL SOP UID. A doctor
    // addresses the twin's, which is a different value, so the stored blob is
    // unreachable to them — by design, not by accident. Mapping the two UIDs
    // would mean matching instance order across two Orthanc resources, which
    // is exactly the kind of assumption that silently pairs the wrong slice
    // with the wrong preview.
    //
    // So the twin renders its own. It is the copy the doctor is entitled to,
    // and the only one whose pixels are guaranteed to sit behind a
    // de-identified header. Burned-in pixel text is handled upstream: a study
    // that might carry it never reaches 'ready' at all.
    if (ctx.role === 'tunisia_doctor') {
      const preview = await this.orthanc.instancePreview(sopUid);
      if (preview === null) throw new NotFoundException('Thumbnail not available');

      res.status(200);
      res.setHeader('content-type', preview.contentType);
      res.setHeader('cache-control', 'private, max-age=300, no-transform');
      res.end(Buffer.from(preview.bytes));
      return;
    }

    const key = derivedThumbnailKey({
      patientId: study.patientId,
      studyInstanceUid: study.studyInstanceUid,
      sopInstanceUid: sopUid,
    });

    let bytes: Uint8Array;
    try {
      bytes = await this.blobs.getDerived(key);
    } catch {
      // A thumbnail may legitimately be absent (compressed transfer syntax, or
      // ingest still running). 404 rather than a placeholder image: the viewer
      // must be able to tell "no preview" from "here is a preview of nothing".
      throw new NotFoundException('Thumbnail not available');
    }

    res.status(200);
    res.setHeader('content-type', 'image/jpeg');
    // Private, short-lived: it is patient imaging, however small.
    res.setHeader('cache-control', 'private, max-age=300, no-transform');
    res.end(Buffer.from(bytes));
  }

  /** QIDO-RS: study-level metadata. */
  @RequiresRole('tunisia_doctor', 'libya_doctor')
  @Get('studies/:studyUid/metadata')
  @Header('cache-control', 'no-store')
  async studyMetadata(@Param('studyUid') studyUid: string): Promise<unknown> {
    // Throws 404 (and audits the refusal) if the caller may not see it.
    // The RESOLVED uid, never the path parameter. For a doctor these differ:
    // the parameter names the twin, and asking Orthanc for the original would
    // return metadata carrying the patient's name.
    const study = await this.access.authoriseStudyAccess(studyUid, 'metadata');
    return this.orthanc.findStudy(study.orthancStudyUid);
  }

  /**
   * WADO-RS: retrieve the frames of one instance.
   *
   * Streamed rather than buffered — a 120-slice CT held in memory per
   * concurrent viewer exhausts the heap.
   */
  @RequiresRole('tunisia_doctor', 'libya_doctor')
  @Get('studies/:studyUid/series/:seriesUid/instances/:sopUid')
  @Header('cache-control', 'no-store')
  async instance(
    @Param('studyUid') studyUid: string,
    @Param('seriesUid') seriesUid: string,
    @Param('sopUid') sopUid: string,
    @Res() res: Response,
  ): Promise<void> {
    const study = await this.access.authoriseStudyAccess(studyUid, 'pixel_data');

    const upstream = await this.orthanc.retrieve(
      `/dicom-web/studies/${encodeURIComponent(study.orthancStudyUid)}` +
        `/series/${encodeURIComponent(seriesUid)}` +
        `/instances/${encodeURIComponent(sopUid)}`,
      'multipart/related; type="application/dicom"',
    );

    if (!upstream.ok || upstream.body === null) {
      // Do not forward Orthanc's status or body: they describe internal state
      // and would distinguish "not in Orthanc" from "not yours" (§6).
      res.status(404).json({ statusCode: 404, message: 'Study not found' });
      return;
    }

    res.status(200);
    res.setHeader(
      'content-type',
      upstream.headers.get('content-type') ?? 'application/dicom',
    );
    // Imaging must never be cached by an intermediary. Even with a signed URL,
    // a shared cache would serve one doctor's study to the next requester.
    res.setHeader('cache-control', 'no-store, private');

    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  }

  /**
   * Per-instance metadata in DICOM JSON — required by Cornerstone3D (P9.1).
   *
   * A `wadors:` image id cannot be rendered from pixels alone: the loader
   * needs Rows, Columns, BitsAllocated, PixelRepresentation, RescaleSlope and
   * the VOI LUT before it can turn bytes into an image. Without this endpoint
   * the viewer has no way to display full-fidelity data at all.
   *
   * Authorised and audited like every other route. Metadata is patient data:
   * study date, modality and body part are all in here.
   */
  @RequiresRole('tunisia_doctor', 'libya_doctor')
  @Get('studies/:studyUid/instances/:sopUid/metadata')
  @Header('cache-control', 'no-store')
  async instanceMetadata(
    @Param('studyUid') studyUid: string,
    @Param('sopUid') sopUid: string,
  ): Promise<unknown> {
    const study = await this.access.authoriseStudyAccess(studyUid, 'metadata');

    const upstream = await this.orthanc.retrieve(
      `/dicom-web/studies/${encodeURIComponent(study.orthancStudyUid)}` +
        `/instances/${encodeURIComponent(sopUid)}/metadata`,
      'application/dicom+json',
    );

    if (!upstream.ok) throw new NotFoundException('Instance metadata not found');
    return upstream.json();
  }

  /**
   * WADO-RS frame retrieval — what Cornerstone3D's `wadors:` loader fetches
   * (P9.1).
   *
   * Returns multipart/related containing the raw frame. Authorised and audited
   * exactly like every other route here: the viewer gets no privileged path,
   * and a doctor scrolling through a series produces one audit row per frame
   * they actually look at.
   */
  @RequiresRole('tunisia_doctor', 'libya_doctor')
  @Get('studies/:studyUid/instances/:sopUid/frames/:frame')
  async frames(
    @Param('studyUid') studyUid: string,
    @Param('sopUid') sopUid: string,
    @Param('frame') frame: string,
    @Res() res: Response,
  ): Promise<void> {
    const study = await this.access.authoriseStudyAccess(studyUid, 'pixel_data');

    // Frame numbers are 1-based in DICOMweb. Reject anything else rather than
    // passing a caller-controlled string into the upstream URL.
    if (!/^[1-9]\d{0,4}$/.test(frame)) {
      throw new NotFoundException('Frame not found');
    }

    const upstream = await this.orthanc.retrieve(
      `/dicom-web/studies/${encodeURIComponent(study.orthancStudyUid)}` +
        `/instances/${encodeURIComponent(sopUid)}` +
        `/frames/${encodeURIComponent(frame)}`,
      'multipart/related; type="application/octet-stream"',
    );

    if (!upstream.ok || upstream.body === null) {
      res.status(404).json({ statusCode: 404, message: 'Frame not found' });
      return;
    }

    res.status(200);
    res.setHeader(
      'content-type',
      upstream.headers.get('content-type') ?? 'multipart/related',
    );
    // Pixel data must never sit in a shared cache.
    res.setHeader('cache-control', 'no-store, private');

    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  }

  /**
   * Issue a short-lived, subject-bound URL for direct retrieval (P8.2).
   *
   * The viewer uses this for progressive frame loading (P9) so it can fetch
   * without re-authorising on every frame — but the URL still expires within
   * 5-15 minutes and is useless to any other account.
   */
  @RequiresRole('tunisia_doctor', 'libya_doctor')
  @Get('studies/:studyUid/instances/:sopUid/url')
  @Header('cache-control', 'no-store')
  async instanceUrl(
    @Param('studyUid') studyUid: string,
    @Param('sopUid') sopUid: string,
  ): Promise<{ url: string; expiresAt: number }> {
    return this.access.issueInstanceUrl(studyUid, sopUid);
  }
}
