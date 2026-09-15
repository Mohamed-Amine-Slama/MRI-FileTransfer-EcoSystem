'use client';

import { SEQUENCE } from '../../../lib/site/sequence';
import { useSite } from '../../../lib/site/site-provider';
import { BlurIn } from '../motion/BlurIn';
import { StackPanel } from '../motion/StackPanel';
import { WordReveal } from '../motion/WordReveal';
import { DemoCard } from '../primitives/DemoCard';

/**
 * Scene 06 — The viewer. Spec 2026-09-10 §7.2.
 *
 * Live markup in the application's own light tokens, not a screenshot: §9
 * forbids text baked into images, and the reference-only banner has to be
 * readable in the reader's language. Still an illustration of the screen —
 * see the open items in docs/landing-page-status.md.
 */
export function S06Viewer(): React.JSX.Element {
  const { t } = useSite();

  return (
    <StackPanel id="viewer" labelledBy="viewer-title" tone="white">
      <div className="shell">
        <WordReveal as="h2" id="viewer-title" variant="display" text={t.viewerTitle} className="display t-h1 measure" />

        <div className="viewer-grid">
          <BlurIn>
            <DemoCard label="VIEWER" padded={false} className="viewer-plate">
              <div className="viewer-panel">
                <p className="viewer-banner" data-testid="viewer-banner">
                  {t.viewerBanner}
                </p>
                <div className="viewer-body">
                  <div className="viewer-rail" aria-hidden="true">
                    <span className="viewer-tool" />
                    <span className="viewer-tool" />
                    <span className="viewer-tool" />
                    <span className="viewer-tool" />
                  </div>
                  <div className="viewer-stage">
                    <img
                      src={SEQUENCE.poster}
                      alt=""
                      width={SEQUENCE.width}
                      height={SEQUENCE.height}
                      loading="lazy"
                      decoding="async"
                      aria-hidden="true"
                    />
                    {/* The phantom's own metadata, deliberately readable as synthetic. */}
                    <span className="viewer-meta viewer-meta--start mono">
                      SYNTHETIC^PHANTOM
                      <br />
                      1.3.6.1.4.1.99999.1
                    </span>
                    <span className="viewer-meta viewer-meta--end mono">
                      CT · AX
                      <br />
                      W 400 / L 40
                    </span>
                  </div>
                </div>
              </div>
            </DemoCard>
          </BlurIn>

          <BlurIn delay={0.08} className="viewer-copy">
            <p className="t-body-l measure">{t.viewerBody}</p>
          </BlurIn>
        </div>
      </div>
    </StackPanel>
  );
}
