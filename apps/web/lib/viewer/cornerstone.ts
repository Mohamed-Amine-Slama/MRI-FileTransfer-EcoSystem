/**
 * Cornerstone3D integration — BUILD_SPEC P9.1.
 *
 * LOADED LAZILY, ON PURPOSE.
 *
 * The P9.1 gate is "time to first rendered image under 5 seconds at 2 Mbit/s
 * with 200 ms latency". 2 Mbit/s is 256 KB/s, so the whole budget is roughly
 * 1.2 MB. Cornerstone3D plus its vtk.js dependency is far larger than that on
 * its own. Importing it from the page module would put it in the critical path
 * and blow the budget before a single pixel was drawn.
 *
 * So the ordering is: thumbnail first (small JPEG, already on screen inside a
 * second), and this module is dynamically imported afterwards to upgrade the
 * view to full fidelity. If it never loads — slow link, old browser, no WebGL —
 * the doctor still has a usable reference image rather than a blank pane.
 *
 * WHAT "FULL FIDELITY" MEANS HERE, AND WHAT IT DOES NOT:
 * Cornerstone renders the ORIGINAL 16-bit pixel data with real window/level,
 * rather than the 8-bit heuristically-levelled preview. That is a genuine
 * improvement and it is what lets a doctor judge whether a study is worth
 * opening on their diagnostic workstation. It is still NOT a diagnostic
 * viewer, the banner still says so, and §1.3 still holds — an uncertified
 * viewer used for diagnosis is what puts a product inside medical-device
 * regulation.
 */

import { authHeaders, authedFetch } from './authed-fetch';

export interface CornerstoneViewer {
  /**
   * Display one instance. The SERIES is required: Orthanc's WADO-RS addresses
   * an instance only under its series, and the series-less form 404s.
   */
  showInstance(sopInstanceUid: string, seriesInstanceUid: string): Promise<void>;
  /** Apply window centre/width in the image's own units. */
  setWindow(center: number, width: number): void;
  /** Reset window/level to the values in the DICOM header. */
  resetWindow(): void;
  destroy(): void;
}

export interface ViewerInit {
  element: HTMLDivElement;
  studyUid: string;
  /** Base path of the DICOMweb proxy. Never Orthanc directly (P8.2). */
  apiBase?: string;
}

let initialised = false;

/**
 * One-time Cornerstone initialisation.
 *
 * Cornerstone keeps global state (rendering engines, the image-loader
 * registry), so this must happen exactly once per page even if several viewers
 * mount.
 */
async function ensureInitialised(apiBase: string): Promise<{
  core: typeof import('@cornerstonejs/core');
  loader: typeof import('@cornerstonejs/dicom-image-loader');
}> {
  const [core, loader] = await Promise.all([
    import('@cornerstonejs/core'),
    import('@cornerstonejs/dicom-image-loader'),
  ]);

  if (!initialised) {
    await core.init();

    loader.init({
      // Credentials must ride along: every DICOMweb request is authorised and
      // audited by the API (P8.2). An unauthenticated fetch would 401, and —
      // worse — a request that somehow succeeded without the session would be
      // an access with no audit row.
      //
      // RETURN the header, do not set it on the xhr. The loader merges what
      // this returns into the request headers, and its streaming path calls
      // beforeSend with `xhr === null` — touching the xhr there throws.
      // Until 2026-09-21 this only set `withCredentials` (a cookie this stack
      // never issues), so every frame request went out unauthenticated.
      beforeSend: (xhr: XMLHttpRequest | null) => {
        if (xhr !== null) xhr.withCredentials = true;
        return authHeaders();
      },
      // Decoding happens in web workers. On a clinic laptop, decoding a
      // 512x512 16-bit frame on the main thread visibly freezes the UI.
      maxWebWorkers: Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 2)),
    });

    // Register the WADO-RS metadata provider.
    //
    // A `wadors:` image id carries pixels only. Cornerstone needs Rows,
    // Columns, BitsAllocated, PixelRepresentation, RescaleSlope/Intercept and
    // the VOI LUT before those bytes mean anything — and it obtains them from
    // this provider, not from the frame response. Skip this and setStack()
    // fails with an opaque metadata error rather than an obvious one.
    core.metaData.addProvider(
      // NOTE: nested under `metaData`, not directly on `wadors` (v3 layout).
      (type: string, imageId: string) => loader.wadors.metaData.metaDataProvider(type, imageId),
      // Low priority: our provider is a fallback behind anything Cornerstone
      // already knows.
      10_000,
    );

    initialised = true;
  }

  void apiBase;
  return { core, loader };
}

