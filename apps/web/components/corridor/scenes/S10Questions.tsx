'use client';

import { FAQ_ROWS } from '../../../lib/site/copy';
import { useSite } from '../../../lib/site/site-provider';
import { FocalReveal } from '../motion/FocalReveal';

/**
 * Scene 10 — Questions. Landing-Page-Specs §Scene 10.
 *
 * "Absorb objections. This is also your SEO surface — these are the queries
 * people actually type."
 *
 * ---------------------------------------------------------------------------
 * NATIVE `<details>`, AND EVERY ANSWER IS IN THE DOM AT LOAD.
 *
 * §Scene 10 requires both, for two separate reasons that happen to have one
 * solution. The SEO reason: an answer injected on click is an answer a crawler
 * never sees, and these eight questions are the page's whole organic surface.
 * The accessibility reason: §9 requires the page to be complete and operable
 * with no JavaScript, and `<details>` is a disclosure widget the browser
 * already implements — keyboard-operable, correctly announced, and with
 * `aria-expanded` semantics the browser keeps in sync for free.
 *
 * A hand-rolled accordion would be more code, worse, and would break the
 * no-JS case. There is no version of this that beats the element.
 *
 * EIGHT QUESTIONS, NO MORE — enforced in `copy.test.ts`. §Scene 10 sets the
 * number and §16 explains it: every question after the eighth dilutes the
 * eight that matter.
 * ---------------------------------------------------------------------------
 *
 * Question 8 — "what happens if the platform shuts down?" — is the one §Scene
 * 10 singles out: "Answer this. Nobody does, and it is the question a careful
 * doctor actually has."
 */
export function S10Questions(): React.JSX.Element {
  const { t, cue } = useSite();

  return (
    <section id="questions" className="scene" aria-labelledby="questions-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <p className="eyebrow">{t.faqEyebrow}</p>
          <h2 id="questions-title" className="display t-h1 measure">
            {t.faqTitle}
          </h2>
        </FocalReveal>

        <FocalReveal plane={2}>
          <div className="faq">
            {FAQ_ROWS.map((row, index) => (
              <details key={row.q} className="faq-item" onToggle={() => cue('press')}>
                <summary className="faq-question">
                  <span className="mono dim faq-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="t-h3">{t[row.q]}</span>
                  {/*
                    The marker is drawn rather than inherited: the default
                    triangle is a physical-direction glyph that does not flip
                    under RTL in every engine, and a plus that becomes a minus
                    reads the same in all three languages.
                  */}
                  <span className="faq-marker" aria-hidden="true" />
                </summary>
                <div className="faq-answer">
                  <p className="ash measure">{t[row.a]}</p>
                </div>
              </details>
            ))}
          </div>
        </FocalReveal>
      </div>
    </section>
  );
}
