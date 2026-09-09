import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import type { AnonymisedStudy, OrthancClient, StudyInstanceRef } from './orthanc.client';

/**
 * HTTP client for Orthanc's DICOMweb API — BUILD_SPEC P8.1, P8.2.
 *
 * Credentials live here and ONLY here. They are never sent to the browser, and
 * the bundle check (scripts/check-bundle-secrets.mjs) fails the build if they
 * ever appear in client output.
 *
 * Every method is a server-to-server call inside the VPC. There is deliberately
 * no method that returns an Orthanc URL for a client to fetch directly: doing
 * so would create the bypass P8.2 exists to prevent, and the access would never
 * reach the audit log.
 */
@Injectable()
export class OrthancHttpClient implements OrthancClient {
  private readonly logger = new Logger(OrthancHttpClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private authHeader(): string {
    const raw = `${this.config.ORTHANC_USERNAME}:${this.config.ORTHANC_PASSWORD}`;
    return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
  }

  /** STOW-RS. Idempotent: Orthanc is configured with OverwriteInstances=false. */
  async storeInstance(dicomBytes: Uint8Array): Promise<void> {
    const res = await this.request('/instances', {
      method: 'POST',
      headers: { 'content-type': 'application/dicom' },
      body: dicomBytes,
    });

    if (!res.ok) {
      throw new Error(`Orthanc STOW failed: ${res.status}`);
    }
  }

  /** QIDO-RS study lookup. Returns null when Orthanc does not have it. */
  async findStudy(studyInstanceUid: string): Promise<unknown> {
    const res = await this.request(
      `/dicom-web/studies?StudyInstanceUID=${encodeURIComponent(studyInstanceUid)}`,
      { method: 'GET', headers: { accept: 'application/dicom+json' } },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Orthanc QIDO failed: ${res.status}`);
    return res.json();
  }

  /**
   * Resolve a StudyInstanceUID to Orthanc's own resource id.
   *
   * `/tools/lookup` takes the bare UID as the request body and answers with
   * every resource carrying it. Filtering on Type === 'Study' matters: the same
   * call answers for series and instance UIDs too, and taking the first row
   * blindly would hand a series id to an endpoint expecting a study.
   */
  async lookupStudy(studyInstanceUid: string): Promise<string | null> {
    const res = await this.request('/tools/lookup', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: studyInstanceUid,
    });
    if (!res.ok) throw new Error(`Orthanc lookup failed: ${res.status}`);

    const rows = (await res.json()) as { Type?: string; ID?: string }[];
    const study = rows.find((r) => r.Type === 'Study');
    return study?.ID ?? null;
  }

  /**
   * Anonymise a study into a NEW Orthanc resource.
   *
   * Two round trips, and the second is not optional: the anonymise response
   * carries the twin's Orthanc id but NOT its StudyInstanceUID, and the UID is
   * what every doctor-facing route resolves against. Reading it back is the
   * only way to learn it.
   */
  async anonymiseStudy(orthancStudyId: string, request: unknown): Promise<AnonymisedStudy> {
    const res = await this.request(`/studies/${encodeURIComponent(orthancStudyId)}/anonymize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`Orthanc anonymise failed: ${res.status}`);

    const created = (await res.json()) as { ID?: string; FailedInstancesCount?: number };
    if (created.ID === undefined) {
      throw new Error('Orthanc anonymise returned no resource id');
    }

    const detail = await this.request(`/studies/${encodeURIComponent(created.ID)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!detail.ok) throw new Error(`Orthanc twin read-back failed: ${detail.status}`);

    const body = (await detail.json()) as { MainDicomTags?: { StudyInstanceUID?: string } };
    const uid = body.MainDicomTags?.StudyInstanceUID;
    if (uid === undefined || uid === '') {
      throw new Error('Orthanc twin has no StudyInstanceUID');
    }

    return {
      orthancId: created.ID,
      studyInstanceUid: uid,
      failedInstances: created.FailedInstancesCount ?? 0,
    };
  }

  /**
   * List a study's instances over DICOMweb.
   *
   * Returns UIDs only — no pixel data — because the viewer uses this to learn
   * how many frames exist before requesting them one at a time (P9.1).
   */
  async listInstances(studyInstanceUid: string): Promise<StudyInstanceRef[]> {
    const res = await this.request(
      `/dicom-web/studies/${encodeURIComponent(studyInstanceUid)}/instances`,
      { method: 'GET', headers: { accept: 'application/dicom+json' } },
    );
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Orthanc instance list failed: ${res.status}`);

    // DICOM JSON: tag keys, each a { vr, Value: [...] }. 00080018 is
    // SOPInstanceUID and 0020000E SeriesInstanceUID.
    const rows = (await res.json()) as Record<string, { Value?: string[] }>[];
    return rows.flatMap((row) => {
      const sop = row['00080018']?.Value?.[0];
      const series = row['0020000E']?.Value?.[0];
      // Skip rather than emit a half-identified instance: a frame URL built
      // from an undefined uid would 404 in a way that looks like an outage.
      return sop === undefined || series === undefined
        ? []
        : [{ sopInstanceUid: sop, seriesInstanceUid: series }];
    });
  }

  /**
   * WADO-RS retrieve, streamed back to the proxy.
   *
   * Returns the raw Response so the controller can stream it to the caller
   * without buffering a whole series in memory — a 120-slice CT held in a Node
   * buffer per concurrent viewer is how the API runs out of heap.
   */
  async retrieve(path: string, accept: string): Promise<Response> {
    return this.request(path, { method: 'GET', headers: { accept } });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.config.ORTHANC_URL.replace(/\/$/, '')}${path}`;
    try {
      return await fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: this.authHeader() },
        // Orthanc is on the private network; a hung request must not hold a
        // request thread open indefinitely.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      // Never include the URL or the auth header in the thrown message — it
      // propagates toward the client and would disclose internal topology (§6).
      this.logger.error(
        `Orthanc request failed (${path}): ${err instanceof Error ? err.message : 'unknown'}`,
      );
      throw new Error('Imaging server unavailable');
    }
  }
}