/**
 * Fetch DICOM JSON metadata for one instance and register it.
 *
 * Must complete BEFORE the image id is displayed. Cached per image id: a
 * doctor scrolling back and forth through a series should not re-fetch
 * metadata that cannot have changed — the study is immutable (ADR-4).
 */
async function registerInstanceMetadata(
  loader: typeof import('@cornerstonejs/dicom-image-loader'),
  apiBase: string,
  studyUid: string,
  seriesInstanceUid: string,
  sopInstanceUid: string,
  imageId: string,
): Promise<void> {
  if (metadataRegistered.has(imageId)) return;

  const res = await authedFetch(
    `${apiBase}/dicom-web/studies/${encodeURIComponent(studyUid)}` +
      `/series/${encodeURIComponent(seriesInstanceUid)}` +
      `/instances/${encodeURIComponent(sopInstanceUid)}/metadata`,
    { headers: { accept: 'application/dicom+json' } },
  );
  if (!res.ok) throw new Error(`metadata unavailable (${res.status})`);

  const json = (await res.json()) as unknown;
  // DICOMweb returns an array of instances; a per-instance request returns one.
  const instance = Array.isArray(json) ? json[0] : json;
  if (instance === undefined) throw new Error('empty metadata');

  loader.wadors.metaDataManager.add(imageId, instance as never);
  metadataRegistered.add(imageId);
}

const metadataRegistered = new Set<string>();

/**
 * Create a viewer bound to a DOM element.
 *
 * Throws if WebGL is unavailable — the caller keeps the thumbnail on screen
 * rather than showing an empty viewport.
 */
export async function createViewer(init: ViewerInit): Promise<CornerstoneViewer> {
  const apiBase = init.apiBase ?? '/api';
  const { core, loader: loaderRef } = await ensureInitialised(apiBase);

  const renderingEngineId = `mir-engine-${init.studyUid}`;
  const viewportId = 'mir-viewport';

  const engine = new core.RenderingEngine(renderingEngineId);

  engine.enableElement({
    viewportId,
    type: core.Enums.ViewportType.STACK,
    element: init.element,
    defaultOptions: {
      background: [0, 0, 0] as [number, number, number],
    },
  });

  const viewport = engine.getViewport(viewportId) as import('@cornerstonejs/core').Types.IStackViewport;

  /**
   * wadors: image ids route through OUR proxy, not Orthanc.
   *
   * P8.2's gate is that no path exists from the browser to Orthanc that
   * bypasses the API. Cornerstone will happily fetch whatever URL it is given,
   * so the URL construction is the control — and it lives here, in one place.
   */
  const imageIdFor = (sopInstanceUid: string, seriesInstanceUid: string): string =>
    `wadors:${apiBase}/dicom-web/studies/${init.studyUid}` +
    `/series/${seriesInstanceUid}/instances/${sopInstanceUid}/frames/1`;

  return {
    async showInstance(sopInstanceUid: string, seriesInstanceUid: string): Promise<void> {
      const imageId = imageIdFor(sopInstanceUid, seriesInstanceUid);
      // Metadata first — the frame bytes are meaningless without it.
      await registerInstanceMetadata(
        loaderRef,
        apiBase,
        init.studyUid,
        seriesInstanceUid,
        sopInstanceUid,
        imageId,
      );
      await viewport.setStack([imageId], 0);
      viewport.render();
    },

    setWindow(center: number, width: number): void {
      viewport.setProperties({ voiRange: windowToRange(center, width) });
      viewport.render();
    },

    resetWindow(): void {
      // `true` resets to the values carried in the DICOM header rather than to
      // an arbitrary default — the header values are what the scanner intended.
      viewport.resetProperties();
      viewport.render();
    },

    destroy(): void {
      try {
        engine.destroy();
      } catch {
        // Already torn down (React strict mode double-invokes effects).
      }
    },
  };
}

/** DICOM window centre/width to Cornerstone's lower/upper VOI range. */
export function windowToRange(center: number, width: number): { lower: number; upper: number } {
  const half = width / 2;
  return { lower: center - half, upper: center + half };
}

/**
 * Is full-fidelity rendering possible in this browser?
 *
 * Checked BEFORE importing Cornerstone: on a device without WebGL2 the import
 * is a megabyte of download that can only fail, and on a Libyan mobile
 * connection that is a real cost paid for nothing.
 */
export function canRenderFullFidelity(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
