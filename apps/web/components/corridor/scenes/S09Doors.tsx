'use client';

import { useRef } from 'react';
import { SEQUENCE } from '../../../lib/site/sequence';
import { useSite } from '../../../lib/site/site-provider';
import { HorizontalTrack } from '../motion/HorizontalTrack';
import { Card } from '../primitives/Card';

/**
 * Scene 09 — Two doors. Spec 2026-09-10 §7.2.
 *
 * "Who are you?" on a teal lead card, then one card per door, travelling
 * sideways while the section is held. Each door is ONE link — the whole card
 * — so the doctors' topics are its body text rather than a list of links
 * (links cannot nest). Cards are ~44vw so the row genuinely overflows and the
 * pin travels about one viewport, not a token amount.
 */
export function S09Doors(): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const { t, cue } = useSite();

  return (
    <section ref={sectionRef} id="doors" className="scene scene--doors" aria-labelledby="doors-title">
      <HorizontalTrack pinRef={sectionRef} className="doors-track">
        <Card variant="teal" titleAs="h2" titleId="doors-title" title={t.doorsEyebrow} className="door-lead" />
        <Card
          variant="lime"
          href="/signup"
          testId="door-doctors"
          index="01"
          title={t.doorsDoctorTitle}
          label={t.doorsDoctorCta}
          onPointerEnter={() => cue('press')}
          className="door"
        >
          <p className="door-body">{t.doorsDoctorBody}</p>
        </Card>
        <Card
          variant="image"
          href="/pricing"
          testId="door-patients"
          index="02"
          title={t.doorsPatientTitle}
          label={t.doorsPatientCta}
          image={{ src: SEQUENCE.poster, width: SEQUENCE.width, height: SEQUENCE.height }}
          onPointerEnter={() => cue('press')}
          className="door"
        >
          <p className="door-body">{t.doorsPatientBody}</p>
        </Card>
      </HorizontalTrack>
    </section>
  );
}
