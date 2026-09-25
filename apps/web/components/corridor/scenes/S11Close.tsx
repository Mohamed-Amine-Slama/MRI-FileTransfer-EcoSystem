'use client';

import Link from '../../ui/link';
import { useRef } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import { HelixCanvas } from '../helix/HelixCanvas';
import { BlurIn } from '../motion/BlurIn';
import { StackPanel } from '../motion/StackPanel';
import { MirMark } from '../primitives/MirMark';

/**
 * Scene 11 — Close. Spec 2026-09-10 §7.2.
 *
 * The helix comes back, already assembled, on the inline-start half of a mint
 * panel; the page's last sentence and its two routes out sit on a white card
 * beside it. Each helix instance animates only while it is on screen, so the
 * hero's has paused by the time this one runs.
 */
export function S11Close(): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const { t, cue } = useSite();

  return (
    <StackPanel id="close" labelledBy="close-title" tone="mint" className="scene--close">
      <div ref={stageRef} className="shell close-stage">
        <HelixCanvas hostRef={stageRef} entrance="none" posterLoading="lazy" className="close-helix" />

        <BlurIn className="close-card">
          <span className="logo-tile" aria-hidden="true">
            <MirMark />
          </span>
          <h2 id="close-title" className="display t-h1 close-line">
            {t.closeLine}
          </h2>
          <div className="close-actions">
            <Link
              href="/signup"
              className="btn btn--primary"
              data-testid="landing-close-signup"
              onPointerDown={() => cue('press')}
            >
              {t.closeCta}
            </Link>
            <Link href="/pricing" className="btn btn--secondary" data-testid="landing-pricing">
              {t.closeSecondary}
            </Link>
          </div>
        </BlurIn>
      </div>
    </StackPanel>
  );
}
