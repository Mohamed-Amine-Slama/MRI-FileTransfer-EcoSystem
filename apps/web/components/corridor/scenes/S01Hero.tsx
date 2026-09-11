'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { corridorLabels } from '../../../lib/site/corridor-labels';
import { SEQUENCE } from '../../../lib/site/sequence';
import { useSite } from '../../../lib/site/site-provider';
import { HeadlineReveal } from '../motion/HeadlineReveal';
import { ScrubCanvas } from '../motion/ScrubCanvas';
import { Plate } from '../primitives/Plate';
import { SliceCounter } from '../primitives/SliceCounter';
import { StatusPill } from '../primitives/StatusPill';

/**
 * Scene 01 — Hero. Landing-Page-Specs §Scene 01.
 *
 * Two jobs, in this order: say what the product does in one sentence, and
 * perform the slice mechanic within the first 300 px of scroll so the reader
 * learns the page's grammar before they have decided anything.
 *
 * The volume sits BEHIND the headline at 35% opacity and the headline is on
 * the focal plane. Scrolling advances the slices and drifts the headline back
 * out of focus — you scroll past it, into the volume. That single relationship
 * is the whole design idea (§2.1 concept C) and everything else on the page is
 * a consequence of it.
 *
 * The scene is `100vh` and the scrub runs over the following viewport, so a
 * reader who never scrolls sees a complete, still hero — which is exactly what
 * Tier C sees too.
 */
export function S01Hero(): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const { t, tpl, locale } = useSite();
  const corridor = corridorLabels(locale);

  return (
    <section
      ref={sectionRef}
      id="hero"
      className="scene scene--hero"
      aria-labelledby="hero-headline"
    >
      <div className="hero-frame">
        <Plate
          className="hero-plate"
          /*
           * A real DICOM series description, in the format a doctor reads
           * fifty times a day. It is decoration for everyone else and a
           * handshake for them.
           */
          label="CT · AX · 512×512"
          padded={false}
        >
          <div className="hero-stack">
            {/*
              The poster is the hero image on every tier. On A and B the canvas
              paints over it once frames arrive; on C it IS the hero, and
              nothing else ever loads. `fetchpriority="high"` because this is
              the LCP candidate (§8.2 technique 6).

              A plain <img>, not next/image. The file is already AVIF at its
              final dimensions, committed by the render script, so the image
              optimiser has nothing to do but add a serverless hop in front of
              the one asset whose latency decides LCP. Explicit width and
              height are what keep CLS at zero (§8.1).
            */}
            <img
              src={SEQUENCE.poster}
              alt=""
              width={SEQUENCE.width}
              height={SEQUENCE.height}
              className="slice-poster"
              fetchPriority="high"
              decoding="async"
              aria-hidden="true"
            />
            <ScrubCanvas triggerRef={sectionRef} />

            {/*
              The workstation HUD — §2.3: "Study the HUD: corner metadata
              overlays, the windowing readout, the reticle. That chrome is your
              navigation." It is four spans and an SVG, and it is the detail a
              referring doctor recognises before they have read a word.

              The values are the phantom's own, and deliberately readable as
              synthetic: the UID root is this repository's non-registered arc.
            */}
            <span className="hero-hud hero-hud--tl" aria-hidden="true">
              SYNTHETIC^PHANTOM
              <br />
              1.3.6.1.4.1.99999.1
            </span>
            <span className="hero-hud hero-hud--tr" aria-hidden="true">
              W 400 / L 40
              <br />
              SL 3.0 mm
            </span>
            <span className="hero-hud hero-hud--bl" aria-hidden="true">
              AX · SOFT TISSUE
            </span>

            <svg className="hero-reticle" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="34" />
              <circle cx="50" cy="50" r="1.2" />
              {/* Four ticks, not a full crosshair: a crosshair through the
                  headline would read as a strike-through. */}
              <line x1="50" y1="8" x2="50" y2="20" />
              <line x1="50" y1="80" x2="50" y2="92" />
              <line x1="8" y1="50" x2="20" y2="50" />
              <line x1="80" y1="50" x2="92" y2="50" />
            </svg>

            <div className="hero-copy shell">
              <HeadlineReveal
                id="hero-headline"
                text={t.heroHeadline}
                className="hero-headline"
              />
              <p className="hero-subhead t-body-l subtle measure">
                {tpl.heroSubhead(corridor.source, corridor.destination)}
              </p>

              <div className="hero-actions">
                {/*
                  `data-testid` values are the ones `e2e/public-surface.spec.ts`
                  already knows. The scene changed; the contract that an
                  anonymous visitor lands on a marketing page with these two
                  routes out of it did not.
                */}
                <Link href="/signup" className="btn btn--primary" data-testid="landing-signup">
                  {t.heroCtaPrimary}
                </Link>
                <a href="#problem" className="btn btn--ghost" data-testid="landing-how">
                  {t.heroCtaSecondary}
                </a>
              </div>
            </div>
          </div>
        </Plate>

        <div className="hero-rail">
          <StatusPill
            operationalLabel={t.heroStatusOperational}
            unknownLabel={t.heroStatusUnknown}
          />
          <span className="mono subtle hero-trust">{t.heroTrustLine}</span>
          {/*
            The counter is positioned as the plate's own bottom-edge label, so
            it reads as part of the viewport chrome rather than as a widget.
            It is the page's scrollbar (§Scene 01) and it runs to 180/180 at
            the final plate.
          */}
          <SliceCounter className="hero-slice" />
        </div>

        {/*
          Rendered on EVERY tier, and that is the point. §6.3 requires a
          demotion to cause no visible layout change; gating this on the tier
          made it vanish the moment a device stepped from B to C, which is
          exactly the visible downgrade the rule forbids. It is also still true
          on Tier C: the slice counter runs 001 → 180 whether or not the canvas
          scrubs behind it.
        */}
        <p className="hero-hint mono subtle" aria-hidden="true">
          {t.heroScrollHint}
        </p>
      </div>
    </section>
  );
}
