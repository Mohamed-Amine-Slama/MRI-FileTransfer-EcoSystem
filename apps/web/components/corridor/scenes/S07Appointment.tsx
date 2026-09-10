'use client';

import { useEffect, useState } from 'react';
import { countryTimeZone, timeInCountry } from '../../../lib/corridor/time-zone';
import { corridorLabels } from '../../../lib/site/corridor-labels';
import { useSite } from '../../../lib/site/site-provider';
import { FocalReveal } from '../motion/FocalReveal';
import { Plate } from '../primitives/Plate';

/**
 * Scene 07 — The appointment. Landing-Page-Specs §Scene 07.
 *
 * "Close the loop. The scan arriving is half the promise; the appointment is
 * the other half."
 *
 * The two clocks are the detail that does the work: they are LIVE, they read
 * from the two countries' real IANA zones, and for this corridor they are
 * genuinely an hour apart for part of the year. §Scene 07 is right that
 * showing it "proves you have thought about the actual problem" — a time sent
 * in a message without a zone is how a patient arrives on the wrong side of
 * lunch after crossing a border.
 *
 * THE PAYMENT LINE IS DELIBERATELY VAGUE, and that is the honest version.
 * §Scene 07: "Do not display card logos you have not confirmed. An unfulfilled
 * payment promise on the landing page is a support ticket for every single
 * signup." So there are no logos, and the sentence says the method depends on
 * the clinic.
 */
export function S07Appointment(): React.JSX.Element {
  const { t, locale } = useSite();
  const corridor = corridorLabels(locale);

  return (
    <section id="appointment" className="scene" aria-labelledby="appointment-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <h2 id="appointment-title" className="display t-h1 measure">
            {t.appointmentTitle}
          </h2>
          <p className="t-body-l subtle measure appointment-body">{t.appointmentBody}</p>
        </FocalReveal>

        <FocalReveal plane={2}>
          <Plate label="SCHEDULE" counter="2 TZ">
            <div className="appointment-clocks">
              <Clock country={corridor.sourceCountry} name={corridor.source} />
              <Clock country={corridor.destinationCountry} name={corridor.destination} />
            </div>

            <div className="appointment-slot">
              <span className="mono subtle">{t.appointmentSlotLabel}</span>
              <p className="t-h3 appointment-slot-time">
                <time dateTime="2026-03-21T10:30">21 · 03 · 2026 — 10:30</time>
              </p>
              <p className="mono accent">{t.appointmentConfirmLine}</p>
            </div>

            <p className="subtle appointment-payment measure">{t.appointmentPaymentNote}</p>
          </Plate>
        </FocalReveal>
      </div>
    </section>
  );
}

/**
 * One live clock.
 *
 * Rendered EMPTY on the server and filled after mount. The server has no idea
 * what time it is where the reader is, and prerendering a time into static
 * HTML would ship a clock that is wrong by however long the page has been
 * cached — which, with the `s-maxage=31536000` §8.2 asks for, is up to a year.
 * A dash until hydration is honest; a stale time is not.
 */
function Clock({ country, name }: { country: string; name: string }): React.JSX.Element {
  const { tpl, locale } = useSite();
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const paint = (): void => setNow(timeInCountry(country, locale));
    paint();
    // Aligned to the minute rather than ticking every second: nothing here
    // shows seconds, so a per-second timer would be 59 wasted wakeups.
    const id = window.setInterval(paint, 30_000);
    return () => window.clearInterval(id);
  }, [country, locale]);

  return (
    <div className="clock">
      <span className="mono subtle">{tpl.clockLabel(name)}</span>
      {/*
        §3.6: clocks do NOT mirror under RTL. A clock face is not directional,
        and neither is 10:30 — the digits stay in logical order in every script.
      */}
      <span className="clock-time mono" dir="ltr">
        {now ?? '--:--'}
      </span>
      <span className="mono subtle clock-zone">{countryTimeZone(country)}</span>
    </div>
  );
}
