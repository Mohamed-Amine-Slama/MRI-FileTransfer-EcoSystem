'use client';

import { useRef } from 'react';
import { CORRIDOR_MAPS } from '../../../lib/site/corridor-map.generated';
import { corridorLabels } from '../../../lib/site/corridor-labels';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';
import { BlurIn } from '../motion/BlurIn';
import { ScrollLitText } from '../motion/ScrollLitText';

/**
 * Scene 03 — The corridor. Spec 2026-09-10 §7.2.
 *
 * The sentence is read word by word as the reader scrolls through it; then
 * the two ends of the corridor as chips joined by a teal rule; then the map,
 * whose route draws once with the scroll and STAYS drawn — not a loop, which
 * is the most reused visual in enterprise tech (§2.1).
 *
 * The eyebrow is the route itself ("From X to Y"), not a label repeating the
 * heading: the page allows an eyebrow only when it says something new.
 * No country is named in code — the labels come from the registry (§4.3).
 */
export function S03Corridor(): React.JSX.Element {
  const routeRef = useRef<SVGPathElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const { t, tpl, locale, budget } = useSite();

  const corridor = corridorLabels(locale);
  const map = CORRIDOR_MAPS[corridor.id];

  /*
   * The draw: `stroke-dasharray` set to the path's measured length and
   * `stroke-dashoffset` scrubbed from that length to zero. Measured, not
   * guessed — the corridor can be regenerated for different endpoints.
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
            start: 'top 40%',
            end: 'bottom 70%',
            scrub: 0.8,
          },
          ...promoting(route, 'stroke-dashoffset'),
        },
      );
    },
    [budget.planes, corridor.id],
  );

  return (
    <section ref={sectionRef} id="corridor" className="scene scene--corridor" aria-labelledby="corridor-title">
      <div className="shell corridor-shell">
        <p className="eyebrow">{tpl.corridorRoute(corridor.source, corridor.destination)}</p>
        <ScrollLitText as="h2" id="corridor-title" text={t.corridorTitle} className="display t-h1 corridor-title" />
        <ScrollLitText text={t.corridorBody} className="t-h2 corridor-body" />

        <BlurIn className="corridor-ends">
          <span className="chip">
            {t.corridorSourceLabel} · {corridor.source}
          </span>
          <span className="corridor-link" aria-hidden="true" />
          <span className="chip">
            {t.corridorDestinationLabel} · {corridor.destination}
          </span>
        </BlurIn>

        <BlurIn className="corridor-map-card">
          <figure className="corridor-map">
            {map === undefined ? null : (
              <>
                {/* Decorative: the route is described in words by the caption and the chips above. */}
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
                <svg viewBox={map.viewBox} className="corridor-route" fill="none" aria-hidden="true">
                  <path ref={routeRef} d={map.route} stroke="var(--c-accent)" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx={map.source[0]} cy={map.source[1]} r="5" fill="var(--c-accent)" />
                  <circle cx={map.destination[0]} cy={map.destination[1]} r="5" fill="var(--c-accent)" />
                </svg>
              </>
            )}
            <figcaption className="sr-only">{t.corridorMapAlt}</figcaption>
          </figure>

          <div className="corridor-readout">
            {/*
              847 MB is a real size for a CT study; the caption beside it says
              it illustrates one transfer (§5: numbers are specific or absent).
            */}
            <p className="mono subtle corridor-readout-line">ENCRYPTED · TLS 1.3 · 847 MB · CONSENT: GRANTED</p>
            <p className="mono subtle">{t.corridorReadoutCaption}</p>
          </div>
        </BlurIn>
      </div>
    </section>
  );
}
