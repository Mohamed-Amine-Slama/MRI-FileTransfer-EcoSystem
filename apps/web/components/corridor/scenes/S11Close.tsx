'use client';

import Link from 'next/link';
import { useSite } from '../../../lib/site/site-provider';
import { FocalReveal } from '../motion/FocalReveal';
import { SLICE_TOTAL } from '../primitives/SliceCounter';

/**
 * Scene 11 — Close. Landing-Page-Specs §Scene 11.
 *
 * "One action."
 *
 * The slice counter, which has been running all page, reaches 180/180 here:
 * the volume completes. That is the reward for the mechanic the hero
 * introduced, and it is the reason the counter was worth having — a progress
 * bar that fills has told you nothing; a stack that ENDS has.
 *
 * THE INVERSION. Everything on this page has been dark; this plate is bone,
 * the only large light surface in the document. It is the last thing seen and
 * it is the brightest, which is how a close should work.
 *
 * The copy returns to the hero line and completes it (§Scene 11), and the
 * page's one remaining action sits under it.
 */
export function S11Close(): React.JSX.Element {
  const { t, cue } = useSite();

  return (
    <section id="close" className="scene scene--close" aria-labelledby="close-title">
      <div className="shell">
        <FocalReveal plane={1}>
          <div className="close-plate">
            <span className="mono close-counter" aria-hidden="true">
              {SLICE_TOTAL} / {SLICE_TOTAL}
            </span>

            {/*
              Centred — one of exactly two places on the page where text is
              centred (§3.3), the hero statement being the other. Centred body
              copy anywhere else is one of the fastest ways to make a page look
              templated.
            */}
            <h2 id="close-title" className="display t-h1 close-line">
              {t.closeLine}
            </h2>

            <div className="close-actions">
              <Link
                href="/signup"
                className="btn btn--invert"
                data-testid="landing-close-signup"
                onPointerDown={() => cue('press')}
              >
                {t.closeCta}
              </Link>
              <Link href="/pricing" className="btn btn--invert-ghost" data-testid="landing-pricing">
                {t.closeSecondary}
              </Link>
            </div>
          </div>
        </FocalReveal>
      </div>
    </section>
  );
}
