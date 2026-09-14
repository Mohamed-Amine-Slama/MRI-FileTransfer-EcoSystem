'use client';

import { SECURITY_ROWS } from '../../../lib/site/copy';
import { useSite } from '../../../lib/site/site-provider';
import { BlurIn } from '../motion/BlurIn';
import { WordReveal } from '../motion/WordReveal';

/**
 * Scene 08 — Security. Spec 2026-09-10 §7.2.
 *
 * What is actually in place, written as it is: each control's own name large,
 * where a statistic would sit, its translated description beneath, a teal
 * rule at its inline-start edge. The names stay untranslated (see
 * SECURITY_ROWS) — "AES-256" is not an English word.
 */
export function S08Security(): React.JSX.Element {
  const { t } = useSite();

  return (
    <section id="security" className="scene scene--security" aria-labelledby="security-title">
      <div className="shell">
        <WordReveal as="h2" id="security-title" variant="display" text={t.securityTitle} className="display t-h1 measure" />

        <BlurIn>
          <dl className="security">
            {SECURITY_ROWS.map((row) => (
              <div key={row.term} className="security-row">
                <dt dir="ltr" className="security-term">
                  {row.term}
                </dt>
                <dd className="subtle security-desc">{t[row.descKey]}</dd>
              </div>
            ))}
          </dl>
        </BlurIn>

        <BlurIn className="security-status">
          <p className="measure">{t.securityStatusNote}</p>
        </BlurIn>
      </div>
    </section>
  );
}
