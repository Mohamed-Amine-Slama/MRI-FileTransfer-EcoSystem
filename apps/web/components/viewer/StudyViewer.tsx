'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Contrast,
  Download,
  Move,
  RotateCcw,
  Ruler,
  SunMedium,
  Triangle,
  ZoomIn,
} from 'lucide-react';
import { Badge, Button, Select } from '../ui';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n/provider';
import { authedFetch } from '../../lib/viewer/authed-fetch';
import {
  canRenderFullFidelity,
  type CornerstoneViewer,
  type ViewerTool,
} from '../../lib/viewer/cornerstone';
import { groupSeries, type SeriesGroup } from '../../lib/viewer/series';
import { withTimeout } from '../../lib/viewer/with-timeout';

/**
 * The study viewer — BUILD_SPEC P9.1, spec 2026-09-21 §6.
 *
 * THE 5-SECOND BUDGET SHAPES THE LOAD ORDER.
 * The gate is "time to first rendered image under 5 seconds at 2 Mbit/s with
 * 200 ms latency" — roughly 1.2 MB total, including HTML, JS and TLS setup.
 * Cornerstone3D plus vtk.js exceeds that on its own, so it cannot be in the
 * critical path.
 *
 *   1. render the shell immediately (no data needed)
 *   2. fetch the instance list — UIDs only, no pixels
 *   3. fetch ONE small JPEG thumbnail — this is "first rendered image"
 *   4. THEN dynamically import Cornerstone and upgrade to full fidelity: the
 *      series as a stack, with the reading tools
 *   5. further frames load only around the slice being read
 *
 * If step 4 never completes — slow link, no WebGL, old browser — the doctor
 * keeps a usable image instead of an empty pane. Degrading to the thumbnail is
 * a feature, not a fallback nobody tested: the e2e suite asserts the
 * first-paint path still meets the gate.
 *
 * NEVER DOWNLOAD THE WHOLE STUDY UP FRONT. A 120-slice CT is ~200 MB; on this
 * link that is twenty minutes with nothing on screen for nineteen of them.
 */

interface Instance {
  sopInstanceUid: string;
  seriesInstanceUid: string;
}

/** Study-level facts, parsed out of the QIDO-RS DICOM JSON (P8.1). */
interface StudyInfo {
  description: string | null;
  date: string | null;
  modalities: string | null;
  instances: string | null;
}

/**
 * Pull one tag's first value out of a DICOM JSON dataset, defensively: QIDO
 * responses omit tags freely, and the dev in-memory Orthanc returns null.
 */
function tagValue(dataset: unknown, tag: string): string | null {
  if (typeof dataset !== 'object' || dataset === null) return null;
  const entry = (dataset as Record<string, unknown>)[tag];
  if (typeof entry !== 'object' || entry === null) return null;
  const value = (entry as { Value?: unknown }).Value;
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((v) => String(v)).join(', ');
}

/** DICOM DA is YYYYMMDD; show it dashed rather than raw. */
function formatDicomDate(da: string | null): string | null {
  if (da === null || !/^\d{8}$/.test(da)) return da;
  return `${da.slice(0, 4)}-${da.slice(4, 6)}-${da.slice(6, 8)}`;
}

type Fidelity = 'thumbnail' | 'loading-full' | 'full' | 'unavailable';

const TOOLS: { tool: ViewerTool; testId: string; Icon: typeof Move }[] = [
  { tool: 'windowLevel', testId: 'tool-window-level', Icon: SunMedium },
  { tool: 'pan', testId: 'tool-pan', Icon: Move },
  { tool: 'zoom', testId: 'tool-zoom', Icon: ZoomIn },
  { tool: 'length', testId: 'tool-length', Icon: Ruler },
  { tool: 'angle', testId: 'tool-angle', Icon: Triangle },
];

