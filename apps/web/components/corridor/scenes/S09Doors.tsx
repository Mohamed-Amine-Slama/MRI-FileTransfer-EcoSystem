'use client';

import Link from 'next/link';
import { useSite } from '../../../lib/site/site-provider';
import { FocalReveal } from '../motion/FocalReveal';

/**
 * Scene 09 — Two doors. Landing-Page-Specs §Scene 09.
 *
 * "Route the three audiences without three homepages."
 *
 * §1.1 sets out the three: the referring doctor, the patient or family member,
 * and the receiving specialist. The hero speaks to the first two at once,
 * because they share one emotional truth — the scan gets there before the
 * patient does. This scene is where they part company.
 *
 * The hover expansion is one of the only hover effects on the site, and §Scene
 * 09 permits it because it is MEANINGFUL: it previews the choice rather than
 * decorating it. It is implemented in CSS on `:hover` AND `:focus-within`, so
 * a keyboard user gets the same preview — a hover-only affordance would make
 * the effect a reward for owning a mouse.
 */
export function S09Doors(): React.JSX.Element {
  const { t, cue } = useSite();

  const doors = [
    {
      key: 'doctors',
      title: t.doorsDoctorTitle,
      body: t.doorsDoctorBody,
      cta: t.doorsDoctorCta,
      href: '/signup',
      testid: 'door-doctors',
    },
    {
      key: 'patients',
      title: t.doorsPatientTitle,
      body: t.doorsPatientBody,
      cta: t.doorsPatientCta,
      href: '/pricing',
      testid: 'door-patients',
    },
  ];

  return (
    <section id="doors" className="scene" aria-labelledby="doors-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <h2 id="doors-title" className="eyebrow doors-title">
            {t.doorsEyebrow}
          </h2>
        </FocalReveal>

        {/*
          The seam. Two panels that meet on a single hairline and open from the
          centre — on desktop a row, stacked below 900px. `plate--flush` on
          both so the seam is the only line between them.
        */}
        <FocalReveal plane={2}>
          <div className="doors">
            {doors.map((door) => (
              <Link
                key={door.key}
                href={door.href}
                className="door"
                data-testid={door.testid}
                onPointerEnter={() => cue('press')}
              >
                <span className="mono dim door-index" aria-hidden="true">
                  {door.key === 'doctors' ? '01' : '02'}
                </span>
                <h3 className="display t-h2 door-heading">{door.title}</h3>
                <p className="ash door-body">{door.body}</p>
                <span className="door-cta phosphor mono">
                  {door.cta}
                  {/*
                    §3.6: arrows MIRROR under RTL. The `--dir` multiplier flips
                    the glyph's scale in CSS rather than swapping the character,
                    so there is one arrow in the markup and it always points
                    the way the reader reads.
                  */}
                  <span className="door-arrow" aria-hidden="true">
                    →
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </FocalReveal>
      </div>
    </section>
  );
}
