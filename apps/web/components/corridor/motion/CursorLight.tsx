'use client';

import { useEffect, useRef } from 'react';
import { useSite } from '../../../lib/site/site-provider';

/**
 * The cursor light — Landing-Page-Specs §2.2 channel 3.
 *
 * A soft light that follows the pointer across the reading room. It is the
 * cheapest of the four atmospheric channels and the one people notice least
 * consciously, which is the correct ratio for something that runs continuously.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO `deviceorientation` PATH
 *
 * §2.2 pairs this with "on mobile, device tilt drives it via
 * `deviceorientation` (opt-in, with permission prompt on iOS)".
 *
 * It is unreachable. This channel is gated on `budget.atmospherics`, which is
 * Tier A only, and Tier A requires `!coarsePointer` — a device with a touch
 * screen never reaches Tier A by construction (§6.3). Writing the tilt path
 * would mean shipping an iOS permission prompt on a code path that cannot
 * execute, and a permission prompt is the most expensive thing a page can ask
 * for. If tilt is wanted later, the honest change is to give it its own tier
 * signal rather than to smuggle it in behind this one.
 * ---------------------------------------------------------------------------
 *
 * Costs: one fixed element, one passive pointer listener, and a rAF loop that
 * runs only while the pointer is inside the window. The position is eased
 * towards the cursor rather than snapped to it — a light that tracks exactly
 * reads as a cursor accessory, and one that lags slightly reads as a lamp.
 */
export function CursorLight(): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const { budget } = useSite();

  useEffect(() => {
    if (!budget.atmospherics) return;

    const element = ref.current;
    if (element === null) return;

    // Start off-centre and off-screen; the first pointer event brings it in.
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 3;
    let x = targetX;
    let y = targetY;
    let raf = 0;
    let visible = false;

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      targetX = event.clientX;
      targetY = event.clientY;
      if (!visible) {
        visible = true;
        element.style.opacity = '1';
      }
      if (raf === 0) raf = requestAnimationFrame(tick);
    };

    const onLeave = (): void => {
      visible = false;
      element.style.opacity = '0';
    };

    const tick = (): void => {
      raf = 0;
      // Critically damped enough to feel like weight, not like lag.
      x += (targetX - x) * 0.09;
      y += (targetY - y) * 0.09;
      element.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;

      // Stop the loop once it has caught up. A permanent rAF for a decorative
      // layer keeps the compositor awake and costs battery on a laptop that is
      // reading a page, not playing a game.
      if (visible && (Math.abs(targetX - x) > 0.5 || Math.abs(targetY - y) > 0.5)) {
        raf = requestAnimationFrame(tick);
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [budget.atmospherics]);

  if (!budget.atmospherics) return null;

  return <div ref={ref} className="cursor-light" aria-hidden="true" />;
}
