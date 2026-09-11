'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { corridorLabels } from '../../../lib/site/corridor-labels';
import { useSite } from '../../../lib/site/site-provider';
import { HelixCanvas } from '../helix/HelixCanvas';
import { BlurIn } from '../motion/BlurIn';
import { WordReveal } from '../motion/WordReveal';
import { StatusPill } from '../primitives/StatusPill';

/**
 * Scene 01 — Hero. Spec 2026-09-10 §4.
 *
 * A full-height mint panel: the sentence on the inline-start side, the
 * particle helix behind and beyond it, and a bottom band of trust line,
 * capability chips and the two routes out. Every horizontal position is a
 * logical property, so Arabic mirrors without a second layout.
 *
 * DOM order is the phone's reading order (copy → helix band → rule → trust →
 * chips → actions); from 1000px up the same elements are placed absolutely.
 * Everything waits for the load curtain, so the entrance is not spent under it.
 */
export function S01Hero(): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const { t, tpl, locale } = useSite();
  const corridor = corridorLabels(locale);
  const chips = [t.heroChipUpload, t.heroChipConsent, t.heroChipBytes, t.heroChipBooking];

  return (
    <section ref={sectionRef} id="hero" className="scene scene--hero" aria-labelledby="hero-headline">
      <div className="hero-copy">
        <WordReveal as="p" variant="eyebrow" start="curtain" text={t.heroEyebrow} className="eyebrow" />
        <WordReveal
          as="h1"
          id="hero-headline"
          variant="display"
          start="curtain"
          delay={0.15}
          text={t.heroHeadline}
          className="display t-hero hero-headline"
        />
        <WordReveal
          as="p"
          variant="body"
          start="curtain"
          delay={0.4}
          text={tpl.heroSubhead(corridor.source, corridor.destination)}
          className="t-body-l subtle hero-subhead"
        />
      </div>

      <HelixCanvas hostRef={sectionRef} entrance="curtain" className="hero-helix" />

      <BlurIn start="curtain" delay={0.7} className="hero-rule-wrap">
        <hr className="hero-rule" />
      </BlurIn>

      <BlurIn start="curtain" delay={0.78} className="hero-trust">
        <p className="hero-trust-line">
          {t.heroTrustLine}
          <span className="hero-trust-rule" aria-hidden="true" />
        </p>
        <StatusPill operationalLabel={t.heroStatusOperational} unknownLabel={t.heroStatusUnknown} />
      </BlurIn>

      <BlurIn start="curtain" delay={0.86} className="hero-chips-wrap">
        <ul className="hero-chips">
          {chips.map((chip) => (
            <li key={chip} className="chip">
              {chip}
            </li>
          ))}
        </ul>
      </BlurIn>

      <BlurIn start="curtain" delay={0.94} className="hero-actions">
        {/*
          `data-testid` values are the ones e2e/public-surface.spec.ts and
          e2e/corridor.spec.ts already know. The scene changed; the contract
          that a visitor lands on a page with these two routes out did not.
        */}
        <Link href="/signup" className="btn btn--primary" data-testid="landing-signup">
          {t.heroCtaPrimary}
        </Link>
        <a href="#problem" className="btn btn--secondary" data-testid="landing-how">
          {t.heroCtaSecondary}
        </a>
      </BlurIn>
    </section>
  );
}
