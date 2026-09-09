'use client';

import { useRef } from 'react';
import { CORRIDOR_MAPS } from '../../../lib/site/corridor-map.generated';
import { corridorLabels } from '../../../lib/site/corridor-labels';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';
import { FocalReveal } from '../motion/FocalReveal';
import { Plate } from '../primitives/Plate';

/**
 * Scene 03 — The corridor. Landing-Page-Specs §Scene 03.
 *
 * Where the rejected Concept A earns its keep: a flat topographic plate in
 * hairlines, two nodes, and a phosphor line that draws once as you scroll and
 * STAYS DRAWN. Not a loop — a looping arc between two cities on a dark globe is
 * the single most reused visual in enterprise tech (§2.1) and this scene is
 * built specifically to not be that.
 *
 * The geography is an `<img>` — a cacheable 9 KB plate generated from Natural
 * Earth by `scripts/render-corridor-map.mjs` and shared across every locale
 * route. Only the route and its two nodes are inline, because only they have
 * to be animated.
 *
 * No country is named here. The map is keyed by corridor id and the labels
 * come from the registry (§4.3).
 */
export function S03Corridor(): React.JSX.Element {
  const routeRef = useRef<SVGPathElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const { t, tpl, locale, budget } = useSite();

  const corridor = corridorLabels(locale);
  const map = CORRIDOR_MAPS[corridor.id];

  /*
   * The draw. `stroke-dasharray` set to the path's own measured length, and
   * `stroke-dashoffset` scrubbed from that length to zero — the line writes
   * itself along the route as the reader scrolls, and stops when they stop.
   *
   * Measured rather than guessed: `getTotalLength()` is exact for the
   * generated quadratic, and a hardcoded length would be wrong the moment the
   * corridor is regenerated for different endpoints.
   */
  useGsapScope(
    budget.planes > 0,
    sectionRef,
    ({ gsap }, section) => {
      const route = routeRef.current;
      if (route === null) return;

      const length = route.getTotalLength();
      gsap.fromTo(
        route,
        { strokeDasharray: length, strokeDashoffset: length },
        {
          strokeDashoffset: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'top 70%',
            end: 'center center',
            scrub: 0.8,
          },
          ...promoting(route, 'stroke-dashoffset'),
        },
      );
    },
    [budget.planes, corridor.id],
  );

  return (
    <section ref={sectionRef} id="corridor" className="scene" aria-labelledby="corridor-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <p className="eyebrow">{t.corridorEyebrow}</p>
          <h2 id="corridor-title" className="display t-h1 measure">
            {t.corridorTitle}
          </h2>
          <p className="t-body-l ash measure corridor-body">{t.corridorBody}</p>
        </FocalReveal>

        <FocalReveal plane={2} className="corridor-plate-wrap">
          <Plate label={tpl.corridorRoute(corridor.source, corridor.destination)} padded={false}>
            <figure className="corridor-map">
              {map === undefined ? null : (
                <>
                  {/*
                    Decorative: the route is described in words by the caption
                    and the two labels below, so a screen reader gets the
                    geography as a sentence rather than as an unlabelled image.
                  */}
                  <img
                    src={map.image}
                    alt=""
                    width={1200}
                    height={675}
                    loading="lazy"
                    decoding="async"
                    className="corridor-map-plate"
                    aria-hidden="true"
                  />
                  <svg
                    viewBox={map.viewBox}
                    className="corridor-route"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      ref={routeRef}
                      d={map.route}
                      stroke="var(--c-phosphor)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <circle cx={map.source[0]} cy={map.source[1]} r="5" fill="var(--c-phosphor)" />
                    <circle
                      cx={map.destination[0]}
                      cy={map.destination[1]}
                      r="5"
                      fill="var(--c-phosphor)"
                    />
                  </svg>
                </>
              )}

              <figcaption className="sr-only">{t.corridorMapAlt}</figcaption>
            </figure>

            <div className="corridor-legend">
              <span className="mono dim">
                <span className="legend-dot" aria-hidden="true" /> {t.corridorSourceLabel} ·{' '}
                {corridor.source}
              </span>
              <span className="mono dim">
                <span className="legend-dot" aria-hidden="true" /> {t.corridorDestinationLabel} ·{' '}
                {corridor.destination}
              </span>
            </div>
          </Plate>
        </FocalReveal>

        <FocalReveal plane={1} className="corridor-readout">
          {/*
            The mono readout that tracks alongside the line. §5's tone rule —
            "numbers are specific or absent" — is why this carries a caption
            saying it illustrates one transfer: 847 MB is a real size for a CT
            study, and without the caption it would read as a claim about
            averages that nobody has measured.
          */}
          <p className="mono phosphor corridor-readout-line">
            ENCRYPTED · TLS 1.3 · 847 MB · CONSENT: GRANTED
          </p>
          <p className="mono dim">{t.corridorReadoutCaption}</p>
        </FocalReveal>
      </div>
    </section>
  );
}
