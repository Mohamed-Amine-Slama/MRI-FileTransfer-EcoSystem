'use client';

import { SEQUENCE } from '../../../lib/site/sequence';
import { useSite } from '../../../lib/site/site-provider';
import { FocalReveal } from '../motion/FocalReveal';
import { Plate } from '../primitives/Plate';

/**
 * Scene 06 — The viewer, and the boundary. Landing-Page-Specs §Scene 06.
 *
 * "Show the product, and simultaneously set the legal boundary. These are the
 * same job."
 *
 * The panel is the first LIGHT surface on the page, and it lands hard after
 * five dark scenes — §3.1 calls that contrast a design device in itself: the
 * dark site is the reading room, the light panel is the lightbox.
 *
 * ---------------------------------------------------------------------------
 * THE BANNER IS NOT AN APOLOGY.
 *
 * "Reference viewing only — not for diagnostic use" is rendered at real size,
 * not shrunk to hide it. §1.4 requires the string wherever the site shows the
 * viewer, in the same language as the surrounding page, and §Scene 06 is right
 * that a Tunisian doctor reading it relaxes: it means nobody is asking them to
 * diagnose off someone else's screen, and it is what keeps this product
 * outside medical-device regulation.
 * ---------------------------------------------------------------------------
 *
 * WHY THIS IS LIVE MARKUP AND NOT A SCREENSHOT. §14's checklist asks for
 * "actual screenshots of the real product, not mockups of a product that does
 * not exist" — a rule aimed at vapourware. The product does exist, in this
 * repository, and its viewer chrome is reproduced here from the same tokens
 * rather than photographed. Three things come out better that way: the banner
 * is live text in the reader's own language rather than pixels of English
 * (§9 forbids text baked into images), it costs ~1 KB instead of the 90 KB
 * §Scene 06 budgets for an AVIF, and it cannot drift out of date silently.
 *
 * ⚠ The panel still shows an ILLUSTRATION of the viewer rather than the
 * viewer. Capturing the real screen needs a running API and seeded data, so
 * that is recorded as an open launch item in docs/landing-page-status.md
 * rather than quietly declared done.
 */
export function S06Viewer(): React.JSX.Element {
  const { t } = useSite();

  return (
    <section id="viewer" className="scene" aria-labelledby="viewer-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <h2 id="viewer-title" className="display t-h1 measure">
            {t.viewerTitle}
          </h2>
        </FocalReveal>

        <div className="viewer-grid">
          <FocalReveal plane={2}>
            <Plate label="VIEWER" padded={false} className="viewer-plate">
              {/*
                The lightbox. `.viewer-panel` is the page's only light surface
                and it does not inherit the corridor palette — it declares the
                application's light tokens directly, because the point being
                made is that the PRODUCT is a bright clinical tool and the
                marketing site is the dark room around it.
              */}
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
                    {/*
                      Corner metadata, the way a real workstation lays it out.
                      Synthetic values from the phantom, and deliberately
                      recognisable as synthetic — the UID root here is the
                      repository's own non-registered arc.
                    */}
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
            </Plate>
          </FocalReveal>

          <FocalReveal plane={2} className="viewer-copy">
            <p className="t-body-l measure">{t.viewerBody}</p>
          </FocalReveal>
        </div>
      </div>
    </section>
  );
}
