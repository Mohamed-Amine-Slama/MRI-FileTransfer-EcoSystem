'use client';

import { useEffect, useRef, useState } from 'react';
import { corridorLabels } from '../../../lib/site/corridor-labels';
import { haptic } from '../../../lib/site/haptics';
import { framePath } from '../../../lib/site/sequence';
import { useSite } from '../../../lib/site/site-provider';
import { useGsapScope } from '../../../lib/site/use-gsap';
import { FocalReveal } from '../motion/FocalReveal';
import { Plate } from '../primitives/Plate';

/**
 * Scene 05 — Consent. Landing-Page-Specs §Scene 05.
 *
 * "The legal and ethical differentiator, and the thing that makes the patient
 * trust it. Most competitors store consent as a boolean."
 *
 * THE KILLER DETAIL is the revoke toggle. Flip it and the study thumbnails go
 * dark within the same frame and the evidence block appends `revoked_at`; flip
 * it back and they return. It demonstrates the platform's real behaviour in
 * two seconds, which is worth more than a paragraph claiming it.
 *
 * NO REAL DOCTOR IS NAMED. §1.4 forbids naming a hospital, clinic or doctor
 * without written permission, and forbids invented ones outright — so the
 * recipient line is a described role ("Receiving doctor in <country>"), with
 * the country resolved from the corridor registry. The redaction is not a
 * placeholder to be filled in later; it is the honest rendering of a consent
 * record whose subject is nobody.
 */
