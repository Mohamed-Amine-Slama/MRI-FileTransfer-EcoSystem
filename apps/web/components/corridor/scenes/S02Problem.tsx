'use client';

import { useSite } from '../../../lib/site/site-provider';
import { BlurIn } from '../motion/BlurIn';
import { WordReveal } from '../motion/WordReveal';
import { Card, type CardVariant } from '../primitives/Card';
import { ArtefactCalendar, ArtefactDisc, ArtefactPhone } from './artefacts';

/**
 * Scene 02 — The problem. Spec 2026-09-10 §7.2.
 *
 * "Name the pain before offering the cure." Three cards, one per obstacle,
 * each carrying its drawn artefact (§7.3 bans stock photography; the drawings
 * are ~600 bytes of hairline SVG). The horizontal pin this scene used to carry
 * moved to Scene 09: §6.4 allows one pin on the page.
 *
 * Copy discipline (§Scene 02): no adjectives. The card's title IS the line.
 */
export function S02Problem(): React.JSX.Element {
  const { t } = useSite();

  const cards: {
    Art: () => React.JSX.Element;
    label: string;
    line: string;
    tag: string;
    variant: CardVariant;
  }[] = [
    { Art: ArtefactDisc, label: t.problemCdLabel, line: t.problemCdLine, tag: 'CD-R · 700 MB', variant: 'glass' },
    { Art: ArtefactPhone, label: t.problemPhoneLabel, line: t.problemPhoneLine, tag: 'JPEG · 1.2 MB', variant: 'teal' },
    { Art: ArtefactCalendar, label: t.problemCalendarLabel, line: t.problemCalendarLine, tag: 'T + 42 D', variant: 'lime' },
  ];

  return (
    <section id="problem" className="scene scene--problem" aria-labelledby="problem-title">
      <div className="shell">
        <WordReveal as="h2" id="problem-title" variant="display" text={t.problemTitle} className="display t-h1 measure" />

        <ul className="problem-cards">
          {cards.map(({ Art, label, line, tag, variant }, index) => (
            <li key={label}>
              <BlurIn delay={index * 0.08} className="problem-card-wrap">
                <Card
                  variant={variant}
                  index={String(index + 1).padStart(2, '0')}
                  title={line}
                  label={label}
                  className="problem-card"
                >
                  <Art />
                  <span className="mono problem-tag" aria-hidden="true">
                    {tag}
                  </span>
                </Card>
              </BlurIn>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
