'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { onCurtainLifted } from '../../../lib/site/curtain';
import { whenIdle } from '../../../lib/site/scroll';
import { useSite } from '../../../lib/site/site-provider';
import { HELIX, HELIX_POSTER } from './helix-config';
import type { HelixFrame, HelixRenderer } from './helix-renderer';

/**
 * The particle helix, over its poster — spec 2026-09-10 §5.4.
 *
 * The server, Tier C and a reduced-motion reader get the poster and nothing
 * else: the renderer module is never even requested. On A and B the canvas
 * sits exactly over the poster (so demotion moves nothing), the renderer is
 * imported from an idle callback after LCP, and the frame loop runs only
 * while the host is on screen and the tab is visible — a permanent rAF for a
 * decoration is a permanent battery cost for someone who is reading.
 *
 * `data-helix-state` is the contract the e2e suite and the poster script read.
 */

export type HelixState = 'poster' | 'loading' | 'running' | 'paused' | 'lost' | 'still';

type Factory = (typeof import('./helix-renderer'))['createHelixRenderer'];

const OFFSCREEN: readonly [number, number] = [-1e4, -1e4];

/*
 * WebGL2 support, probed once per page and cached — spec §5.5/§8: a browser
 * without it must never even request the renderer chunk.
 *
 * `budget.helix` alone is not proof a real context exists: `tier.ts` only
 * gates `webgl2` into its own detection, and a forced `?tier=` (used all over
 * this suite, and reachable by anyone) bypasses detection entirely, so Tier A
 * or B's non-null budget can still land here on a browser with none.
 *
 * Probed on a THROWAWAY canvas, never the real one — a second `getContext`
 * call on the same canvas returns the first context and silently ignores new
 * attributes, which would leave `preserveDrawingBuffer` wrong for a
 * `?helix-still` capture. Memoised at module scope so two `HelixCanvas`
 * instances (Plan 3 mounts a second, in the close scene) probe once, not
 * twice.
 */
let webgl2Support: boolean | null = null;

function supportsWebgl2(): boolean {
  if (webgl2Support === null) webgl2Support = probeWebgl2();
  return webgl2Support;
}