export function StudyViewer({
  studyUid,
  compact = false,
}: {
  studyUid: string;
  /** Beside the report form: the viewport fills its column. */
  compact?: boolean;
}): React.JSX.Element {
  const t = useT();

  const [instances, setInstances] = useState<Instance[]>([]);
  const [studyInfo, setStudyInfo] = useState<StudyInfo | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const [seriesIndex, setSeriesIndex] = useState(0);
  const [slice, setSlice] = useState(0);
  const [tool, setTool] = useState<ViewerTool>('windowLevel');
  const [firstImageReady, setFirstImageReady] = useState(false);
  const [fidelity, setFidelity] = useState<Fidelity>('thumbnail');
  const [error, setError] = useState<string | null>(null);

  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null);
  const [upgradeTimedOut, setUpgradeTimedOut] = useState(false);

  const groups = useMemo(() => groupSeries(instances), [instances]);
  const group: SeriesGroup | undefined = groups[seriesIndex];
  const sops = group?.sopInstanceUids ?? [];
  const count = sops.length;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<CornerstoneViewer | null>(null);
  const upgradeStarted = useRef(false);
  // Read by the upgrade effect without being its dependencies (see below).
  const groupRef = useRef<SeriesGroup | undefined>(undefined);
  groupRef.current = group;
  const sliceRef = useRef(0);
  sliceRef.current = slice;

  // --- step 2: instance list (UIDs only) ------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authedFetch(`/api/dicom-web/studies/${studyUid}/instances`);
        if (!res.ok) throw new Error(`study unavailable (${res.status})`);
        const body = (await res.json()) as { instances: Instance[] };
        if (!cancelled) setInstances(body.instances);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load study');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studyUid]);

  // Study-level QIDO metadata: what the study IS (description, date, modality,
  // size). Fails soft — the viewer works without it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authedFetch(`/api/dicom-web/studies/${studyUid}/metadata`);
        if (!res.ok) return;
        const body: unknown = await res.json();
        const dataset = Array.isArray(body) ? (body[0] as unknown) : body;
        if (dataset === null || cancelled) return;
        setStudyInfo({
          description: tagValue(dataset, '00081030'),
          date: formatDicomDate(tagValue(dataset, '00080020')),
          modalities: tagValue(dataset, '00080061'),
          instances: tagValue(dataset, '00201208'),
        });
      } catch {
        // No panel, no error: metadata is a convenience here.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studyUid]);

  // --- step 3: the preview image, fetched WITH the session -----------------
  //
  // A plain <img src> cannot carry the bearer token, so the preview is fetched
  // as a blob and shown through an object URL. The object URL lives only in
  // this tab's memory and is revoked when the slice changes — nothing is
  // written to a cache or to disk (ADR-4, P2.4). Not fetched once the full
  // view is up: a wheel scroll would otherwise pull a JPEG per slice.
  const currentSop = sops[slice];
  // A boolean, not `fidelity`: preview → loading → unavailable must not
  // re-fetch the same thumbnail at every step.
  const isFull = fidelity === 'full';
  useEffect(() => {
    if (currentSop === undefined || isFull) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await authedFetch(
          `/api/dicom-web/studies/${studyUid}/instances/${currentSop}/thumbnail`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailSrc(objectUrl);
      } catch {
        if (!cancelled) setError(t.viewerPreviewFailed);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [studyUid, currentSop, isFull, t]);

  // --- step 4: upgrade to full fidelity, ONCE, after the preview is up -------
  //
  // It depends on nothing it sets. An earlier version listed `fidelity` in its
  // own dependencies and set it to 'loading-full': the re-run cancelled the
  // first run, the second returned early, and the page sat on "Loading full
  // resolution…" forever with the Cornerstone canvas at opacity 0. The series
  // and position it needs are read through refs for the same reason.
  useEffect(() => {
    if (!firstImageReady || upgradeStarted.current) return;
    upgradeStarted.current = true;
    // The line between the critical path and the upgrade: everything fetched
    // before this mark is what the doctor waited on to see a pixel (the P9.1
    // bundle budget in e2e/viewer.spec.ts is measured against it).
    performance.mark('mir:viewer-first-image');
    if (!canRenderFullFidelity()) {
      // No WebGL2. Do not download a megabyte that can only fail.
      setFidelity('unavailable');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    setFidelity('loading-full');

    void (async () => {
      try {
        const { createViewer } = await import('../../lib/viewer/cornerstone');
        const element = viewportRef.current;
        if (cancelled || element === null) return;

        const viewer = await withTimeout(createViewer({ element, studyUid }), 15_000);
        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;

        const current = groupRef.current;
        if (current !== undefined) {
          await withTimeout(
            viewer.loadSeries(current.seriesInstanceUid, current.sopInstanceUids, sliceRef.current),
            15_000,
          );
        }
        // The wheel scrolls inside Cornerstone; this keeps the counter true.
        unsubscribe = viewer.onSliceChange(setSlice);
        if (!cancelled) setFidelity('full');
      } catch (err) {
        // Keep the preview. A viewer that fails to upgrade is still a viewer;
        // a blank viewport is not — and a spinner that never ends is worse.
        if (cancelled) return;
        setUpgradeTimedOut(err instanceof Error && err.message === 'timeout');
        setFidelity('unavailable');
      }
    })();

    return () => {
      // React strict mode runs effects twice in development. Resetting the
      // guard and destroying the engine lets the second run start cleanly and
      // keeps exactly one engine alive.
      cancelled = true;
      upgradeStarted.current = false;
      unsubscribe?.();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [firstImageReady, studyUid]);

  useEffect(
    () => () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    },
    [],
  );

  /** Move to a slice: the counter now, the full view too when it is up. */
  const goTo = (index: number): void => {
    const next = Math.max(0, Math.min(count - 1, index));
    setSlice(next);
    if (fidelity === 'full') {
      void viewerRef.current?.setSlice(next).catch(() => setFidelity('unavailable'));
    }
  };

  const chooseSeries = (index: number): void => {
    const next = groups[index];
    if (next === undefined) return;
    setSeriesIndex(index);
    setSlice(0);
    if (fidelity === 'full') {
      void viewerRef.current
        ?.loadSeries(next.seriesInstanceUid, next.sopInstanceUids, 0)
        .catch(() => setFidelity('unavailable'));
    }
  };

  const chooseTool = (next: ViewerTool): void => {
    viewerRef.current?.setTool(next);
    setTool(next);
  };

  const showThumbnail = fidelity !== 'full';

  /**
   * WADO-RS retrieve of the ORIGINAL instance (P8.2) — the untouched DICOM,
   * for a doctor who wants it on their own workstation too. Fetched with the
   * session and saved via a blob, so auth never leaks into a URL.
   */
  const downloadOriginal = async (): Promise<void> => {
    if (group === undefined || currentSop === undefined) return;
    setDownloadError(false);
    try {
      const res = await authedFetch(
        `/api/dicom-web/studies/${studyUid}` +
          `/series/${encodeURIComponent(group.seriesInstanceUid)}` +
          `/instances/${encodeURIComponent(currentSop)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentSop}.dcm`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(true);
    }
  };

  return (
    <section
      className="space-y-4"
      data-testid="viewer"
      data-study-uid={studyUid}
      data-fidelity={fidelity}
    >
      {studyInfo !== null && (
        <dl
          data-testid="study-info"
          className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-card px-4 py-2.5 text-sm"
        >
          {studyInfo.description !== null && (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t.colDescription}:</dt>
              <dd className="font-medium">{studyInfo.description}</dd>
            </div>
          )}
          {studyInfo.date !== null && (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t.colDate}:</dt>
              <dd className="font-medium tabular-nums">{studyInfo.date}</dd>
            </div>
          )}
          {studyInfo.modalities !== null && (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t.viewerModality}:</dt>
              <dd className="font-medium">{studyInfo.modalities}</dd>
            </div>
          )}
          {studyInfo.instances !== null && (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t.colImages}:</dt>
              <dd className="font-medium tabular-nums">{studyInfo.instances}</dd>
            </div>
          )}
        </dl>
      )}

      {error !== null && (
        <p data-testid="viewer-error" role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {groups.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{t.viewerSeries}</span>
          <Select
            className="max-w-xs"
            value={seriesIndex}
            onChange={(e) => chooseSeries(Number(e.target.value))}
            data-testid="series-picker"
          >
            {groups.map((g, i) => (
              <option key={g.seriesInstanceUid} value={i}>
                {`${t.viewerSeries} ${i + 1} (${g.sopInstanceUids.length})`}
              </option>
            ))}
          </Select>
        </label>
      )}

      {fidelity === 'full' && (
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t.viewerTools}>
          {TOOLS.map(({ tool: id, testId, Icon }) => (
            <Button
              key={id}
              size="sm"
              variant={tool === id ? 'primary' : 'default'}
              aria-pressed={tool === id}
              data-testid={testId}
              onClick={() => chooseTool(id)}
            >
              <Icon aria-hidden="true" />
              {
                {
                  windowLevel: t.viewerToolWindowLevel,
                  pan: t.viewerToolPan,
                  zoom: t.viewerToolZoom,
                  length: t.viewerToolLength,
                  angle: t.viewerToolAngle,
                }[id]
              }
            </Button>
          ))}
          <Button size="sm" data-testid="tool-invert" onClick={() => viewerRef.current?.invert()}>
            <Contrast aria-hidden="true" />
            {t.viewerInvert}
          </Button>
          <Button
            size="sm"
            data-testid="tool-auto-window"
            onClick={() => viewerRef.current?.autoWindow()}
          >
            {t.viewerAutoWindow}
          </Button>
          <Button size="sm" data-testid="tool-reset" onClick={() => viewerRef.current?.reset()}>
            <RotateCcw aria-hidden="true" />
            {t.viewerReset}
          </Button>
        </div>
      )}

      {/* The viewport keeps a hand-set dark ground in both themes: medical
          imagery is judged against black, not against the page surface. The
          context menu is suppressed so a right-drag zooms. */}
      <div
        className={cn(
          'relative aspect-square overflow-hidden rounded-lg border bg-black',
          compact ? 'w-full' : 'max-w-lg',
        )}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Cornerstone renders here once loaded. Kept mounted so the canvas
            has a stable element to attach to. */}
        <div
          ref={viewportRef}
          data-testid="cornerstone-viewport"
          className="absolute inset-0"
          style={{ opacity: fidelity === 'full' ? 1 : 0 }}
        />

        {showThumbnail && currentSop !== undefined && thumbnailSrc !== null && (
          // Plain <img>, deliberately not next/image: the Next image optimiser
          // caches to disk and re-encodes. Caching patient imaging outside the
          // controlled buckets, and re-encoding it, are both unacceptable
          // (ADR-4, P2.4).
          <img
            data-testid="current-image"
            data-sop-uid={currentSop}
            src={thumbnailSrc}
            alt=""
            width={256}
            height={256}
            // Fills the viewport like Cornerstone's fit, so the image does not
            // jump in size when the full-fidelity view replaces it.
            className="absolute inset-0 size-full object-contain [image-rendering:pixelated]"
            onLoad={() => setFirstImageReady(true)}
            onError={() => setError(t.viewerPreviewFailed)}
          />
        )}

        {currentSop === undefined && (
          <span
            data-testid="viewport-placeholder"
            className="absolute inset-0 grid place-items-center text-neutral-500"
          >
            …
          </span>
        )}
      </div>

      {/* Marker the throttled test polls for: a real image is on screen. */}
      {firstImageReady && <span data-testid="first-image-rendered" hidden />}
      {fidelity === 'full' && <span data-testid="full-fidelity-rendered" hidden />}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          data-testid="prev-image"
          onClick={() => goTo(slice - 1)}
          disabled={count <= 1 || slice === 0}
        >
          <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
          {t.viewerPrev}
        </Button>
        <input
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          value={slice}
          disabled={count <= 1}
          aria-label={t.viewerSlice}
          onChange={(e) => goTo(Number(e.target.value))}
          className="w-40"
          data-testid="slice-slider"
        />
        <span data-testid="image-position" className="min-w-16 text-center text-sm tabular-nums">
          {count === 0 ? '0 / 0' : `${slice + 1} / ${count}`}
        </span>
        <Button
          size="sm"
          data-testid="next-image"
          onClick={() => goTo(slice + 1)}
          disabled={count <= 1 || slice >= count - 1}
        >
          {t.viewerNext}
          <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
        </Button>

        <span data-testid="fidelity-label">
          <Badge tone={fidelity === 'full' ? 'success' : undefined}>
            {fidelity === 'full'
              ? t.viewerFidelityFull
              : fidelity === 'loading-full'
                ? t.viewerFidelityLoading
                : fidelity === 'unavailable'
                  ? t.viewerFidelityPreviewOnly
                  : t.viewerFidelityPreview}
          </Badge>
        </span>

        {upgradeTimedOut && (
          <span role="status" className="text-sm text-muted-foreground" data-testid="full-timeout">
            {t.viewerFullTimeout}
          </span>
        )}

        <span className="ms-auto">
          <Button
            size="sm"
            data-testid="download-original"
            disabled={currentSop === undefined}
            onClick={() => void downloadOriginal()}
          >
            <Download aria-hidden="true" />
            {t.viewerDownload}
          </Button>
        </span>
      </div>

      {downloadError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {t.viewerDownloadFailed}
        </p>
      )}
    </section>
  );
}
