'use client';

import { useRef } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';
import { WindowingWipe } from '../motion/WindowingWipe';
import { Plate } from '../primitives/Plate';
import { ArtefactCalendar, ArtefactDisc, ArtefactPhone } from './artefacts';

/**
 * Scene 02 — The problem. Landing-Page-Specs §Scene 02.
 *
 * "Name the pain before offering the cure. This is the scene that makes a
 * Libyan doctor feel the site was written by someone who has been in their
 * clinic."
 *
 * Three plates in a horizontal stack that scrubs sideways as the page scrolls
 * vertically — and inverts under RTL, which §3.6 warns is the thing that
 * breaks. The multiplier comes from `sign`, so the track runs towards the
 * reader's "forward" in both directions.
 *
 * Copy discipline (§Scene 02): no adjectives. State the situation. The reader
 * supplies the frustration.
 */
export function S02Problem(): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const { t, sign, budget } = useSite();

  const artefacts = [
    { Art: ArtefactDisc, label: t.problemCdLabel, line: t.problemCdLine, tag: 'CD-R · 700 MB' },
    { Art: ArtefactPhone, label: t.problemPhoneLabel, line: t.problemPhoneLine, tag: 'JPEG · 1.2 MB' },
    { Art: ArtefactCalendar, label: t.problemCalendarLabel, line: t.problemCalendarLine, tag: 'T + 42 D' },
  ];

  /*
   * The horizontal scrub. One pin, and it is the only pinned element on the
   * page — §6.4: "Never pin more than one element at a time. Pinning is where
   * scroll sites die."
   *
   * `x` is a function rather than a value so it is recomputed on refresh: the
   * track's width changes with the locale (Arabic runs longer), and a value
   * captured at creation time would leave the last plate off-screen in one
   * language and short of the edge in the other.
   */
  useGsapScope(
    budget.planes > 0,
    sectionRef,
    ({ gsap }, section) => {
      const track = trackRef.current;
      if (track === null) return;
      if (window.matchMedia('(max-width: 899px)').matches) return;

      gsap.to(track, {
        x: () => (track.scrollWidth - window.innerWidth * 0.86) * -sign,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: () => `+=${track.scrollWidth}`,
          scrub: 1,
          pin: true,
          invalidateOnRefresh: true,
        },
        ...promoting(track, 'transform'),
      });
    },
    [budget.planes, sign],
  );

  return (
    <section ref={sectionRef} id="problem" className="scene" aria-labelledby="problem-title">
      <WindowingWipe className="shell">
        <p className="eyebrow">{t.problemEyebrow}</p>
        <h2 id="problem-title" className="display t-h1 measure">
          {t.problemTitle}
        </h2>

        {/*
          The track is a flex row that scrubs sideways on desktop and stacks
          vertically below 900px. §Scene 02's fallback is exactly that stack,
          and it is also what Tier C gets at every width — the same markup,
          simply not moving.
        */}
        <div className="problem-viewport">
          <div ref={trackRef} className="problem-track">
            {artefacts.map(({ Art, label, line, tag }) => (
              <Plate key={label} label={tag} className="problem-plate">
                <figure className="problem-figure">
                  {/*
                    Drawn, not photographed. §7.3 bans stock photography and
                    §7.2's "object photography on void" assumes a photographer
                    and a lightbox. These are hairline line objects in the same
                    vocabulary as the plates around them: no shoot to
                    commission, no licence to record, nothing that could be
                    mistaken for a real clinic's disc, and about 600 bytes each
                    with no request of their own.
                  */}
                  <Art />
                  <figcaption>
                    <span className="mono dim problem-label">{label}</span>
                    <p className="t-h3 problem-line">{line}</p>
                  </figcaption>
                </figure>
              </Plate>
            ))}
          </div>
        </div>
      </WindowingWipe>
    </section>
  );
}
