'use client';

import { useEffect, useRef } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import type { Handoff } from './webgl-handoff';

/**
 * Mounts the §2.2 channel 4 displacement pass — Tier A only, lazily.
 *
 * The GL module is behind a dynamic import so it is not in the first-load
 * bundle. On Tier B and C the import never happens, which is the point: the
 * page's most expensive optional effect must cost exactly nothing on the
 * devices that cannot afford it.
 *
 * The canvas sits behind the content and is `pointer-events: none`, so it can
 * never intercept a click. It carries no meaning and is `aria-hidden`.
 */
export function WebGLHandoff(): React.JSX.Element | null {
  const ref = useRef<HTMLCanvasElement>(null);
  const { budget } = useSite();

  useEffect(() => {
    if (!budget.atmospherics) return;

    const canvas = ref.current;
    if (canvas === null) return;

    let handoff: Handoff | null = null;
    let disposed = false;
    let lastY = window.scrollY;
    let raf = 0;

    const onScroll = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        handoff?.push(y - lastY);
        lastY = y;
      });
    };

    const onResize = (): void => handoff?.resize();

    void import('./webgl-handoff').then(({ createHandoff }) => {
      if (disposed) return;
      handoff = createHandoff(canvas);
      // A refused context is not an error worth surfacing. The page is
      // complete without this layer by construction.
      if (handoff === null) return;
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize, { passive: true });
    });

    return () => {
      disposed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      handoff?.destroy();
    };
  }, [budget.atmospherics]);

  if (!budget.atmospherics) return null;

  return <canvas ref={ref} className="handoff-canvas" aria-hidden="true" />;
}