function probeWebgl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function HelixCanvas({
  hostRef,
  entrance,
  posterLoading = 'eager',
  className = '',
}: {
  /** The element whose pointer and scroll drive the helix — normally its section. */
  hostRef: RefObject<HTMLElement | null>;
  /** 'curtain': particles gather when the load curtain lifts. 'none': already assembled. */
  entrance: 'curtain' | 'none';
  posterLoading?: 'eager' | 'lazy';
  className?: string;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { budget, dir } = useSite();
  const [state, setState] = useState<HelixState>('poster');
  const helix = budget.helix;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (helix === null || canvas === null || host === null) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;

    const still = new URLSearchParams(window.location.search).has('helix-still');
    const mirror = dir === 'rtl';
    // Namespaces the performance measures per host — the hero is `#hero`, the
    // close scene (Plan 3) will be `#close`, and two unlabelled instances
    // would collide on the same `helix:build` / `helix:geometry` marks.
    const label = host.id !== '' ? host.id : 'helix';
    let disposed = false;
    let factory: Factory | null = null;
    let renderer: HelixRenderer | null = null;
    let raf = 0;
    let visible = false;
    let spin = 0;
    let last = 0;
    let assemble = entrance === 'none' || still ? 1 : 0;
    let assembling = false;
    let strength = 0;
    let inside = false;
    let lastMove = 0;
    let pointer: readonly [number, number] = OFFSCREEN;

    const scrollProgress = (): number => {
      const rect = host.getBoundingClientRect();
      return rect.height <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / rect.height));
    };

    const draw = (frame: HelixFrame): void => renderer?.render(frame);

    const tick = (now: number): void => {
      raf = 0;
      if (disposed || renderer === null || !visible || document.hidden) return;
      const dt = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const scroll = scrollProgress();
      spin += dt * HELIX.spin * (1 + scroll * (HELIX.scrollSpinBoost - 1));
      if (assembling && assemble < 1) assemble = Math.min(1, assemble + dt / HELIX.assembleSeconds);
      const engaged = inside && now - lastMove < HELIX.pointer.idleMs;
      strength = engaged
        ? strength + (1 - strength) * (1 - Math.exp(-dt * 8))
        : Math.max(0, strength - dt / (HELIX.pointer.releaseMs / 1000));
      draw({ time: now / 1000, spinAngle: spin, assemble, scroll, pointer, pointerStrength: strength });
      raf = requestAnimationFrame(tick);
    };

    const run = (): void => {
      if (still || raf !== 0 || renderer === null || !visible || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(tick);
      setState('running');
    };

    const halt = (next: HelixState): void => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      setState(next);
    };

    const paintStill = (): void => {
      draw({ time: 0, spinAngle: 0, assemble: 1, scroll: 0, pointer: OFFSCREEN, pointerStrength: 0 });
      setState('still');
    };

    const resize = (): void => {
      if (renderer === null) return;
      const rect = canvas.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, helix.dpr));
      if (still) paintStill();
    };

    const create = (): void => {
      if (factory === null) return;
      const started = performance.now();
      renderer = factory(canvas, { count: helix.particles, mirror, preserveDrawingBuffer: still, label });
      performance.measure(`helix:build:${label}`, { start: started, end: performance.now() });
      if (renderer === null) {
        setState('poster');
        return;
      }
      resize();
      run();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      if (visible) {
        /*
         * The renderer is built lazily and only while its host is on screen
         * (spec §5.4/§8) — a decoration has no business paying for its own
         * geometry and GL setup before anyone can see it. The idle callback
         * may have resolved the factory while the host was still off screen,
         * in which case nothing has been built yet and this first sighting
         * is what builds it.
         */
        if (renderer === null && factory !== null) create();
        else run();
      } else if (renderer !== null && !still) halt('paused');
    });
    intersection.observe(host);

    const onVisibility = (): void => {
      if (!document.hidden) run();
      else if (renderer !== null && !still) halt('paused');
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMove = (event: PointerEvent): void => {
      // A finger is not a cursor: coarse pointers get no repulsion (spec §5.4).
      if (event.pointerType === 'touch') return;
      const rect = canvas.getBoundingClientRect();
      pointer = [event.clientX - rect.left, event.clientY - rect.top];
      inside = true;
      lastMove = performance.now();
    };
    const onLeave = (): void => {
      inside = false;
    };
    host.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('pointerleave', onLeave);

    const onLost = (event: Event): void => {
      event.preventDefault();
      halt('lost');
      renderer?.dispose();
      renderer = null;
    };
    const onRestored = (): void => create();
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    const onMotion = (event: MediaQueryListEvent): void => {
      if (!event.matches) return;
      halt('poster');
      renderer?.dispose();
      renderer = null;
    };
    motion.addEventListener('change', onMotion);

    const offCurtain =
      entrance === 'curtain' && !still
        ? onCurtainLifted(() => {
            assembling = true;
          })
        : () => {};

    /*
     * A browser without WebGL2 must never import the renderer chunk (spec
     * §5.5/§8) — `state` simply stays at its initial `'poster'` and the idle
     * callback below is never scheduled.
     */
    let cancelIdle: () => void = () => {};
    if (supportsWebgl2()) {
      setState('loading');
      cancelIdle = whenIdle(() => {
        import('./helix-renderer')
          .then((module) => {
            if (disposed) return;
            factory = module.createHelixRenderer;
            // Build only once the host is on screen — or immediately for a
            // still capture, whose page is genuinely visible but may not yet
            // have had its first IntersectionObserver callback land.
            if (visible || still) create();
          })
          .catch(() => {
            if (!disposed) setState('poster');
          });
      });
    }

    return () => {
      disposed = true;
      cancelIdle();
      offCurtain();
      if (raf !== 0) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      motion.removeEventListener('change', onMotion);
      renderer?.dispose();
      renderer = null;
      setState('poster');
    };
  }, [helix, dir, entrance, hostRef]);

  const poster = dir === 'rtl' ? HELIX_POSTER.rtl : HELIX_POSTER.ltr;

  return (
    <div className={`helix ${className}`.trim()} data-helix-state={state} aria-hidden="true">
      <img
        className="helix-poster"
        src={poster}
        alt=""
        width={HELIX_POSTER.width}
        height={HELIX_POSTER.height}
        loading={posterLoading}
        decoding="async"
      />
      {helix !== null && <canvas ref={canvasRef} className="helix-canvas" />}
    </div>
  );
}