export function S05Consent(): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const stampRef = useRef<HTMLSpanElement>(null);
  const { t, tpl, locale, budget, cue } = useSite();
  const [revoked, setRevoked] = useState(false);
  const corridor = corridorLabels(locale);

  /*
   * The stamp landing — §Scene 05's transition in.
   *
   * "The plate translates up from below with a slight rotation on the x-axis,
   * as a sheet being laid on a lightbox. The only skeuomorphic moment on the
   * site — permitted because consent is the one thing that genuinely still is
   * a document."
   *
   * The impact fires the page's second and last haptic tick. There is no
   * third.
   */
  useGsapScope(
    budget.planes > 0,
    sectionRef,
    ({ gsap }, section) => {
      const stamp = stampRef.current;
      if (stamp === null) return;

      gsap.fromTo(
        stamp,
        { autoAlpha: 0, scale: 2.4, rotate: -14 },
        {
          autoAlpha: 1,
          scale: 1,
          rotate: -7,
          duration: 0.42,
          ease: 'expo.out',
          scrollTrigger: { trigger: section, start: 'top 55%', once: true },
          onStart: () => {
            stamp.style.willChange = 'transform, opacity';
          },
          onComplete: () => {
            stamp.style.willChange = 'auto';
            cue('stamp');
            haptic('consent-stamp', budget.expressive);
          },
        },
      );
    },
    [budget.planes, budget.expressive, cue],
  );

  return (
    <section ref={sectionRef} id="consent" className="scene" aria-labelledby="consent-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <h2 id="consent-title" className="display t-h1 measure">
            {t.consentTitle}
          </h2>
          <p className="t-body-l ash measure consent-body">{t.consentBody}</p>
        </FocalReveal>

        <div className="consent-grid">
          <FocalReveal plane={2}>
            <Plate label="CONSENT · cross_border_transfer" className="consent-document">
              <h3 className="t-h3 consent-doc-title">{t.consentDocumentTitle}</h3>
              <p className="ash consent-doc-body measure">{t.consentDocumentBody}</p>

              <p className="consent-recipient">
                <span className="mono dim">{t.consentGrantedTo}</span>{' '}
                <span className="bone">{tpl.consentRecipient(corridor.destination)}</span>
              </p>
              <p className="mono dim consent-redaction-note">{t.consentRecipientRedacted}</p>

              <span ref={stampRef} className="consent-stamp mono" aria-hidden="true">
                GRANTED
              </span>
            </Plate>
          </FocalReveal>

          <FocalReveal plane={3}>
            <EvidenceBlock revoked={revoked} />

            <div className="consent-revoke">
              {/*
                A real checkbox with a real label, not a styled div: §9 requires
                the whole page to be keyboard-operable, and this control is the
                argument of the scene. The switch role comes free with the
                native input and its checked state is announced correctly.
              */}
              <label className="consent-switch">
                <input
                  type="checkbox"
                  checked={revoked}
                  onChange={(event) => {
                    setRevoked(event.target.checked);
                    cue('press');
                  }}
                  data-testid="consent-revoke"
                />
                <span className="consent-switch-track" aria-hidden="true">
                  <span className="consent-switch-thumb" />
                </span>
                <span>{t.consentRevoke}</span>
              </label>
              <p className="t-meta ash consent-revoke-hint">{t.consentRevokeHint}</p>
            </div>

            <Thumbnails revoked={revoked} />

            <p className="sr-only" role="status" aria-live="polite">
              {revoked ? t.consentAnnounceRevoked : t.consentAnnounceRestored}
            </p>
          </FocalReveal>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * The evidence block — §Scene 05's mono readout, printed line by line.
 *
 * The shape is the platform's real consent record: who it was granted to,
 * which version of the terms they read, when, the hash that makes it
 * tamper-evident, and whether it can be withdrawn. A competitor storing a
 * boolean cannot print this block, which is the entire point of showing it.
 */
function EvidenceBlock({ revoked }: { revoked: boolean }): React.JSX.Element {
  const { locale, budget } = useSite();
  const ref = useRef<HTMLDListElement>(null);
  const corridor = corridorLabels(locale);

  const rows: [string, string][] = [
    /*
     * Redacted, not blank and not invented. §1.4 forbids naming a doctor
     * without written permission and forbids inventing one, so the record
     * shows the shape of the value and the country it resolves to — which is
     * what a real evidence block would show to anyone but the patient.
     */
    ['granted_to', `——————— · ${corridor.destinationCountry}`],
    ['terms_version', `v1.2 · ${locale}`],
    ['granted_at', '2026-03-14T09:22:41Z'],
    ['evidence_hash', '9f2c…a41e'],
    ['revocable', 'yes'],
  ];

  if (revoked) rows.push(['revoked_at', '2026-03-14T09:24:06Z']);

  useGsapScope(
    budget.planes > 0,
    ref,
    ({ gsap }, element) => {
      const lines = element.querySelectorAll<HTMLElement>('.evidence-row');
      gsap.fromTo(
        lines,
        { opacity: 0, x: -8 },
        {
          opacity: 1,
          x: 0,
          duration: 0.24,
          // 40 ms, as §Scene 08 sets for the terminal readout. The two mono
          // blocks on this page print at the same rate on purpose: it is one
          // machine talking, in two places.
          stagger: 0.04,
          ease: 'none',
          scrollTrigger: { trigger: element, start: 'top 85%', once: true },
        },
      );
    },
    [budget.planes],
  );

  return (
    <dl ref={ref} className="evidence mono" data-revoked={revoked}>
      {rows.map(([key, value]) => (
        <div key={key} className="evidence-row">
          <dt className="dim">{key}</dt>
          <dd className={key === 'revoked_at' ? 'sand' : 'ash'}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The studies the consent covers — and the thing the toggle switches off.
 *
 * "The study thumbnails elsewhere on the screen go dark within the same
 * frame." Within the same frame is the requirement, so this is a CSS class
 * change and not an animation: revocation in the product is immediate, and a
 * 300 ms fade would be dramatising a security property as a transition.
 */
function Thumbnails({ revoked }: { revoked: boolean }): React.JSX.Element {
  const { t } = useSite();
  const [frames, setFrames] = useState<string[]>([]);

  /*
   * Resolved after mount so Tier C's HTML carries no thumbnail requests at
   * all. They are decoration for a point the text already makes.
   */
  useEffect(() => {
    setFrames([framePath('b', 5), framePath('b', 11), framePath('b', 17)]);
  }, []);

  return (
    <div className="consent-thumbs" data-revoked={revoked} aria-hidden="true">
      <span className="mono dim consent-thumbs-label">{t.consentThumbnailsLabel}</span>
      <div className="consent-thumb-row">
        {frames.map((src) => (
          <img key={src} src={src} alt="" width={160} height={90} loading="lazy" decoding="async" />
        ))}
        {frames.length === 0 && <span className="consent-thumb-placeholder" />}
      </div>
      {revoked && <span className="mono sand consent-thumbs-notice">{t.consentRevokedNotice}</span>}
    </div>
  );
}
