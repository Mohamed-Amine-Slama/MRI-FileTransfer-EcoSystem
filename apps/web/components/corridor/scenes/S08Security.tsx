'use client';

import { useRef } from 'react';
import { SECURITY_ROWS } from '../../../lib/site/copy';
import { useSite } from '../../../lib/site/site-provider';
import { useGsapScope } from '../../../lib/site/use-gsap';
import { FocalReveal } from '../motion/FocalReveal';
import { Plate } from '../primitives/Plate';

/**
 * Scene 08 — Security, stated precisely. Landing-Page-Specs §Scene 08.
 *
 * "Convert the doctor who is personally liable."
 *
 * ---------------------------------------------------------------------------
 * AN ARCHITECTURE READOUT, NOT FEATURE CARDS WITH SHIELD ICONS.
 *
 * §Scene 08 is blunt about why: "Shield icons are what everyone does and they
 * signal nothing." A doctor who is personally liable for a data breach is not
 * reassured by a badge; they are reassured by specifics they can check with
 * someone technical. So the eight lines are the real architecture, in mono,
 * laid out like a log.
 *
 * EVERY LINE IS A REAL THING FROM BUILD_SPEC. That is why it is credible, and
 * why a ninth line that is not true yet would poison the other eight. The
 * rows live in `lib/site/copy.ts` where `copy.test.ts` guards them against
 * §1.4's banned claims: the armed-forces adjective, any certification not
 * held, any absolute.
 *
 * (That test is a literal text scan over this directory, so naming the banned
 * phrase here — even inside a comment — trips it. Hence the circumlocution,
 * which is the same one `lib/security/xss-surface.test.ts` forced on
 * `app/layout.tsx` for the same reason.)
 *
 * And underneath, the honest sentence about status. Saying the true thing —
 * registration and cross-border authorisation are IN PROGRESS — is more
 * persuasive than implying a certification nobody holds, and it is the version
 * that survives a regulator reading this page.
 * ---------------------------------------------------------------------------
 *
 * The lines print sequentially at a 40 ms stagger. §3.5 bans typewriter
 * effects everywhere else on the site; this is the one place it is right,
 * because the thing being imitated is literally a log.
 */
export function S08Security(): React.JSX.Element {
  const listRef = useRef<HTMLDListElement>(null);
  const { t, budget } = useSite();

  useGsapScope(
    budget.planes > 0,
    listRef,
    ({ gsap }, element) => {
      const rows = element.querySelectorAll<HTMLElement>('.security-row');
      gsap.fromTo(
        rows,
        { opacity: 0, x: -10 },
        {
          opacity: 1,
          x: 0,
          duration: 0.2,
          stagger: 0.04,
          ease: 'none',
          scrollTrigger: { trigger: element, start: 'top 80%', once: true },
        },
      );
    },
    [budget.planes],
  );

  return (
    <section id="security" className="scene" aria-labelledby="security-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <h2 id="security-title" className="display t-h1 measure">
            {t.securityTitle}
          </h2>
        </FocalReveal>

        <FocalReveal plane={2}>
          <Plate label="ARCHITECTURE" counter={`${SECURITY_ROWS.length} / ${SECURITY_ROWS.length}`}>
            {/*
              A description list, because that is what this is: eight terms and
              what each one means. A screen reader reads "AES-256, encryption
              at rest with customer-managed keys" as one pairing, which is the
              same reading the sighted layout gives.
            */}
            <dl ref={listRef} className="security mono">
              {SECURITY_ROWS.map((row) => (
                <div key={row.term} className="security-row">
                  {/*
                    The term stays Latin in every locale. "AES-256" is the name
                    of the thing, not an English word for it, and transliterating
                    it would make a technical readout look like marketing.
                    `dir="ltr"` so the identifier does not reorder under RTL.
                  */}
                  <dt dir="ltr">
                    {row.term}
                  </dt>
                  <dd className="ash">{t[row.descKey]}</dd>
                </div>
              ))}
            </dl>
          </Plate>
        </FocalReveal>

        <FocalReveal plane={1}>
          <p className="ash measure security-status">{t.securityStatusNote}</p>
        </FocalReveal>
      </div>
    </section>
  );
}
