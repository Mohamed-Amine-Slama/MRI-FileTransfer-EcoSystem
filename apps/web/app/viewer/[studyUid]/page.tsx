'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { DiagnosticUseBanner } from '../../../components/DiagnosticUseBanner';
import { Badge, Button, Main } from '../../../components/ui';
import { useT } from '../../../lib/i18n/provider';
import { canRenderFullFidelity, type CornerstoneViewer } from '../../../lib/viewer/cornerstone';

/**
 * Reference viewer — BUILD_SPEC P9.1.
 *
 * THE 5-SECOND BUDGET SHAPES THE LOAD ORDER.
 * The gate is "time to first rendered image under 5 seconds at 2 Mbit/s with
 * 200 ms latency" — roughly 1.2 MB total, including HTML, JS and TLS setup.
 * Cornerstone3D plus vtk.js exceeds that on its own, so it cannot be in the
 * critical path.
 *
 *   1. render the shell and the banner immediately (no data needed)
 *   2. fetch the instance list — UIDs only, no pixels
 *   3. fetch ONE small JPEG thumbnail — this is "first rendered image"
 *   4. THEN dynamically import Cornerstone and upgrade to full fidelity
 *   5. further frames load only as the doctor navigates to them
 *
 * If step 4 never completes — slow link, no WebGL, old browser — the doctor
 * keeps a usable reference image instead of an empty pane. Degrading to the
 * thumbnail is a feature, not a fallback nobody tested: the e2e suite asserts
 * the first-paint path still meets the gate.
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

export default function ViewerPage({ params }: { params: Promise<{ studyUid: string }> }) {
  const { studyUid } = use(params);
  const t = useT();

  const [instances, setInstances] = useState<Instance[]>([]);
  const [studyInfo, setStudyInfo] = useState<StudyInfo | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const [current, setCurrent] = useState(0);
  const [firstImageReady, setFirstImageReady] = useState(false);
  const [fidelity, setFidelity] = useState<Fidelity>('thumbnail');
  const [error, setError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<CornerstoneViewer | null>(null);

  const thumbnailUrl = useCallback(
    (sopUid: string) => `/api/dicom-web/studies/${studyUid}/instances/${sopUid}/thumbnail`,
    [studyUid],
  );

  // --- step 2: instance list (UIDs only) ------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/dicom-web/studies/${studyUid}/instances`, {
          credentials: 'include',
        });
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
  // size), so the receiving doctor can decide whether to pull it onto their
  // own equipment. Fails soft — the viewer works without it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/dicom-web/studies/${studyUid}/metadata`, {
          credentials: 'include',
        });
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

  // --- step 4: upgrade to full fidelity, AFTER the thumbnail is on screen ---
  useEffect(() => {
    if (!firstImageReady || fidelity !== 'thumbnail') return;
    if (!canRenderFullFidelity()) {
      // No WebGL2. Do not download a megabyte that can only fail.
      setFidelity('unavailable');
      return;
    }

    let cancelled = false;
    setFidelity('loading-full');

    void (async () => {
      try {
        const { createViewer } = await import('../../../lib/viewer/cornerstone');
        const element = viewportRef.current;
        if (cancelled || element === null) return;

        const viewer = await createViewer({ element, studyUid });
        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;

        const instance = instances[current];
        if (instance !== undefined) {
          await viewer.showInstance(instance.sopInstanceUid, instance.seriesInstanceUid);
        }
        if (!cancelled) setFidelity('full');
      } catch {
        // Keep the thumbnail. A viewer that fails to upgrade is still a
        // viewer; a blank viewport is not.
        if (!cancelled) setFidelity('unavailable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firstImageReady, fidelity, instances, current, studyUid]);

  // --- navigation: one frame at a time, never a prefetch --------------------
  useEffect(() => {
    if (fidelity !== 'full') return;
    const viewer = viewerRef.current;
    const instance = instances[current];
    if (viewer === null || instance === undefined) return;
    void viewer
      .showInstance(instance.sopInstanceUid, instance.seriesInstanceUid)
      .catch(() => setFidelity('unavailable'));
  }, [current, fidelity, instances]);

  useEffect(
    () => () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    },
    [],
  );

  const currentInstance = instances[current];
  const showThumbnail = fidelity !== 'full';

  /**
   * WADO-RS retrieve of the ORIGINAL instance (P8.2) — the untouched DICOM,
   * not the 8-bit reference rendering. This is the handoff the banner points
   * at: the diagnostic read happens on the doctor's own validated equipment,
   * and this is how the data gets there. Fetched with credentials (like every
   * other viewer request) and saved via a blob, so auth never leaks into a URL.
   */
  const downloadOriginal = async (): Promise<void> => {
    const instance = instances[current];
    if (instance === undefined) return;
    setDownloadError(false);
    try {
      const res = await fetch(
        `/api/dicom-web/studies/${studyUid}` +
          `/series/${encodeURIComponent(instance.seriesInstanceUid)}` +
          `/instances/${encodeURIComponent(instance.sopInstanceUid)}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${instance.sopInstanceUid}.dcm`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(true);
    }
  };

  return (
    <Main data-testid="viewer" data-study-uid={studyUid} data-fidelity={fidelity}>
      {/* Rendered before any data arrives, and never removable. */}
      <DiagnosticUseBanner />

      <h1 className="text-xl font-bold tracking-tight">{t.viewerTitle}</h1>

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

      {/* The viewport keeps a hand-set dark ground in both themes: medical
          imagery is judged against black, not against the page surface. */}
      <div className="relative aspect-square max-w-lg overflow-hidden rounded-lg border bg-black">
        {/* Cornerstone renders here once loaded. Kept mounted so the canvas
            has a stable element to attach to. */}
        <div
          ref={viewportRef}
          data-testid="cornerstone-viewport"
          className="absolute inset-0"
          style={{ opacity: fidelity === 'full' ? 1 : 0 }}
        />

        {showThumbnail && currentInstance !== undefined && (
          // Plain <img>, deliberately not next/image: the Next image optimiser
          // caches to disk and re-encodes. Caching patient imaging outside the
          // controlled buckets, and re-encoding it, are both unacceptable
          // (ADR-4, P2.4).
          <img
            data-testid="current-image"
            data-sop-uid={currentInstance.sopInstanceUid}
            src={thumbnailUrl(currentInstance.sopInstanceUid)}
            alt=""
            width={256}
            height={256}
            className="absolute inset-0 m-auto h-auto max-w-full [image-rendering:pixelated]"
            onLoad={() => setFirstImageReady(true)}
            onError={() => setError('Preview unavailable for this image')}
          />
        )}

        {currentInstance === undefined && (
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
          onClick={() => setCurrent((i) => Math.max(0, i - 1))}
          disabled={current === 0}
        >
          <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
          {t.viewerPrev}
        </Button>
        <span data-testid="image-position" className="min-w-16 text-center text-sm tabular-nums">
          {instances.length === 0 ? '0 / 0' : `${current + 1} / ${instances.length}`}
        </span>
        <Button
          size="sm"
          data-testid="next-image"
          onClick={() => setCurrent((i) => Math.min(instances.length - 1, i + 1))}
          disabled={current >= instances.length - 1}
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

        <span className="ms-auto">
          <Button
            size="sm"
            data-testid="download-original"
            disabled={currentInstance === undefined}
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

      {fidelity === 'full' && (
        <div className="flex flex-wrap gap-2">
          {/* Window presets. Values are conventional CT ranges; the doctor is
              judging whether to open this on their workstation, not reading. */}
          <Button size="sm" data-testid="window-soft" onClick={() => viewerRef.current?.setWindow(40, 400)}>
            {t.viewerWindowSoft}
          </Button>
          <Button size="sm" data-testid="window-lung" onClick={() => viewerRef.current?.setWindow(-600, 1500)}>
            {t.viewerWindowLung}
          </Button>
          <Button size="sm" data-testid="window-bone" onClick={() => viewerRef.current?.setWindow(300, 1500)}>
            {t.viewerWindowBone}
          </Button>
          <Button size="sm" data-testid="window-reset" onClick={() => viewerRef.current?.resetWindow()}>
            {t.viewerWindowReset}
          </Button>
        </div>
      )}

      <p className="text-sm text-muted-foreground">{t.viewerLazyNote}</p>
    </Main>
  );
}
