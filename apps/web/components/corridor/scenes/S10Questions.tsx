'use client';

import { FAQ_ROWS } from '../../../lib/site/copy';
import { useSite } from '../../../lib/site/site-provider';
import { BlurIn } from '../motion/BlurIn';
import { WordReveal } from '../motion/WordReveal';

/**
 * Scene 10 — The questions that are actually asked. Spec 2026-09-10 §7.2.
 *
 * Native <details>: every answer is in the DOM at load (for search, and for
 * a reader with no script), and each opens with no JavaScript at all.
 */
export function S10Questions(): React.JSX.Element {
  const { t, cue } = useSite();

  return (
    <section id="questions" className="scene scene--questions" aria-labelledby="questions-title">
      <div className="shell">
        <WordReveal as="h2" id="questions-title" variant="display" text={t.faqTitle} className="display t-h1 measure" />

        <BlurIn>
          <div className="faq">
            {FAQ_ROWS.map((row, index) => (
              <details key={row.q} className="faq-item" onToggle={() => cue('press')}>
                <summary className="faq-question">
                  <span className="mono subtle faq-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="t-h3">{t[row.q]}</span>
                  <span className="faq-marker" aria-hidden="true" />
                </summary>
                <div className="faq-answer">
                  <p className="subtle measure">{t[row.a]}</p>
                </div>
              </details>
            ))}
          </div>
        </BlurIn>
      </div>
    </section>
  );
}
