'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { loadGsap } from '../../../lib/site/gsap';
import { SEQUENCE, bisectOrder, framePath } from '../../../lib/site/sequence';
import { useSite } from '../../../lib/site/site-provider';
import { DEMOTION } from '../../../lib/site/tier';

/**
 * The slice sequence — Landing-Page-Specs §6.5. The signature mechanic.
 *
 * Scrolling the page scrubs through a volume, exactly as a radiologist scrolls
 * a CT stack. This is the whole idea of the site: the page has a DEPTH, not
 * just a length, and a referring doctor recognises the gesture in half a
 * second.
 *
 * ---------------------------------------------------------------------------
 * CANVAS 2D WITH PRE-DECODED FRAMES. NOT VIDEO.
 *
 * §6.5 rules video out and is right to: video scrubbing is unreliable across
 * Safari and Android WebView and cannot be seeked frame-accurately. A stack
 * that stutters or lands on the wrong slice destroys the one illusion the page
 * depends on.
 *
 * It also degrades honestly. A WebGL volume raycaster degrades to a blank
 * rectangle; an image sequence degrades to its poster frame, which is a
 * perfectly good hero image.
 * ---------------------------------------------------------------------------
 */

export function ScrubCanvas({
  triggerRef,
}: {
  /** The element whose scroll drives the scrub — the hero section. */
  triggerRef: RefObject<HTMLElement | null>;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { budget, demote } = useSite();
  const dir = budget.sequence;

  useEffect(() => {
    // Tier C: the poster stays and nothing loads. Not one byte of sequence.
    if (dir === null) return;

    const canvas = canvasRef.current;
    const trigger = triggerRef.current;
    if (canvas === null || trigger === null) return;

    /*
     * `alpha: false` is a measurable win (§6.5): the compositor can treat the
     * canvas as opaque and skip blending it against everything underneath.
     * `desynchronized` lets the browser skip a frame of latency, which matters
     * for a surface driven directly by scroll position.
     */
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (ctx === null) return;

    /*
     * The backing store is the SOURCE resolution, not the display resolution.
     *
     * §6.5 caps the canvas at `min(devicePixelRatio, 2)` because "rendering at
     * DPR 3 on a phone for a background element is wasted work". The same
     * argument goes one step further here: the frames are 1280×720, so a
     * backing store larger than that is upscaling — more pixels to fill, from
     * no extra information. This is the ceiling, and it is DPR-independent.
     */
    canvas.width = SEQUENCE.width;
    canvas.height = SEQUENCE.height;

    const count = SEQUENCE.frames[dir];
    const images: (HTMLImageElement | undefined)[] = new Array(count);
    const state = { frame: 0 };
    let raf = 0;
    let disposed = false;

    /**
     * Draw the nearest LOADED frame to the requested one.
     *
     * This is what makes the bisect order pay off. A user scrolling fast on a
     * slow connection asks for frame 31 while frames 0, 35, 17, 8, 26 have
     * arrived; rather than leaving the canvas blank or stale, it shows 26 — a
     * stepping approximation of the volume that resolves as more arrive.
     */
    const draw = (): void => {
      raf = 0;
      const want = Math.round(state.frame);
      for (let offset = 0; offset < count; offset++) {
        for (const index of offset === 0 ? [want] : [want - offset, want + offset]) {
          if (index < 0 || index >= count) continue;
          const img = images[index];
          if (img?.complete === true && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return;
          }
        }
      }
    };

    const schedule = (): void => {
      if (raf === 0 && !disposed) raf = requestAnimationFrame(draw);
    };

    // --- loading, in bisect order ------------------------------------------
    const started = performance.now();
    let ready = 0;

    bisectOrder(count).forEach((index, position) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = framePath(dir, index);
      img.onload = () => {
        if (disposed) return;
        ready += 1;
        /*
         * The runtime half of tiering (§6.3). Detection reports the radio's
         * capability; this measures the tower's actual mood. If the first
         * frames took longer than the budget, the tier was wrong and the page
         * steps down — silently, because the layout is identical and the
         * canvas simply stops being fed.
         */
        if (position === DEMOTION.sampleFrames - 1) {
          const elapsed = performance.now() - started;
          if (elapsed > DEMOTION.firstFramesMs) {
            demote(`${DEMOTION.sampleFrames} frames took ${Math.round(elapsed)} ms`);
          }
        }
        if (ready === 1) schedule();
      };
      images[index] = img;
    });

    // --- the scrub ---------------------------------------------------------
    let killTrigger: (() => void) | null = null;

    void loadGsap().then(({ ScrollTrigger }) => {
      if (disposed) return;
      const st = ScrollTrigger.create({
        trigger,
        start: 'top top',
        end: 'bottom top',
        // §3.5: scroll-linked motion is scrubbed, never triggered. 0.8 is
        // enough smoothing to absorb a trackpad's jitter without the canvas
        // visibly lagging the scrollbar.
        scrub: 0.8,
        onUpdate: (self) => {
          state.frame = self.progress * (count - 1);
          schedule();
        },
      });
      killTrigger = () => st.kill();
    });

    return () => {
      disposed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      killTrigger?.();
      /*
       * Detach the handlers and drop the sources before releasing the array.
       * An in-flight decode holds its bitmap alive through `onload` otherwise,
       * and on a locale switch that is 36 full-size frames the collector
       * cannot reach.
       */
      for (const img of images) {
        if (img === undefined) continue;
        img.onload = null;
        img.src = '';
      }
      images.length = 0;
    };
  }, [dir, triggerRef, demote]);

  return (
    <canvas
      ref={canvasRef}
      width={SEQUENCE.width}
      height={SEQUENCE.height}
      className="slice-canvas"
      /*
       * §9: the canvas is decorative and carries no meaning. Every word on
       * this page is real text — the headline says what the product does, and
       * the volume behind it is atmosphere. A screen reader that announced
       * "canvas" here would be announcing nothing.
       */
      aria-hidden="true"
    />
  );
}
