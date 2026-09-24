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
 * WHAT "FULL FIDELITY" MEANS HERE: Cornerstone renders the ORIGINAL 16-bit
 * pixel data, one stack per series, with the reading tools a radiologist
 * expects — stack scroll, window/level, pan, zoom, length and angle. The
 * owner decided the platform is where the diagnosis is made (spec decisions,
 * 2026-09-24), so this is the diagnostic viewer, not a preview of one.
 */

import { authHeaders, authedFetch } from './authed-fetch';

export type ViewerTool =
  | 'windowLevel'
  | 'pan'
  | 'zoom'
  | 'length'
  | 'angle'
  /** Mean / std-dev / area inside an ellipse: MRI signal comparison. */
  | 'ellipseRoi'
  /** The pixel value under one point. */
  | 'probe';

export interface CornerstoneViewer {
  /**
   * Show one series as a scrollable stack, starting at `startIndex`. The
   * SERIES is required: Orthanc's WADO-RS addresses an instance only under
   * its series, and the series-less form 404s.
   */
  loadSeries(seriesInstanceUid: string, sopInstanceUids: string[], startIndex: number): Promise<void>;
  setSlice(index: number): Promise<void>;
  /** Called whenever the shown slice changes, wheel included. Returns the remover. */
  onSliceChange(cb: (index: number) => void): () => void;
  /** The tool on the primary (left) button. */
  setTool(tool: ViewerTool): void;
  invert(): void;
  /** Back to the window in the DICOM header, keeping inversion. */
  autoWindow(): void;
  /** Quarter turn clockwise. */
  rotate(): void;
  flipHorizontal(): void;
  flipVertical(): void;
  /** Remove every drawn length, angle, ROI and probe. */
  clearMeasurements(): void;
  reset(): void;
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
  tools: typeof import('@cornerstonejs/tools');
}> {
  const [core, loader, tools] = await Promise.all([
    import('@cornerstonejs/core'),
    import('@cornerstonejs/dicom-image-loader'),
    import('@cornerstonejs/tools'),
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

    tools.init();
    // The default prefetches the WHOLE stack (maxImagesToPrefetch: Infinity) —
    // a 120-slice CT is the full-study download this module exists to avoid.
    // Five each side of the visible slice, and a scroll drops the stale queue.
    tools.utilities.stackPrefetch.setConfiguration({ maxImagesToPrefetch: 5, preserveExistingPool: false });
    for (const Tool of [
      tools.StackScrollTool,
      tools.WindowLevelTool,
      tools.PanTool,
      tools.ZoomTool,
      tools.LengthTool,
      tools.AngleTool,
      tools.EllipticalROITool,
      tools.ProbeTool,
    ]) {
      tools.addTool(Tool);
    }

    initialised = true;
  }

  void apiBase;
  return { core, loader, tools };
}

/** DICOM JSON's SOP Instance UID (0008,0018). */
function sopUidOf(instance: unknown): string | undefined {
  const tag = (instance as Record<string, { Value?: unknown[] }> | null)?.['00080018'];
  const v = tag?.Value?.[0];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Create a viewer bound to a DOM element.
 *
 * Throws if WebGL is unavailable — the caller keeps the thumbnail on screen
 * rather than showing an empty viewport.
 */
export async function createViewer(init: ViewerInit): Promise<CornerstoneViewer> {
  const apiBase = init.apiBase ?? '/api';
  const { core, loader, tools } = await ensureInitialised(apiBase);

  const renderingEngineId = `mir-engine-${init.studyUid}`;
  const viewportId = 'mir-viewport';
  const toolGroupId = `mir-tools-${init.studyUid}`;

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

  // React strict mode mounts twice: a group left by the first mount would
  // make createToolGroup return undefined.
  tools.ToolGroupManager.destroyToolGroup(toolGroupId);
  const group = tools.ToolGroupManager.createToolGroup(toolGroupId);
  if (group === undefined) throw new Error('tool group unavailable');
  const toolNames: Record<ViewerTool, string> = {
    windowLevel: tools.WindowLevelTool.toolName,
    pan: tools.PanTool.toolName,
    zoom: tools.ZoomTool.toolName,
    length: tools.LengthTool.toolName,
    angle: tools.AngleTool.toolName,
    ellipseRoi: tools.EllipticalROITool.toolName,
    probe: tools.ProbeTool.toolName,
  };
  group.addTool(tools.StackScrollTool.toolName);
  for (const name of Object.values(toolNames)) group.addTool(name);
  group.addViewport(viewportId, renderingEngineId);
  const { MouseBindings } = tools.Enums;
  group.setToolActive(tools.StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
  group.setToolActive(toolNames.windowLevel, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  group.setToolActive(toolNames.pan, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
  group.setToolActive(toolNames.zoom, { bindings: [{ mouseButton: MouseBindings.Secondary }] });
  let primary: ViewerTool = 'windowLevel';

  // The canvas follows its element: full screen, a resized window, or the
  // compact column beside the report. Without this Cornerstone keeps the size
  // it was created at and the image sits small in a corner of the screen.
  const resizeObserver = new ResizeObserver(() => engine.resize(true, true));
  resizeObserver.observe(init.element);

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

  /**
   * Metadata for the whole series in ONE request, registered per image id
   * before the stack is set: a `wadors:` id carries pixels only. Cached per
   * series — the study is immutable (ADR-4).
   */
  const registeredSeries = new Set<string>();
  const registerSeriesMetadata = async (seriesInstanceUid: string): Promise<void> => {
    if (registeredSeries.has(seriesInstanceUid)) return;
    const res = await authedFetch(
      `${apiBase}/dicom-web/studies/${encodeURIComponent(init.studyUid)}` +
        `/series/${encodeURIComponent(seriesInstanceUid)}/metadata`,
      { headers: { accept: 'application/dicom+json' } },
    );
    if (!res.ok) throw new Error(`metadata unavailable (${res.status})`);
    const instances = (await res.json()) as unknown;
    if (!Array.isArray(instances)) throw new Error('unexpected series metadata');
    for (const instance of instances) {
      const sop = sopUidOf(instance);
      if (sop !== undefined) {
        loader.wadors.metaDataManager.add(imageIdFor(sop, seriesInstanceUid), instance as never);
      }
    }
    registeredSeries.add(seriesInstanceUid);
  };

  let prefetching = false;

  return {
    async loadSeries(seriesInstanceUid, sopInstanceUids, startIndex): Promise<void> {
      await registerSeriesMetadata(seriesInstanceUid);
      await viewport.setStack(
        sopInstanceUids.map((sop) => imageIdFor(sop, seriesInstanceUid)),
        startIndex,
      );
      // Neighbourhood prefetch around the visible slice — not the whole
      // series, which on a Libyan link would starve the slice being read.
      if (!prefetching) {
        tools.utilities.stackPrefetch.enable(init.element);
        prefetching = true;
      }
      viewport.render();
    },

    async setSlice(index: number): Promise<void> {
      await viewport.setImageIdIndex(index);
    },

    onSliceChange(cb: (index: number) => void): () => void {
      const handler = (): void => cb(viewport.getCurrentImageIdIndex());
      init.element.addEventListener(core.Enums.Events.STACK_NEW_IMAGE, handler);
      return () => init.element.removeEventListener(core.Enums.Events.STACK_NEW_IMAGE, handler);
    },

    setTool(tool: ViewerTool): void {
      if (tool === primary) return;
      // The previous primary goes passive, not disabled: drawn lengths and
      // angles stay on screen.
      group.setToolPassive(toolNames[primary]);
      group.setToolActive(toolNames[tool], { bindings: [{ mouseButton: MouseBindings.Primary }] });
      // Pan and zoom keep their own buttons whatever the primary tool is.
      if (primary === 'pan') {
        group.setToolActive(toolNames.pan, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
      }
      if (primary === 'zoom') {
        group.setToolActive(toolNames.zoom, { bindings: [{ mouseButton: MouseBindings.Secondary }] });
      }
      primary = tool;
    },

    invert(): void {
      viewport.setProperties({ invert: viewport.getProperties().invert !== true });
      viewport.render();
    },

    autoWindow(): void {
      const invert = viewport.getProperties().invert === true;
      viewport.resetProperties();
      viewport.setProperties({ invert });
      viewport.render();
    },

    rotate(): void {
      const { rotation = 0 } = viewport.getViewPresentation();
      viewport.setViewPresentation({ rotation: (rotation + 90) % 360 });
      viewport.render();
    },

    flipHorizontal(): void {
      const { flipHorizontal = false } = viewport.getViewPresentation();
      viewport.setViewPresentation({ flipHorizontal: !flipHorizontal });
      viewport.render();
    },

    flipVertical(): void {
      const { flipVertical = false } = viewport.getViewPresentation();
      viewport.setViewPresentation({ flipVertical: !flipVertical });
      viewport.render();
    },

    clearMeasurements(): void {
      // ponytail: clears every annotation on the page; fine while a page has
      // one viewer, filter by this viewport's FrameOfReference if that changes.
      tools.annotation.state.removeAllAnnotations();
      viewport.render();
    },

    reset(): void {
      viewport.resetCamera();
      viewport.resetProperties();
      viewport.render();
    },

    destroy(): void {
      resizeObserver.disconnect();
      try {
        tools.ToolGroupManager.destroyToolGroup(toolGroupId);
        engine.destroy();
      } catch {
        // Already torn down (React strict mode double-invokes effects).
      }
    },
  };
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
