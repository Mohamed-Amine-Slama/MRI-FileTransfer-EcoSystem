# Landing Re-theme · Plan 3 of 3 — Scenes, Chrome, Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin scenes 02–11, the header and the footer in the light register, each scene gaining the reference mechanic that fits it (cards, scroll-lit text, stacked panels, stats rule, pinned card track, glass accordion, the helix returning at the close), then remove the dark-era primitives.

**Architecture:** Three new motion primitives (`ScrollLitText`, `StackPanel`, `HorizontalTrack`) and three new presentational primitives (`Card`, `DemoCard`, `MirMark`) are each introduced in the task that first mounts them. Scene content, copy keys, interactive demos and `data-testid`s are preserved. The page's single pin moves from S02 to S09. Stacked panels are CSS-sticky inside a group wrapper so the stack ends before S08.

**Tech Stack:** React 19 client components, CSS (logical properties), GSAP + ScrollTrigger, Lenis, Vitest (node + `react-dom/server`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-landing-light-retheme-design.md` (§3.3 primitives, §6 card, §7 scenes/chrome/footer, §9 tests)

**Plan series:** plan 3 of 3. Requires Plan 1 (tokens, `.eyebrow`, `.btn--secondary`, `.chip`, `motion.ts`, `curtain.ts`, `splitWords`) and Plan 2 (`WordReveal`, `BlurIn`, `HelixCanvas`, hero).

## Global Constraints

- Scope: landing page only — `apps/web/components/corridor/**`, `apps/web/app/corridor.css`, `apps/web/lib/site/**`, landing e2e specs, `apps/web/public/map/`, `apps/web/scripts/render-corridor-map.mjs`, `apps/web/vitest.config.ts`, landing docs.
- Provenance: all code original; all copy from `lib/site/copy.ts`; no reference marks, logos or photographs. Image cards use `SEQUENCE.poster` (MIR's synthetic phantom).
- Content, copy keys, interactive behaviour and `data-testid`s are preserved in every scene. Classes asserted by `e2e/corridor.spec.ts` must survive: `.consent-thumb-row img`, `.consent-switch-track`, `.consent-thumbs`, `.evidence`, `.faq details`, `.faq-answer p`, `.footer-locales`, `.control`, `.chrome-link[href="#security"]`, `.skip-link`, `.marketing`.
- Exactly one pinned element on the page at a time (Landing-Page-Specs §6.4) — after this plan, S09's track.
- Contrast: small text uses `.subtle` / `--c-ink-subtle`; `.muted` / `--c-ink-muted` and `[data-lit='off']` only on text ≥ 24px.
- Layout identical across tiers A/B/C; nothing a reader needs hidden by CSS at rest.
- RTL: logical properties; horizontal motion × `sign`; arrows mirror with `scale: -1 1`.
- The page never scrolls horizontally at 360/768/1440/2560 (`e2e/corridor.spec.ts`).
- Web unit tests: `pnpm --filter @mir/web exec vitest run <path>`. E2E: `pnpm --filter @mir/web build`, then `pnpm --filter @mir/web exec playwright test <spec> [--project=chromium]`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
  ```

---

## File map (this plan)

| File | Change | Responsibility |
|---|---|---|
| `components/corridor/primitives/Card.tsx` (+ `.test.tsx`) | create | the card, `ArrowCircle` |
| `components/corridor/primitives/DemoCard.tsx` | create | white working surface for demos (replaces `Plate`) |
| `components/corridor/primitives/MirMark.tsx` | create | the reticle mark for the logo tile |
| `components/corridor/motion/ScrollLitText.tsx` | create | words that darken with scroll |
| `components/corridor/motion/StackPanel.tsx` | create | sticky rounded-top section |
| `components/corridor/motion/HorizontalTrack.tsx` | create | the page's one pin |
| `components/corridor/scenes/S02…S11` | modify/rewrite | scene mapping (spec §7.2) |
| `components/corridor/Corridor.tsx` | modify | the stack group around S04–S07 |
| `components/corridor/CorridorChrome.tsx` | rewrite | floating glass header |
| `lib/site/scroll.ts` | modify | anchors aim at a sticky panel's flow position |
| `vitest.config.ts` | modify | JSX transform for `.test.tsx` |
| `public/map/ly-tn.svg`, `scripts/render-corridor-map.mjs` | modify | map strokes for a light ground |
| `app/corridor.css` | modify | per-scene CSS |
| `e2e/corridor.spec.ts`, `e2e/theme.spec.ts` | modify | track, stacked-anchor tests; comments |
| deleted | — | `motion/WindowingWipe.tsx`, `motion/FocalReveal.tsx`, `primitives/Plate.tsx` |

All paths below are relative to `apps/web/` unless they start with `docs/`.

---

### Task 1: The card, and S02 as three cards

**Files:**
- Create: `components/corridor/primitives/Card.tsx`, `components/corridor/primitives/Card.test.tsx`
- Rewrite: `components/corridor/scenes/S02Problem.tsx`
- Delete: `components/corridor/motion/WindowingWipe.tsx`
- Modify: `vitest.config.ts`, `app/corridor.css`

**Interfaces:**
- Consumes: `WordReveal`, `BlurIn` (Plan 2); `ArtefactDisc`, `ArtefactPhone`, `ArtefactCalendar` (`scenes/artefacts.tsx`).
- Produces:
  - `type CardVariant = 'lime' | 'teal' | 'glass' | 'image'`.
  - `<Card variant title titleAs? titleId? index? label? href? testId? image? onPointerEnter? className? children? />` — `titleAs: 'h2' | 'h3'` (default `'h3'`); `image: { src: string; width: number; height: number }` (used by `variant="image"`). With `href` → a Next `<Link class="card card--…">` whose foot shows `ArrowCircle`; without → `<article>`, no arrow.
  - `<ArrowCircle className? />` → `<span class="arrow-circle" aria-hidden="true"><svg class="arrow-glyph">`.

- [ ] **Step 1: Let Vitest compile JSX**

The app's `tsconfig.json` sets `"jsx": "preserve"` for Next, which esbuild would hand to Node untransformed. In `vitest.config.ts`, add a top-level `esbuild` key to the `defineConfig({ … })` object, next to `test`:

```ts
  // The app's tsconfig preserves JSX for Next; tests run in Node and need it compiled.
  esbuild: { jsx: 'automatic' },
```

- [ ] **Step 2: Write the failing test**

Create `components/corridor/primitives/Card.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArrowCircle, Card } from './Card';

describe('Card (spec §6)', () => {
  it('is an article with no arrow when it links nowhere', () => {
    const html = renderToStaticMarkup(<Card variant="glass" title="The CD" label="CD-R" />);
    expect(html).toMatch(/^<article class="card card--glass"/);
    expect(html).not.toContain('arrow-circle');
    expect(html).toContain('<h3 class="card-title">The CD</h3>');
    expect(html).toContain('<span class="card-label">CD-R</span>');
  });

  it('marks its index as decoration', () => {
    const html = renderToStaticMarkup(<Card variant="lime" index="02" title="Waiting" />);
    expect(html).toContain('<span class="card-index" aria-hidden="true">02</span>');
  });

  it('renders the image variant picture as decoration, under a scrim', () => {
    const html = renderToStaticMarkup(
      <Card variant="image" title="Patients" image={{ src: '/x.avif', width: 10, height: 5 }} />,
    );
    expect(html).toContain('<img class="card-image" src="/x.avif" alt=""');
    expect(html).toContain('class="card-scrim"');
  });

  it('can carry the section heading', () => {
    const html = renderToStaticMarkup(
      <Card variant="teal" titleAs="h2" titleId="doors-title" title="Who are you?" />,
    );
    expect(html).toContain('<h2 id="doors-title" class="card-title">Who are you?</h2>');
  });

  it('keeps the arrow out of the accessibility tree', () => {
    expect(renderToStaticMarkup(<ArrowCircle />)).toMatch(/^<span class="arrow-circle" aria-hidden="true">/);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @mir/web exec vitest run components/corridor/primitives/Card.test.tsx`
Expected: FAIL — `Cannot find module './Card'`.

- [ ] **Step 4: Write the card**

Create `components/corridor/primitives/Card.tsx`:

```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';

export type CardVariant = 'lime' | 'teal' | 'glass' | 'image';

/**
 * The page's card — spec 2026-09-10 §6.
 *
 * Tall, 24px corners: an index and a light title at the top, a label and a
 * circular arrow at the foot. With `href` the WHOLE card is one link and the
 * arrow is its affordance; without it the card is an <article> and has no
 * arrow — an arrow that goes nowhere is a promise the page does not keep.
 */
export function Card({
  variant,
  title,
  titleAs = 'h3',
  titleId,
  index,
  label,
  href,
  testId,
  image,
  onPointerEnter,
  className = '',
  children,
}: {
  variant: CardVariant;
  title: string;
  titleAs?: 'h2' | 'h3';
  titleId?: string;
  /** A small ordinal above the title, e.g. "02". Decorative. */
  index?: string;
  label?: string;
  href?: string;
  testId?: string;
  /** The picture behind an `image` card. Ignored by the other variants. */
  image?: { src: string; width: number; height: number };
  onPointerEnter?: () => void;
  className?: string;
  children?: ReactNode;
}): React.JSX.Element {
  const Title = titleAs;
  const classes = `card card--${variant} ${className}`.trim();

  const inner = (
    <>
      {variant === 'image' && image !== undefined ? (
        <>
          <img
            className="card-image"
            src={image.src}
            alt=""
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
          />
          <span className="card-scrim" aria-hidden="true" />
        </>
      ) : null}
      <div className="card-top">
        {index === undefined ? null : (
          <span className="card-index" aria-hidden="true">
            {index}
          </span>
        )}
        <Title id={titleId} className="card-title">
          {title}
        </Title>
      </div>
      {children === undefined ? null : <div className="card-body">{children}</div>}
      {label === undefined && href === undefined ? null : (
        <div className="card-foot">
          {label === undefined ? null : <span className="card-label">{label}</span>}
          {href === undefined ? null : <ArrowCircle />}
        </div>
      )}
    </>
  );

  if (href !== undefined) {
    return (
      <Link href={href} className={classes} data-testid={testId} onPointerEnter={onPointerEnter}>
        {inner}
      </Link>
    );
  }
  return (
    <article className={classes} data-testid={testId} onPointerEnter={onPointerEnter}>
      {inner}
    </article>
  );
}

/** The outlined circle with a diagonal arrow. Mirrored under RTL by CSS. */
export function ArrowCircle({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <span className={`arrow-circle ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 20 20" className="arrow-glyph" focusable="false">
        <path d="M5.5 14.5 14.5 5.5M7.5 5.5h7v7" />
      </svg>
    </span>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @mir/web exec vitest run components/corridor/primitives/Card.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Rewrite S02**

Replace `components/corridor/scenes/S02Problem.tsx` with:

```tsx
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
```

Then delete the retired wipe: `git rm apps/web/components/corridor/motion/WindowingWipe.tsx`.

- [ ] **Step 7: Card and S02 CSS**

In `app/corridor.css`, delete the rules `.corridor .problem-viewport`, `.corridor .problem-track`, `.corridor .problem-plate`, `.corridor .problem-figure`, `.corridor .problem-line`, and the `@media (min-width: 900px)` block that styles `.problem-track` / `.problem-plate` / `.problem-figure`. Keep the `.artefact*` rules. Then append:

```css
/* ---------------------------------------------------------------------------
 * Card — spec 2026-09-10 §6.
 * ------------------------------------------------------------------------- */
.corridor .card {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-block-size: 22rem;
  padding: 2rem;
  overflow: hidden;
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  color: var(--c-ink);
  text-decoration: none;
}

.corridor .card--lime {
  background-color: var(--c-lime);
  border-color: var(--c-lime-edge);
}

.corridor .card--teal {
  background-color: var(--c-accent);
  border-color: var(--c-accent-deep);
  color: var(--c-on-accent);
}

.corridor .card--glass {
  background-color: var(--c-glass-soft);
  backdrop-filter: blur(var(--glass-blur));
}

.corridor .card--image {
  background-color: var(--c-accent-deep);
  border-color: transparent;
  color: var(--c-on-accent);
}

.corridor .card-image {
  position: absolute;
  inset: 0;
  z-index: -2;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
}

.corridor .card-scrim {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(to bottom, rgb(5 64 56 / 0.35), rgb(5 64 56 / 0.88));
}

.corridor .card-top {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.corridor .card-index {
  font-size: var(--t-body);
  font-weight: 300;
}

.corridor .card-title {
  color: inherit;
  font-family: var(--f-display-latin);
  font-size: var(--t-h2);
  font-weight: 300;
  line-height: var(--leading-display);
}

.corridor[dir='rtl'] .card-title {
  font-family: var(--f-display-arabic);
}

.corridor .card-body {
  flex: 1;
}

.corridor .card-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-block-start: auto;
}

.corridor .card-label {
  font-size: var(--t-pill);
  font-weight: 300;
}

.corridor .arrow-circle {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  inline-size: 4.5rem;
  block-size: 4.5rem;
  border: 1px solid currentColor;
  border-radius: 50%;
  transition:
    background-color var(--dur-normal) var(--ease-entrance),
    border-color var(--dur-normal) var(--ease-entrance),
    color var(--dur-normal) var(--ease-entrance);
}

.corridor .arrow-glyph {
  inline-size: 1.25rem;
  block-size: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: translate var(--dur-normal) var(--ease-entrance);
}

.corridor[dir='rtl'] .arrow-glyph {
  scale: -1 1;
}

.corridor a.card:is(:hover, :focus-visible) .arrow-circle {
  background-color: var(--c-lime);
  border-color: var(--c-lime);
  color: var(--c-ink);
}

.corridor a.card:is(:hover, :focus-visible) .arrow-glyph {
  translate: calc(2px * var(--dir)) -2px;
}

/* ---------------------------------------------------------------------------
 * Scene 02 · problem — three cards.
 * ------------------------------------------------------------------------- */
.corridor .problem-cards {
  display: grid;
  gap: 0.625rem;
  margin: clamp(2.5rem, 6vh, 4rem) 0 0;
  padding: 0;
  list-style: none;
}

.corridor .problem-cards > li,
.corridor .problem-card-wrap {
  display: grid;
}

.corridor .problem-card .artefact {
  inline-size: clamp(72px, 10vw, 112px);
  block-size: auto;
  color: inherit;
}

.corridor .card--teal .artefact-flaw {
  color: var(--c-lime);
  stroke: var(--c-lime);
}

.corridor .problem-tag {
  display: block;
  margin-block-start: 1rem;
  direction: ltr;
  text-align: start;
  opacity: 0.75;
}

@media (min-width: 900px) {
  .corridor .problem-cards {
    grid-template-columns: repeat(3, 1fr);
  }

  .corridor .problem-card {
    min-block-size: 30rem;
  }
}
```

- [ ] **Step 8: Verify and run**

Run from `apps/web`: `grep -rn "WindowingWipe" components lib e2e` — expected: no output.

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web exec vitest run && pnpm --filter @mir/web build`
Expected: all PASS / exit 0.

Run: `pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts --project=chromium`
Expected: PASS (the reveal guard now also polls the three card `[data-reveal]` wrappers).

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/components/corridor apps/web/vitest.config.ts apps/web/app/corridor.css
git commit -m "$(cat <<'EOF'
feat(landing): the card primitive; the problem scene as three cards

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 2: Scroll-lit text, and S03

**Files:**
- Create: `components/corridor/motion/ScrollLitText.tsx`
- Rewrite: `components/corridor/scenes/S03Corridor.tsx`
- Modify: `app/corridor.css`, `public/map/ly-tn.svg`, `scripts/render-corridor-map.mjs`

**Interfaces:**
- Consumes: `litCount` (Plan 1 `motion.ts`), `splitWords` (Plan 1), `useGsapScope`, `BlurIn` (Plan 2).
- Produces: `<ScrollLitText text as? id? className? />` — `as: 'h2' | 'p'` (default `'p'`); word spans carry `data-lit="off|on"`.

- [ ] **Step 1: Write `ScrollLitText`**

Create `components/corridor/motion/ScrollLitText.tsx`:

```tsx
'use client';

import { Fragment, createElement, useEffect, useRef, useState } from 'react';
import { litCount } from '../../../lib/site/motion';
import { useSite } from '../../../lib/site/site-provider';
import { splitWords } from '../../../lib/site/split';
import { useGsapScope } from '../../../lib/site/use-gsap';

/**
 * Words that darken as the reader scrolls through them — spec 2026-09-10 §3.3.
 *
 * The resting state (server, Tier C, reduced motion) is plain ink text: the
 * split into muted words happens only on a tier whose ScrollTrigger will also
 * light them. Unlit words are `--c-ink-muted` (3.3:1), so this is for large
 * text only — a heading or a ≥ 24px statement.
 */
export function ScrollLitText({
  text,
  as = 'p',
  id,
  className = '',
}: {
  text: string;
  as?: 'h2' | 'p';
  id?: string;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const { budget } = useSite();
  const [split, setSplit] = useState(false);
  const animates = budget.planes > 0;

  useEffect(() => {
    if (animates) setSplit(true);
  }, [animates]);

  useGsapScope(
    animates && split,
    ref,
    ({ ScrollTrigger }, element) => {
      const words = [...element.querySelectorAll<HTMLElement>('[data-lit]')];
      let lit = -1;
      const paint = (progress: number): void => {
        const n = litCount(progress, words.length);
        if (n === lit) return;
        lit = n;
        words.forEach((word, index) => {
          word.dataset.lit = index < n ? 'on' : 'off';
        });
      };
      const trigger = ScrollTrigger.create({
        trigger: element,
        start: 'top 75%',
        end: 'bottom 45%',
        onUpdate: (self) => paint(self.progress),
        onRefresh: (self) => paint(self.progress),
      });
      paint(trigger.progress);
      return undefined;
    },
    [animates, split, text],
  );

  const heading = as !== 'p';
  const words = split ? splitWords(text) : null;

  const content =
    words === null ? (
      text
    ) : (
      <>
        {heading ? null : <span className="sr-only">{text}</span>}
        <span aria-hidden={heading ? undefined : true}>
          {words.map((word, index) => (
            <Fragment key={`${index}-${word}`}>
              <span data-lit="off">{word}</span>
              {index < words.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </span>
      </>
    );

  return createElement(
    as,
    { ref, id, className: className === '' ? undefined : className, 'aria-label': heading ? text : undefined },
    content,
  );
}
```

- [ ] **Step 2: Rewrite S03**

Replace `components/corridor/scenes/S03Corridor.tsx` with:

```tsx
'use client';

import { useRef } from 'react';
import { CORRIDOR_MAPS } from '../../../lib/site/corridor-map.generated';
import { corridorLabels } from '../../../lib/site/corridor-labels';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';
import { BlurIn } from '../motion/BlurIn';
import { ScrollLitText } from '../motion/ScrollLitText';

/**
 * Scene 03 — The corridor. Spec 2026-09-10 §7.2.
 *
 * The sentence is read word by word as the reader scrolls through it; then
 * the two ends of the corridor as chips joined by a teal rule; then the map,
 * whose route draws once with the scroll and STAYS drawn — not a loop, which
 * is the most reused visual in enterprise tech (§2.1).
 *
 * The eyebrow is the route itself ("From X to Y"), not a label repeating the
 * heading: the page allows an eyebrow only when it says something new.
 * No country is named in code — the labels come from the registry (§4.3).
 */
export function S03Corridor(): React.JSX.Element {
  const routeRef = useRef<SVGPathElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const { t, tpl, locale, budget } = useSite();

  const corridor = corridorLabels(locale);
  const map = CORRIDOR_MAPS[corridor.id];

  /*
   * The draw: `stroke-dasharray` set to the path's measured length and
   * `stroke-dashoffset` scrubbed from that length to zero. Measured, not
   * guessed — the corridor can be regenerated for different endpoints.
   */
  useGsapScope(
    budget.planes > 0,
    sectionRef,
    ({ gsap }, section) => {
      const route = routeRef.current;
      if (route === null) return;

      const length = route.getTotalLength();
      gsap.fromTo(
        route,
        { strokeDasharray: length, strokeDashoffset: length },
        {
          strokeDashoffset: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: section,
            start: 'top 40%',
            end: 'bottom 70%',
            scrub: 0.8,
          },
          ...promoting(route, 'stroke-dashoffset'),
        },
      );
    },
    [budget.planes, corridor.id],
  );

  return (
    <section ref={sectionRef} id="corridor" className="scene scene--corridor" aria-labelledby="corridor-title">
      <div className="shell corridor-shell">
        <p className="eyebrow">{tpl.corridorRoute(corridor.source, corridor.destination)}</p>
        <ScrollLitText as="h2" id="corridor-title" text={t.corridorTitle} className="display t-h1 corridor-title" />
        <ScrollLitText text={t.corridorBody} className="t-h2 corridor-body" />

        <BlurIn className="corridor-ends">
          <span className="chip">
            {t.corridorSourceLabel} · {corridor.source}
          </span>
          <span className="corridor-link" aria-hidden="true" />
          <span className="chip">
            {t.corridorDestinationLabel} · {corridor.destination}
          </span>
        </BlurIn>

        <BlurIn className="corridor-map-card">
          <figure className="corridor-map">
            {map === undefined ? null : (
              <>
                {/* Decorative: the route is described in words by the caption and the chips above. */}
                <img
                  src={map.image}
                  alt=""
                  width={1200}
                  height={675}
                  loading="lazy"
                  decoding="async"
                  className="corridor-map-plate"
                  aria-hidden="true"
                />
                <svg viewBox={map.viewBox} className="corridor-route" fill="none" aria-hidden="true">
                  <path ref={routeRef} d={map.route} stroke="var(--c-accent)" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx={map.source[0]} cy={map.source[1]} r="5" fill="var(--c-accent)" />
                  <circle cx={map.destination[0]} cy={map.destination[1]} r="5" fill="var(--c-accent)" />
                </svg>
              </>
            )}
            <figcaption className="sr-only">{t.corridorMapAlt}</figcaption>
          </figure>

          <div className="corridor-readout">
            {/*
              847 MB is a real size for a CT study; the caption beside it says
              it illustrates one transfer (§5: numbers are specific or absent).
            */}
            <p className="mono subtle corridor-readout-line">ENCRYPTED · TLS 1.3 · 847 MB · CONSENT: GRANTED</p>
            <p className="mono subtle">{t.corridorReadoutCaption}</p>
          </div>
        </BlurIn>
      </div>
    </section>
  );
}
```

(The draw's `start`/`end` moved from `top 70%`/`center center` because the map now sits below a lit paragraph instead of at the scene's top; it still completes while the map is on screen.)

- [ ] **Step 3: Recolour the map plate for a light ground**

The plate was drawn in slate hairlines meant to be faint on near-black. Change both the committed SVG and the generator's constants so a future re-render matches. Run from `apps/web`:

```bash
sed -i 's/#1E272F/#D3DDD9/g; s/#93A0AC/#6F827B/g' public/map/ly-tn.svg scripts/render-corridor-map.mjs
grep -c "#D3DDD9\|#6F827B" public/map/ly-tn.svg scripts/render-corridor-map.mjs
```
Expected: a non-zero count for both files.

- [ ] **Step 4: S03 and scroll-lit CSS**

In `app/corridor.css`, delete `.corridor .corridor-plate-wrap`, `.corridor .corridor-legend`, `.corridor .legend-dot` and `.corridor .corridor-readout { margin-block-start: 1.5rem; }`. Keep `.corridor-map`, `.corridor-map-plate`, `.corridor-route` and `.corridor-readout-line`. Append:

```css
/* ---------------------------------------------------------------------------
 * Scroll-lit words — spec §3.3. Large text only.
 * ------------------------------------------------------------------------- */
.corridor [data-lit] {
  color: var(--c-ink-muted);
  transition: color var(--dur-normal) var(--ease-entrance);
}

.corridor [data-lit='on'] {
  color: var(--c-ink);
}

/* ---------------------------------------------------------------------------
 * Scene 03 · corridor.
 * ------------------------------------------------------------------------- */
.corridor .corridor-shell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  text-align: center;
}

.corridor .corridor-title {
  max-inline-size: 18em;
}

.corridor .corridor-body {
  max-inline-size: 30em;
  margin: 0;
  font-weight: 300;
  line-height: var(--leading-display);
}

.corridor .corridor-ends {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-block-start: 1rem;
}

.corridor .corridor-link {
  inline-size: clamp(2rem, 8vw, 6rem);
  block-size: 1px;
  background-color: var(--c-accent);
}

.corridor .corridor-map-card {
  inline-size: 100%;
  margin-block-start: clamp(2rem, 5vh, 3rem);
  overflow: hidden;
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  background-color: var(--c-panel);
  text-align: start;
}

.corridor .corridor-readout {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem clamp(1.25rem, 3vw, 2rem) 1.25rem;
  border-block-start: 1px solid var(--c-line);
}
```

- [ ] **Step 5: Run**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts --project=chromium`
Expected: PASS. Then check by eye at `/fr?tier=A`: scroll through S03 — the title and statement darken word by word; `?tier=C` shows them fully dark.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/corridor apps/web/app/corridor.css apps/web/public/map/ly-tn.svg apps/web/scripts/render-corridor-map.mjs
git commit -m "$(cat <<'EOF'
feat(landing): scroll-lit corridor statement, route chips, light map plate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 3: Stacked panels — S04 upload and S05 consent

**Files:**
- Create: `components/corridor/motion/StackPanel.tsx`, `components/corridor/primitives/DemoCard.tsx`
- Modify: `components/corridor/scenes/S04UploadDemo.tsx`, `components/corridor/scenes/S05Consent.tsx`, `components/corridor/Corridor.tsx`, `lib/site/scroll.ts`, `app/corridor.css`, `e2e/corridor.spec.ts`

**Interfaces:**
- Consumes: `WordReveal`, `BlurIn` (Plan 2); `useSite().budget`.
- Produces:
  - `type PanelTone = 'mint' | 'deep' | 'white'`; `<StackPanel id labelledBy tone className? children />` → `<section id class="scene stack-panel stack-panel--{tone} [is-stacking]" aria-labelledby>`; sets `--panel-h` on itself.
  - `<DemoCard label? counter? padded? className? children />` → `<div class="demo-card"><div class="demo-card-head" aria-hidden>…</div><div class="demo-card-body">…</div></div>` (`padded` default `true`).
  - Composition: `<div className="stack-group">` wraps the stacked panels (S04, S05 now; S06, S07 join in Task 4).
  - `lib/site/scroll.ts`: anchors scroll to a target's **flow** position even while it is `position: sticky`.

- [ ] **Step 1: Write the failing e2e test**

In `e2e/corridor.spec.ts`, add inside `test.describe('focal reveals (§3.5, §6.6, §12 L5)', …)`, after the anchor test:

```ts
  test('an anchor to a stacked panel arrives even while that panel is stuck (spec §3.3)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the chrome nav is a desktop control');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');
    const upload = page.locator('#upload');
    await expect(upload).toHaveClass(/is-stacking/, { timeout: 15_000 });

    // Park the reader inside the consent panel, with the upload panel stuck behind it.
    await page.evaluate(() => {
      const consent = document.getElementById('consent');
      if (consent === null) return;
      consent.style.position = 'relative';
      const top = consent.getBoundingClientRect().top + window.scrollY;
      consent.style.position = '';
      window.scrollTo(0, top + 200);
    });
    await page.waitForTimeout(800);

    await page.locator('.chrome-link[href="#upload"]').first().click();
    await expect
      .poll(async () => Math.abs((await upload.boundingBox())?.y ?? 999), { timeout: 10_000 })
      .toBeLessThan(4);
    // …and it is the upload panel on screen, not the consent panel over it.
    expect((await page.locator('#consent').boundingBox())?.y ?? 0).toBeGreaterThan(400);
  });
```

- [ ] **Step 2: Write `StackPanel` and `DemoCard`**

Create `components/corridor/motion/StackPanel.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSite } from '../../../lib/site/site-provider';

export type PanelTone = 'mint' | 'deep' | 'white';

/**
 * A section with rounded top corners that slides over the one before it —
 * spec 2026-09-10 §3.3.
 *
 * Sticky, not pinned: no ScrollTrigger and no spacer, so §6.4's one-pin rule
 * has nothing to count. `top` is `min(0px, 100lvh − height)`: a panel taller
 * than the viewport scrolls all the way through before it sticks, so nothing
 * inside it is covered by the next panel before the reader has seen it.
 *
 * Panels must sit inside a `.stack-group`: a sticky element stays stuck until
 * its parent ends, and the group is what makes the stack end before Scene 08.
 * Stacking needs the measured height, so it switches on only once JS has run;
 * on Tier C the panels overlap by one corner radius, statically.
 */
export function StackPanel({
  id,
  labelledBy,
  tone,
  className = '',
  children,
}: {
  id: string;
  labelledBy: string;
  tone: PanelTone;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const { budget } = useSite();
  const [stacking, setStacking] = useState(false);
  const animates = budget.planes > 0;

  useEffect(() => {
    const element = ref.current;
    if (!animates || element === null) return;
    const measure = (): void => {
      element.style.setProperty('--panel-h', `${element.offsetHeight}px`);
    };
    measure();
    setStacking(true);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.style.removeProperty('--panel-h');
      setStacking(false);
    };
  }, [animates]);

  const classes = ['scene', 'stack-panel', `stack-panel--${tone}`, stacking ? 'is-stacking' : '', className]
    .filter((c) => c !== '')
    .join(' ');

  return (
    <section ref={ref} id={id} aria-labelledby={labelledBy} className={classes}>
      {children}
    </section>
  );
}
```

Create `components/corridor/primitives/DemoCard.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * The white working surface under each product demo — spec 2026-09-10 §7.2.
 * Replaces `Plate`. The label and counter are frame furniture, so they are
 * `aria-hidden`: the copy around the card already says what they say.
 */
export function DemoCard({
  label,
  counter,
  padded = true,
  className = '',
  children,
}: {
  label?: string;
  counter?: string;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={`demo-card ${className}`.trim()}>
      {label === undefined && counter === undefined ? null : (
        <div className="demo-card-head" aria-hidden="true">
          <span>{label}</span>
          {counter === undefined ? null : <span className="demo-card-counter">{counter}</span>}
        </div>
      )}
      <div className={padded ? 'demo-card-body' : undefined}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Move S04 onto a panel**

In `components/corridor/scenes/S04UploadDemo.tsx`:

1. Replace `import { FocalReveal } from '../motion/FocalReveal';` with `import { BlurIn } from '../motion/BlurIn';`, `import { StackPanel } from '../motion/StackPanel';` and `import { WordReveal } from '../motion/WordReveal';`; replace `import { Plate } from '../primitives/Plate';` with `import { DemoCard } from '../primitives/DemoCard';`.
2. Replace the whole `return ( <section id="upload" … </section> );` of `S04UploadDemo` with:

```tsx
  return (
    <StackPanel id="upload" labelledBy="upload-title" tone="mint">
      <div className="shell">
        <p className="standfirst measure">{t.uploadEyebrow}</p>
        <WordReveal as="h2" id="upload-title" variant="display" text={t.uploadTitle} className="display t-h1 measure" />
        <p className="t-body-l subtle measure upload-body">{t.uploadBody}</p>
        <BlurIn className="upload-stage">{budget.interactiveDemo ? <InteractiveDemo /> : <StaticStates />}</BlurIn>
      </div>
    </StackPanel>
  );
```
3. Run from `apps/web`:

```bash
perl -pi -e 's/<Plate\b/<DemoCard/g; s{</Plate>}{</DemoCard>}g; s/btn btn--ghost upload-cut/btn btn--secondary upload-cut/' components/corridor/scenes/S04UploadDemo.tsx
grep -n "Plate\|FocalReveal" components/corridor/scenes/S04UploadDemo.tsx
```
Expected: no output from `grep`. (The cut control becomes the lime pill — spec §7.2.)

- [ ] **Step 4: Move S05 onto a panel**

In `components/corridor/scenes/S05Consent.tsx`:

1. Replace the `FocalReveal` and `Plate` imports as in Step 3 (add `BlurIn`, `StackPanel`, `WordReveal`, `DemoCard`).
2. Change `const sectionRef = useRef<HTMLElement>(null);` to `const sceneRef = useRef<HTMLDivElement>(null);`, and in the stamp's `useGsapScope(…)` call change the second argument from `sectionRef` to `sceneRef` and the setup's parameter name from `section` to `scene` (so `scrollTrigger: { trigger: scene, start: 'top 55%', once: true }`).
3. Replace the whole `return ( … );` of `S05Consent` with:

```tsx
  return (
    <StackPanel id="consent" labelledBy="consent-title" tone="deep">
      <div ref={sceneRef} className="shell">
        <WordReveal as="h2" id="consent-title" variant="display" text={t.consentTitle} className="display t-h1 measure" />
        <p className="t-body-l subtle measure consent-body">{t.consentBody}</p>

        <div className="consent-grid">
          <BlurIn>
            <DemoCard label="CONSENT · cross_border_transfer" className="consent-document">
              <h3 className="t-h3 consent-doc-title">{t.consentDocumentTitle}</h3>
              <p className="subtle consent-doc-body measure">{t.consentDocumentBody}</p>
              <p className="consent-recipient">
                <span className="mono subtle">{t.consentGrantedTo}</span>{' '}
                <span className="ink">{tpl.consentRecipient(corridor.destination)}</span>
              </p>
              <p className="mono subtle consent-redaction-note">{t.consentRecipientRedacted}</p>
              <span ref={stampRef} className="consent-stamp mono" aria-hidden="true">
                GRANTED
              </span>
            </DemoCard>
          </BlurIn>

          <BlurIn delay={0.08}>
            <EvidenceBlock revoked={revoked} />
            <div className="consent-revoke">
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
              <p className="t-meta subtle consent-revoke-hint">{t.consentRevokeHint}</p>
            </div>
            <Thumbnails revoked={revoked} />
            <p className="sr-only" role="status" aria-live="polite">
              {revoked ? t.consentAnnounceRevoked : t.consentAnnounceRestored}
            </p>
          </BlurIn>
        </div>
      </div>
    </StackPanel>
  );
```

Leave `EvidenceBlock` and `Thumbnails` as they are.

- [ ] **Step 5: Group the panels**

In `components/corridor/Corridor.tsx`, replace

```tsx
          <S04UploadDemo />
          <S05Consent />
```
with
```tsx
          {/* A sticky panel stays stuck until its parent ends; the group ends the stack. */}
          <div className="stack-group">
            <S04UploadDemo />
            <S05Consent />
          </div>
```

- [ ] **Step 6: Aim anchors at a panel's flow position**

In `lib/site/scroll.ts`, directly above `const focusTarget = …`, add:

```ts
  /**
   * Where an element sits in the document's flow, even while it is stuck.
   *
   * A stacked panel (StackPanel) is `position: sticky`; while stuck, its box
   * is where it is PAINTED, not where it LIVES, so aiming at it from further
   * down the page scrolled nowhere. Sticky is switched off for one
   * synchronous layout to measure it; nothing paints in between.
   */
  const flowTop = (target: HTMLElement): number => {
    const sticky = getComputedStyle(target).position === 'sticky';
    if (sticky) target.style.position = 'relative';
    const top = target.getBoundingClientRect().top + window.scrollY;
    if (sticky) target.style.position = '';
    return top;
  };
```

Then change the three `lenis.scrollTo(target, …)` calls — in `aim`, in `realign`, and in `onAnchorClick` — to `lenis.scrollTo(flowTop(target), …)`, keeping each call's options object unchanged.

- [ ] **Step 7: Panel and demo-card CSS**

Append to `app/corridor.css`:

```css
/* ---------------------------------------------------------------------------
 * Stacked panels — spec §3.3. Sticky only once measured (.is-stacking).
 * ------------------------------------------------------------------------- */
.corridor .stack-panel {
  --panel-bg: var(--c-panel);
  position: relative;
  margin-block-start: calc(var(--r-section) * -1);
  border-start-start-radius: var(--r-section);
  border-start-end-radius: var(--r-section);
  background-color: var(--panel-bg);
  box-shadow: 0 -16px 40px -32px rgb(0 0 0 / 0.25);
}

.corridor .stack-panel--deep {
  --panel-bg: var(--c-panel-deep);
}

.corridor .stack-panel--white {
  --panel-bg: var(--c-ground);
}

.corridor .stack-panel.is-stacking {
  position: sticky;
  inset-block-start: min(0px, calc(100lvh - var(--panel-h, 100lvh)));
}

.corridor .stack-group > .stack-panel:last-child {
  border-end-start-radius: var(--r-section);
  border-end-end-radius: var(--r-section);
}

/* ---------------------------------------------------------------------------
 * Demo card — the white working surface (replaces Plate).
 * ------------------------------------------------------------------------- */
.corridor .demo-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  background-color: var(--c-ground);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.04),
    0 24px 48px -32px rgb(0 0 0 / 0.18);
}

.corridor .demo-card-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1.5rem;
  border-block-end: 1px solid var(--c-line);
  color: var(--c-ink-subtle);
  font-family: var(--f-mono);
  font-size: 0.75rem;
}

.corridor .demo-card-counter {
  font-variant-numeric: tabular-nums;
  unicode-bidi: plaintext;
}

.corridor .demo-card-body {
  padding: clamp(1.25rem, 3vw, 2rem);
}

.corridor .upload-stage {
  margin-block-start: clamp(2rem, 5vh, 3rem);
}

.corridor .consent-switch-thumb {
  background-color: var(--c-ground);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
}
```

- [ ] **Step 8: Run**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build`
Expected: exit 0.

Run: `pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts`
Expected: PASS on both projects — including the new stacked-anchor test (chromium), the upload keyboard test, the no-network test, and the consent revoke test.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/corridor apps/web/lib/site/scroll.ts apps/web/app/corridor.css apps/web/e2e/corridor.spec.ts
git commit -m "$(cat <<'EOF'
feat(landing): stacked panels for the upload and consent demos

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 4: S06 viewer and S07 appointment join the stack

**Files:**
- Rewrite: `components/corridor/scenes/S06Viewer.tsx`
- Modify: `components/corridor/scenes/S07Appointment.tsx`, `components/corridor/Corridor.tsx`, `app/corridor.css`

**Interfaces:**
- Consumes: `StackPanel`, `DemoCard` (Task 3); `WordReveal`, `BlurIn` (Plan 2); `SEQUENCE` (Plan 2 Task 6).
- Produces: the stack group now holds S04, S05, S06, S07; S07's `Clock` renders `.clock` blocks without the `mono` class on the time.

- [ ] **Step 1: Rewrite S06**

Replace `components/corridor/scenes/S06Viewer.tsx` with:

```tsx
'use client';

import { SEQUENCE } from '../../../lib/site/sequence';
import { useSite } from '../../../lib/site/site-provider';
import { BlurIn } from '../motion/BlurIn';
import { StackPanel } from '../motion/StackPanel';
import { WordReveal } from '../motion/WordReveal';
import { DemoCard } from '../primitives/DemoCard';

/**
 * Scene 06 — The viewer. Spec 2026-09-10 §7.2.
 *
 * Live markup in the application's own light tokens, not a screenshot: §9
 * forbids text baked into images, and the reference-only banner has to be
 * readable in the reader's language. Still an illustration of the screen —
 * see the open items in docs/landing-page-status.md.
 */
export function S06Viewer(): React.JSX.Element {
  const { t } = useSite();

  return (
    <StackPanel id="viewer" labelledBy="viewer-title" tone="white">
      <div className="shell">
        <WordReveal as="h2" id="viewer-title" variant="display" text={t.viewerTitle} className="display t-h1 measure" />

        <div className="viewer-grid">
          <BlurIn>
            <DemoCard label="VIEWER" padded={false} className="viewer-plate">
              <div className="viewer-panel">
                <p className="viewer-banner" data-testid="viewer-banner">
                  {t.viewerBanner}
                </p>
                <div className="viewer-body">
                  <div className="viewer-rail" aria-hidden="true">
                    <span className="viewer-tool" />
                    <span className="viewer-tool" />
                    <span className="viewer-tool" />
                    <span className="viewer-tool" />
                  </div>
                  <div className="viewer-stage">
                    <img
                      src={SEQUENCE.poster}
                      alt=""
                      width={SEQUENCE.width}
                      height={SEQUENCE.height}
                      loading="lazy"
                      decoding="async"
                      aria-hidden="true"
                    />
                    {/* The phantom's own metadata, deliberately readable as synthetic. */}
                    <span className="viewer-meta viewer-meta--start mono">
                      SYNTHETIC^PHANTOM
                      <br />
                      1.3.6.1.4.1.99999.1
                    </span>
                    <span className="viewer-meta viewer-meta--end mono">
                      CT · AX
                      <br />
                      W 400 / L 40
                    </span>
                  </div>
                </div>
              </div>
            </DemoCard>
          </BlurIn>

          <BlurIn delay={0.08} className="viewer-copy">
            <p className="t-body-l measure">{t.viewerBody}</p>
          </BlurIn>
        </div>
      </div>
    </StackPanel>
  );
}
```

- [ ] **Step 2: Move S07 onto a panel**

In `components/corridor/scenes/S07Appointment.tsx`:

1. Replace the `FocalReveal` and `Plate` imports with `BlurIn`, `StackPanel`, `WordReveal` and `DemoCard` imports (paths as in Task 3).
2. Replace the whole `return ( … );` of `S07Appointment` with:

```tsx
  return (
    <StackPanel id="appointment" labelledBy="appointment-title" tone="mint">
      <div className="shell">
        <WordReveal as="h2" id="appointment-title" variant="display" text={t.appointmentTitle} className="display t-h1 measure" />
        <p className="t-body-l subtle measure appointment-body">{t.appointmentBody}</p>

        <BlurIn className="appointment-stage">
          <DemoCard label="SCHEDULE" counter="2 TZ">
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
          </DemoCard>
        </BlurIn>
      </div>
    </StackPanel>
  );
```
3. In `Clock`, change `className="clock-time mono"` to `className="clock-time"` (keep `dir="ltr"`).

- [ ] **Step 3: Extend the group**

In `components/corridor/Corridor.tsx`, move `<S06Viewer />` and `<S07Appointment />` inside the `stack-group` div, after `<S05Consent />`.

- [ ] **Step 4: S07 CSS**

In `app/corridor.css`, replace the rules `.corridor .appointment-clocks`, `.corridor .clock` and `.corridor .clock-time` with:

```css
.corridor .appointment-stage {
  margin-block-start: clamp(2rem, 5vh, 3rem);
}

.corridor .appointment-clocks {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-block-end: 1.5rem;
  border-block-end: 1px solid var(--c-line);
}

.corridor .clock {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.5rem;
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  background-color: var(--c-panel);
}

.corridor .clock-time {
  color: var(--c-ink);
  font-family: var(--f-display-latin);
  font-size: clamp(2rem, 5vw, 3rem);
  font-variant-numeric: tabular-nums;
  font-weight: 300;
  line-height: 1;
}
```

- [ ] **Step 5: Run**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts`
Expected: PASS on both projects (including `states the reference-only limit` for `viewer-banner`). Check by eye at `/fr?tier=A`: four panels slide over one another, S07 ends with rounded bottom corners on the white ground, and S08 scrolls in normally beneath nothing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/corridor apps/web/app/corridor.css
git commit -m "$(cat <<'EOF'
feat(landing): viewer and appointment join the panel stack

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 5: S08 security as a stats grid

**Files:**
- Rewrite: `components/corridor/scenes/S08Security.tsx`
- Modify: `app/corridor.css`

**Interfaces:**
- Consumes: `SECURITY_ROWS` (`lib/site/copy.ts`, terms untranslated by design), `WordReveal`, `BlurIn`.
- Produces: `#security` with `dl.security > .security-row > dt.security-term + dd.security-desc`.

- [ ] **Step 1: Rewrite S08**

Replace `components/corridor/scenes/S08Security.tsx` with:

```tsx
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
```

- [ ] **Step 2: S08 CSS**

In `app/corridor.css`, replace the rules `.corridor .security`, `.corridor .security-row`, `.corridor .security-row dt`, `.corridor .security-row dd`, `.corridor .security-status` and the `@media (min-width: 700px)` block that styles `.security-row` with:

```css
/* ---------------------------------------------------------------------------
 * Scene 08 · security — the control's name in the stat slot.
 * ------------------------------------------------------------------------- */
.corridor .security {
  display: grid;
  gap: 2.5rem 1.5rem;
  margin: clamp(2.5rem, 6vh, 4rem) 0 0;
}

.corridor .security-row {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-inline-start: 1.5rem;
  border-inline-start: 1px solid var(--c-accent);
}

.corridor .security-term {
  color: var(--c-ink);
  font-family: var(--f-display-latin);
  font-size: clamp(2rem, 1.6rem + 1.2vw, 3rem);
  font-weight: 300;
  line-height: 1;
  text-align: start;
}

.corridor[dir='rtl'] .security-term {
  text-align: right;
}

.corridor .security-desc {
  margin: 0;
}

.corridor .security-status {
  margin-block-start: 3rem;
  padding: 1.5rem 2rem;
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  background-color: var(--c-panel);
}

.corridor .security-status p {
  margin: 0;
}

@media (min-width: 700px) {
  .corridor .security {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1100px) {
  .corridor .security {
    grid-template-columns: repeat(4, 1fr);
  }
}
```

(`dt` is `dir="ltr"` for the term, so under RTL its own `start` is the left; the RTL rule aligns it with the rule on the right.)

- [ ] **Step 3: Run**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts --project=chromium`
Expected: PASS (the anchor test still lands on `#security`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/corridor/scenes/S08Security.tsx apps/web/app/corridor.css
git commit -m "$(cat <<'EOF'
feat(landing): security controls as a stats grid with a teal rule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 6: The pinned door track — S09

**Files:**
- Create: `components/corridor/motion/HorizontalTrack.tsx`
- Rewrite: `components/corridor/scenes/S09Doors.tsx`
- Modify: `app/corridor.css`, `lib/site/scroll.ts` (comment), `e2e/corridor.spec.ts`

**Interfaces:**
- Consumes: `trackTravel`, `trackX` (Plan 1 `motion.ts`); `Card` (Task 1); `SEQUENCE`; `useSite().sign`.
- Produces: `<HorizontalTrack pinRef className? children />` with `pinRef: RefObject<HTMLElement | null>`; DOM `div.track-viewport[.is-pinned] > div.track`. The page's single pin.

- [ ] **Step 1: Write the failing e2e tests**

Append to `e2e/corridor.spec.ts`:

```ts
// ---------------------------------------------------------------------------
// Scene 09 — the door track, the page's one pin (§6.4)
// ---------------------------------------------------------------------------

test.describe('the door track (spec §7.2)', () => {
  test('pins while its cards travel toward the reader, then lets go', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the pinned track needs a fine pointer and 900px');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');
    await expect(page.locator('#doors .track-viewport')).toHaveClass(/is-pinned/, { timeout: 15_000 });

    const top = await page.evaluate(
      () => (document.getElementById('doors')?.getBoundingClientRect().top ?? 0) + window.scrollY,
    );
    await page.evaluate((y) => window.scrollTo(0, y - 10), top);
    await page.waitForTimeout(800);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1500);

    const pinned = await page.locator('#doors').boundingBox();
    expect(Math.abs(pinned?.y ?? 99), 'the section is held at the top').toBeLessThan(2);
    const x = await page
      .locator('#doors .track')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    expect(x, 'the cards moved toward the reader\'s forward (leftward in fr)').toBeLessThan(-50);

    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1500);
    const released = await page.locator('#doors').boundingBox();
    expect(released?.y ?? 0, 'released after its travel').toBeLessThan(-100);
  });

  test('is a native swipe row when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/fr');
    const viewport = page.locator('#doors .track-viewport');
    await expect(viewport).not.toHaveClass(/is-pinned/);
    await expect(viewport).toHaveCSS('overflow-x', 'auto');
    await expect(page.getByTestId('door-doctors')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts --project=chromium -g "door track"`
Expected: FAIL — `#doors .track-viewport` not found.

- [ ] **Step 3: Write `HorizontalTrack`**

Create `components/corridor/motion/HorizontalTrack.tsx`:

```tsx
'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { trackTravel, trackX } from '../../../lib/site/motion';
import { useSite } from '../../../lib/site/site-provider';
import { promoting, useGsapScope } from '../../../lib/site/use-gsap';

/**
 * A row of cards that moves sideways while the page scrolls down —
 * spec 2026-09-10 §3.3.
 *
 * THE PAGE'S ONE PIN (§6.4: "Never pin more than one element at a time.
 * Pinning is where scroll sites die."). Only with a fine pointer from 900px,
 * on a tier that animates; everywhere else the same row is a native,
 * snapping, horizontally scrollable strip — which is what a thumb expects.
 *
 * `x` and `end` are functions so they are recomputed on refresh: the row's
 * width changes with the locale, and Arabic runs longer.
 */
export function HorizontalTrack({
  pinRef,
  className = '',
  children,
}: {
  /** The section that is held while the row travels. */
  pinRef: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const { budget, sign } = useSite();

  useGsapScope(
    budget.planes > 0,
    viewportRef,
    ({ gsap }, viewport) => {
      const track = trackRef.current;
      const section = pinRef.current;
      if (track === null || section === null) return undefined;
      if (!window.matchMedia('(min-width: 900px) and (pointer: fine)').matches) return undefined;

      viewport.classList.add('is-pinned');
      const travel = (): number => trackTravel(track.scrollWidth, viewport.clientWidth);

      gsap.to(track, {
        x: () => trackX(travel(), sign),
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: () => `+=${travel()}`,
          scrub: 1,
          pin: true,
          invalidateOnRefresh: true,
        },
        ...promoting(track, 'transform'),
      });

      return () => viewport.classList.remove('is-pinned');
    },
    [budget.planes, sign],
  );

  return (
    <div ref={viewportRef} className={`track-viewport ${className}`.trim()}>
      <div ref={trackRef} className="track">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite S09**

Replace `components/corridor/scenes/S09Doors.tsx` with:

```tsx
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
```

- [ ] **Step 5: Track and S09 CSS**

In `app/corridor.css`, delete the rules `.corridor .doors-title`, `.corridor .doors`, `.corridor .door`, `.corridor .door + .door`, `.corridor .door-body`, `.corridor .door-cta`, `.corridor .door:hover .door-cta, …`, `.corridor .door-arrow`, `.corridor .door:hover .door-arrow, …` and the `@media (min-width: 900px)` block that styles `.doors` / `.door`. Append:

```css
/* ---------------------------------------------------------------------------
 * Horizontal track — the page's one pin. Native swipe row when not pinned.
 * ------------------------------------------------------------------------- */
.corridor .track-viewport {
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x mandatory;
  scrollbar-color: var(--c-line) transparent;
  scrollbar-width: thin;
}

.corridor .track-viewport.is-pinned {
  overflow: clip;
  scroll-snap-type: none;
}

.corridor .track {
  display: flex;
  gap: 0.625rem;
  inline-size: max-content;
  padding-inline: var(--margin);
  padding-block-end: 0.75rem;
}

.corridor .track > * {
  flex: 0 0 auto;
  scroll-snap-align: start;
}

/* ---------------------------------------------------------------------------
 * Scene 09 · doors.
 * ------------------------------------------------------------------------- */
.corridor .doors-track .card {
  inline-size: min(84vw, 28rem);
  min-block-size: 28rem;
}

.corridor .door-body {
  max-inline-size: 36ch;
  margin: 0;
}

@media (min-width: 900px) {
  .corridor .doors-track .card {
    inline-size: 44vw;
    min-block-size: min(36rem, 72vh);
  }
}
```

- [ ] **Step 6: Move the pin comments**

In `lib/site/scroll.ts`, in the comment "AN ANCHOR HAS TO BE RE-AIMED…", change "Scene 02 is pinned (§Scene 02's horizontal scrub, and the only pin on the page)." to "Scene 09 is pinned (its horizontal door track, and the only pin on the page)." and "left the reader looking at Scene 06 — two scenes early" to "left the reader looking at an earlier scene".

In `e2e/corridor.spec.ts`, in the anchor test's comment, change "recomputes the pinned Scene 02 spacer" to "recomputes the pinned Scene 09 spacer".

- [ ] **Step 7: Run**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts`
Expected: PASS on both projects, including both door-track tests and `never scrolls horizontally, in either direction, at any width`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/corridor apps/web/app/corridor.css apps/web/lib/site/scroll.ts apps/web/e2e/corridor.spec.ts
git commit -m "$(cat <<'EOF'
feat(landing): pinned horizontal door track — the page's one pin moves to S09

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 7: S10 as a glass accordion

**Files:**
- Rewrite: `components/corridor/scenes/S10Questions.tsx`
- Modify: `app/corridor.css`

**Interfaces:**
- Consumes: `FAQ_ROWS`, `WordReveal`, `BlurIn`.
- Produces: `#questions .faq > details.faq-item > summary.faq-question + .faq-answer p` (8 items, e2e-asserted).

- [ ] **Step 1: Rewrite S10**

Replace `components/corridor/scenes/S10Questions.tsx` with:

```tsx
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
```

- [ ] **Step 2: FAQ CSS**

In `app/corridor.css`, replace every rule whose selector starts with `.corridor .faq` (`.faq`, `.faq-item`, `.faq-question`, `.faq-question::-webkit-details-marker`, `.faq-index`, `.faq-marker`, `.faq-marker::before, .faq-marker::after`, `.faq-marker::after`, `.faq-item[open] .faq-marker::after`, `.faq-answer`) with:

```css
/* ---------------------------------------------------------------------------
 * Scene 10 · questions — glass accordion on native <details>.
 * ------------------------------------------------------------------------- */
.corridor .faq {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-block-start: clamp(2rem, 5vh, 3rem);
}

.corridor .faq-item {
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  background-color: var(--c-glass-soft);
  backdrop-filter: blur(var(--glass-blur));
  transition: background-color var(--dur-normal) var(--ease-entrance);
}

.corridor .faq-item[open] {
  background-color: var(--c-panel);
}

.corridor .faq-question {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
  cursor: pointer;
  list-style: none;
}

.corridor .faq-question::-webkit-details-marker {
  display: none;
}

.corridor .faq-index {
  flex: 0 0 auto;
}

.corridor .faq-marker {
  position: relative;
  flex: 0 0 auto;
  inline-size: 2.5rem;
  block-size: 2.5rem;
  margin-inline-start: auto;
  border: 1px solid var(--c-line);
  border-radius: 50%;
  transition:
    rotate var(--dur-normal) var(--ease-entrance),
    background-color var(--dur-normal) var(--ease-entrance),
    border-color var(--dur-normal) var(--ease-entrance);
}

.corridor .faq-marker::before,
.corridor .faq-marker::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  inline-size: 0.875rem;
  block-size: 1px;
  background-color: var(--c-ink);
}

.corridor .faq-marker::after {
  rotate: 90deg;
}

.corridor .faq-item[open] .faq-marker {
  rotate: 45deg;
  background-color: var(--c-lime);
  border-color: var(--c-lime-edge);
}

.corridor .faq-answer {
  padding-block-end: 1.5rem;
  padding-inline: calc(1.5rem + 2ch + 1rem) 1.5rem;
}

.corridor .faq-answer p {
  margin: 0;
  line-height: 1.5;
}
```

(The answer paragraphs are the page's longest sustained reading; they get 1.5 leading rather than the 1.2 of short Latin copy.)

- [ ] **Step 3: Run**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts`
Expected: PASS on both projects (the no-JS test still finds 8 `.faq details` with non-empty answers).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/corridor/scenes/S10Questions.tsx apps/web/app/corridor.css
git commit -m "$(cat <<'EOF'
feat(landing): questions as a glass accordion

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 8: The close — helix returns beside a white card

**Files:**
- Create: `components/corridor/primitives/MirMark.tsx`
- Rewrite: `components/corridor/scenes/S11Close.tsx`
- Modify: `app/corridor.css`, `e2e/corridor.spec.ts`

**Interfaces:**
- Consumes: `StackPanel` (Task 3), `HelixCanvas` (Plan 2), `BlurIn`.
- Produces: `<MirMark className? />` → `<svg class="mir-mark">`; CSS `.logo-tile` (teal 42px square, lime mark); `#close .helix` with `entrance="none"`, poster `loading="lazy"`.

- [ ] **Step 1: Write the failing e2e test**

Add inside `test.describe('the helix (spec §5)', …)` in `e2e/corridor.spec.ts`:

```ts
  test('returns at the close, already assembled, and only one helix animates at a time', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Tier A is a desktop tier');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');
    await expect(page.locator('#hero .helix')).toHaveAttribute('data-helix-state', 'running', {
      timeout: 20_000,
    });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const close = page.locator('#close .helix');
    await expect(close).toHaveAttribute('data-helix-state', 'running', { timeout: 20_000 });
    await expect(page.locator('#hero .helix')).toHaveAttribute('data-helix-state', 'paused');
    await expect(page.getByTestId('landing-close-signup')).toBeVisible();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts --project=chromium -g "returns at the close"`
Expected: FAIL — `#close .helix` not found.

- [ ] **Step 3: Write the mark**

Create `components/corridor/primitives/MirMark.tsx`:

```tsx
/**
 * MIR's mark — the reticle this page has always carried: a ring and four
 * ticks, never a full crosshair. Drawn in currentColor, so it sits lime on
 * teal inside `.logo-tile`.
 */
export function MirMark({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={`mir-mark ${className}`.trim()} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </svg>
  );
}
```

- [ ] **Step 4: Rewrite S11**

Replace `components/corridor/scenes/S11Close.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { useSite } from '../../../lib/site/site-provider';
import { HelixCanvas } from '../helix/HelixCanvas';
import { BlurIn } from '../motion/BlurIn';
import { StackPanel } from '../motion/StackPanel';
import { MirMark } from '../primitives/MirMark';

/**
 * Scene 11 — Close. Spec 2026-09-10 §7.2.
 *
 * The helix comes back, already assembled, on the inline-start half of a mint
 * panel; the page's last sentence and its two routes out sit on a white card
 * beside it. Each helix instance animates only while it is on screen, so the
 * hero's has paused by the time this one runs.
 */
export function S11Close(): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const { t, cue } = useSite();

  return (
    <StackPanel id="close" labelledBy="close-title" tone="mint" className="scene--close">
      <div ref={stageRef} className="shell close-stage">
        <HelixCanvas hostRef={stageRef} entrance="none" posterLoading="lazy" className="close-helix" />

        <BlurIn className="close-card">
          <span className="logo-tile" aria-hidden="true">
            <MirMark />
          </span>
          <h2 id="close-title" className="display t-h1 close-line">
            {t.closeLine}
          </h2>
          <div className="close-actions">
            <Link
              href="/signup"
              className="btn btn--primary"
              data-testid="landing-close-signup"
              onPointerDown={() => cue('press')}
            >
              {t.closeCta}
            </Link>
            <Link href="/pricing" className="btn btn--secondary" data-testid="landing-pricing">
              {t.closeSecondary}
            </Link>
          </div>
        </BlurIn>
      </div>
    </StackPanel>
  );
}
```

- [ ] **Step 5: S11 CSS**

In `app/corridor.css`, delete `.corridor .scene--close { … }`, `.corridor .close-plate { … }`, `.corridor .close-line { … }`, `.corridor .close-actions { … }`, `.corridor .btn--invert { … }`, `.corridor .btn--invert:hover { … }`, `.corridor .btn--invert-ghost { … }`, `.corridor .btn--invert-ghost:hover { … }` and `.corridor .close-plate :focus-visible { … }`. Append:

```css
/* ---------------------------------------------------------------------------
 * Logo tile and mark.
 * ------------------------------------------------------------------------- */
.corridor .logo-tile {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  inline-size: 2.625rem;
  block-size: 2.625rem;
  border-radius: var(--r-tile);
  background-color: var(--c-accent);
  color: var(--c-lime);
}

.corridor .mir-mark {
  inline-size: 1.5rem;
  block-size: 1.5rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
}

/* ---------------------------------------------------------------------------
 * Scene 11 · close — the helix returns beside a white card.
 * ------------------------------------------------------------------------- */
.corridor .scene--close {
  padding-block: clamp(4rem, 10vh, 7rem);
}

.corridor .close-stage {
  display: grid;
  gap: 2rem;
  align-items: center;
}

.corridor .close-helix {
  block-size: 40vh;
}

.corridor .close-card {
  padding: clamp(2rem, 4vw, 3rem);
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  background-color: var(--c-glass-strong);
  backdrop-filter: blur(var(--glass-blur));
}

.corridor .close-line {
  margin-block: 1.5rem 2.5rem;
}

.corridor .close-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

@media (min-width: 1000px) {
  .corridor .close-stage {
    grid-template-columns: 1fr 1fr;
    min-block-size: min(46rem, 90vh);
  }

  .corridor .close-helix {
    block-size: 100%;
    min-block-size: 36rem;
  }
}
```

- [ ] **Step 6: Run**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts`
Expected: PASS on both projects.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/corridor apps/web/app/corridor.css apps/web/e2e/corridor.spec.ts
git commit -m "$(cat <<'EOF'
feat(landing): close scene — the helix returns beside a white CTA card

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 9: Floating glass header, footer polish

**Files:**
- Rewrite: `components/corridor/CorridorChrome.tsx`
- Modify: `app/corridor.css`, `e2e/theme.spec.ts` (comment only)

**Interfaces:**
- Consumes: `LocaleControl`, `ThemeControl` (`CorridorControls.tsx`); `ArrowCircle` (Task 1); `MirMark` + `.logo-tile` (Task 8).
- Produces: header DOM `header.chrome[data-detached] > .chrome-inner > (.chrome-brand > a.chrome-mark + nav.chrome-nav > a.chrome-link×4) + .chrome-actions > (.control ×2, a.chrome-link.chrome-signin, a.chrome-cta, button.chrome-toggle)`; `#chrome-menu`. The first `.control` is still the locale switcher (e2e relies on it).

- [ ] **Step 1: Rewrite the header**

Replace `components/corridor/CorridorChrome.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { UiLocale } from '@mir/contracts';
import { useSite } from '../../lib/site/site-provider';
import { LocaleControl, ThemeControl } from './CorridorControls';
import { ArrowCircle } from './primitives/Card';
import { MirMark } from './primitives/MirMark';

/**
 * The landing page's own header — spec 2026-09-10 §7.3.
 *
 * Floating 16px from the top: a white tile with the teal logo square, a glass
 * pill of in-page links, and at the inline-end the language and appearance
 * controls, sign-in, and a teal "register" pill with a lime arrow. The bar
 * itself lets clicks through (`pointer-events: none`); only its pieces catch
 * them, so the hero's helix still answers the cursor between them.
 *
 * The language control stays first among `.control`s and stays a <details>:
 * a reader who cannot read this page is the one who most needs to switch it,
 * before any script has arrived.
 */
export function CorridorChrome({
  hrefFor,
}: {
  hrefFor: (locale: UiLocale) => string;
}): React.JSX.Element {
  const { t } = useSite();
  const [detached, setDetached] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // "Detached" once the hero is mostly off screen: the pieces gain a shadow.
  useEffect(() => {
    const hero = document.getElementById('hero');
    if (hero === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => setDetached(entry?.isIntersecting !== true),
      { threshold: 0.15 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  const links = [
    { href: '#upload', label: t.navDoctors },
    { href: '#consent', label: t.navPatients },
    { href: '#security', label: t.navSecurity },
    { href: '#questions', label: t.navQuestions },
  ];

  return (
    <header className="chrome" data-detached={detached}>
      <div className="chrome-inner">
        <div className="chrome-brand">
          <Link href="/" className="chrome-mark">
            <span className="logo-tile" aria-hidden="true">
              <MirMark />
            </span>
            <span className="chrome-name">MIR</span>
          </Link>
          <nav className="chrome-nav" aria-label={t.navQuestions}>
            {links.map((link) => (
              <a key={link.href} href={link.href} className="chrome-link">
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="chrome-actions">
          <LocaleControl hrefFor={hrefFor} />
          <ThemeControl />
          <Link href="/login" className="chrome-link chrome-signin">
            {t.navSignIn}
          </Link>
          <Link href="/signup" className="chrome-cta">
            <span>{t.heroCtaPrimary}</span>
            <ArrowCircle className="chrome-cta-arrow" />
          </Link>
          <button
            type="button"
            className="chrome-toggle"
            aria-expanded={menuOpen}
            aria-controls="chrome-menu"
            aria-label={menuOpen ? t.menuClose : t.menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="chrome-toggle-bar" aria-hidden="true" />
            <span className="chrome-toggle-bar" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div id="chrome-menu" className="chrome-menu" hidden={!menuOpen}>
        {links.map((link) => (
          <a key={link.href} href={link.href} className="chrome-link" onClick={() => setMenuOpen(false)}>
            {link.label}
          </a>
        ))}
        <Link href="/login" className="chrome-link" onClick={() => setMenuOpen(false)}>
          {t.navSignIn}
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Header and footer CSS**

In `app/corridor.css`, delete every rule whose selector starts with `.corridor .chrome` (including `.chrome-reticle*`, `.chrome-menu .chrome-link`) and the `@media (min-width: 900px)` block that toggles `.chrome-nav` / `.chrome-signin` / `.chrome-toggle` / `.chrome-menu`. Keep the `.control*` rules. Append:

```css
/* ---------------------------------------------------------------------------
 * Header — floating glass pieces (spec §7.3).
 * ------------------------------------------------------------------------- */
.corridor .chrome {
  position: fixed;
  inset-block-start: 1rem;
  inset-inline: 0;
  z-index: 50;
  pointer-events: none;
}

.corridor .chrome-inner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-inline-size: var(--content-max);
  margin-inline: auto;
  padding-inline: var(--margin);
}

.corridor .chrome-brand,
.corridor .chrome-actions,
.corridor .chrome-menu {
  pointer-events: auto;
}

.corridor .chrome-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.corridor .chrome-mark {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  block-size: 3.375rem;
  padding-inline: 0.375rem 1rem;
  border-radius: var(--r-tile);
  background-color: var(--c-ground);
  color: var(--c-ink);
  font-size: 1.25rem;
  font-weight: 300;
  transition: box-shadow var(--dur-normal) var(--ease-entrance);
}

.corridor .chrome-nav {
  display: none;
  align-items: center;
  block-size: 3.375rem;
  padding-inline: 1rem;
  border-radius: var(--r-tile);
  background-color: var(--c-glass);
  backdrop-filter: blur(var(--glass-blur));
  transition: box-shadow var(--dur-normal) var(--ease-entrance);
}

.corridor .chrome-link {
  display: inline-flex;
  align-items: center;
  min-block-size: 2.75rem;
  padding-inline: 0.75rem;
  color: var(--c-ink);
  font-size: 0.9375rem;
  font-weight: 300;
  transition: color var(--dur-fast) var(--ease-entrance);
}

.corridor .chrome-link:hover {
  color: var(--c-accent);
}

.corridor .chrome-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-inline-start: auto;
}

.corridor .chrome-signin {
  display: none;
}

.corridor .control-trigger {
  min-block-size: 3.375rem;
  padding-inline: 1rem;
  border-radius: var(--r-tile);
  background-color: var(--c-glass);
  backdrop-filter: blur(var(--glass-blur));
}

.corridor .chrome-cta {
  display: none;
  align-items: center;
  gap: 0.625rem;
  block-size: 3.375rem;
  padding-inline: 2rem 0.1875rem;
  border: 1px solid var(--c-accent-deep);
  border-radius: var(--r-pill);
  background-color: var(--c-accent);
  color: var(--c-on-accent);
  font-size: var(--t-pill);
  font-weight: 300;
  white-space: nowrap;
}

.corridor .chrome-cta-arrow {
  inline-size: 3rem;
  block-size: 3rem;
  border: 0;
  background-color: var(--c-lime);
  color: var(--c-ink);
}

.corridor .chrome-toggle {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3125rem;
  inline-size: 3.375rem;
  block-size: 3.375rem;
  border: 0;
  border-radius: var(--r-tile);
  background-color: var(--c-glass);
  backdrop-filter: blur(var(--glass-blur));
  cursor: pointer;
}

.corridor .chrome-toggle-bar {
  display: block;
  inline-size: 1.25rem;
  block-size: 1px;
  background-color: var(--c-ink);
}

.corridor .chrome-menu {
  display: flex;
  flex-direction: column;
  margin: 0.5rem var(--margin) 0;
  padding: 0.5rem 1rem 1rem;
  border: 1px solid var(--c-line);
  border-radius: var(--r-card);
  background-color: var(--c-glass-strong);
  backdrop-filter: blur(var(--glass-blur));
}

.corridor .chrome-menu .chrome-link {
  min-block-size: 2.75rem;
  font-size: 1rem;
}

.corridor .chrome[data-detached='true'] :is(.chrome-mark, .chrome-nav) {
  box-shadow: 0 8px 24px -16px rgb(0 0 0 / 0.3);
}

@media (min-width: 900px) {
  .corridor .chrome-nav,
  .corridor .chrome-signin {
    display: inline-flex;
  }

  .corridor .chrome-toggle,
  .corridor .chrome-menu {
    display: none;
  }
}

@media (min-width: 1100px) {
  .corridor .chrome-cta {
    display: inline-flex;
  }
}

/* ---------------------------------------------------------------------------
 * Footer — the same content in the light register.
 * ------------------------------------------------------------------------- */
.corridor .site-footer {
  background-color: var(--c-ground);
}

.corridor .footer-locale,
.corridor .footer-switch {
  font-weight: 300;
}
```

(The `hidden` attribute on `#chrome-menu` still wins over `display: flex`: Tailwind v4's preflight sets `[hidden]:where(:not([hidden='until-found'])) { display: none !important; }`.)

- [ ] **Step 3: Fix the stale theme-test comment**

In `e2e/theme.spec.ts`, replace the comment paragraph that begins "The landing page is a darkened reading room in BOTH themes" with:

```ts
     * The landing page keeps its own light palette in BOTH themes — the
     * theme applies to the signed-in application — but its header carries
     * the appearance control, so the toggle is driven from there and the
     * assertions are on `data-theme` alone.
```
(keep the surrounding `/*` … `*/` and the test body unchanged).

- [ ] **Step 4: Run**

Run: `pnpm --filter @mir/web typecheck && pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts e2e/theme.spec.ts e2e/public-surface.spec.ts`
Expected: PASS on both projects (the language switcher opens with no script; the anchor test clicks `.chrome-link[href="#security"]`; the theme toggle works from the header).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/corridor/CorridorChrome.tsx apps/web/app/corridor.css apps/web/e2e/theme.spec.ts
git commit -m "$(cat <<'EOF'
feat(landing): floating glass header with the MIR tile and a register pill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

### Task 10: Remove the dark-era primitives, finish the docs, visual review

**Files:**
- Delete: `components/corridor/motion/FocalReveal.tsx`, `components/corridor/primitives/Plate.tsx`
- Modify: `app/corridor.css`, `e2e/corridor.spec.ts`, `lib/site/scroll.ts` (comment), `docs/landing-page-status.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the finished page; the reveal guard polls `[data-reveal]` only.

- [ ] **Step 1: Point the reveal guard at the new primitive only**

In `e2e/corridor.spec.ts`, in `'every reveal on the page resolves to full opacity and zero blur'`: change `page.locator('[data-plane], [data-reveal]')` to `page.locator('[data-reveal]')`, and in its comment change "`FocalReveal` animates FROM `autoAlpha: 0` and a blur" to "`BlurIn` animates FROM `opacity: 0` and a blur" and "Each PLANE is scrolled to" to "Each reveal is scrolled to". In the consent test, change the comment "`FocalReveal` animates from `autoAlpha: 0`, and GSAP's autoAlpha sets `visibility: hidden`" to "reveals used to animate from `autoAlpha: 0`, which sets `visibility: hidden`; `BlurIn` uses opacity, but the wait is kept as proof the scene has hydrated".

- [ ] **Step 2: Run the guard to see it still counts enough reveals**

Run: `pnpm --filter @mir/web build && pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts --project=chromium -g "every reveal"`
Expected: PASS — the page now carries ~20 `[data-reveal]` elements (hero 4, S02 3, S03 2, S04 1, S05 2, S06 2, S07 1, S08 2, S10 1, S11 1), comfortably over the `> 15` floor. If it reports fewer than 16, the floor is right and a scene has lost its reveals — find it rather than lowering the number.

- [ ] **Step 3: Delete the old primitives**

```bash
git rm apps/web/components/corridor/motion/FocalReveal.tsx apps/web/components/corridor/primitives/Plate.tsx
grep -rnE "FocalReveal|<Plate|primitives/Plate|data-plane" apps/web/components apps/web/lib apps/web/app apps/web/e2e
```
Expected: no output except historical mentions in comments; rewrite any such comment to name `BlurIn` / `DemoCard`.

In `lib/site/scroll.ts`, change "since `FocalReveal` animates from `autoAlpha: 0`, the scenes it should have revealed are simply not there" to "since `BlurIn` animates from `opacity: 0`, the scenes it should have revealed are simply not there".

In `app/corridor.css`, delete `.corridor .plate { … }`, `.corridor .plate--flush { … }`, `.corridor .plate-label { … }`, `.corridor .plate-counter { … }`, `.corridor .plate-body { … }`, `.corridor [data-plane] { … }`, and `.corridor .viewer-plate { overflow: hidden; }` if still present (the demo card already clips).

- [ ] **Step 4: Full verification**

Run: `pnpm --filter @mir/web lint && pnpm --filter @mir/web typecheck && pnpm --filter @mir/web exec vitest run && pnpm --filter @mir/web build`
Expected: all exit 0.

Run: `pnpm --filter @mir/web exec playwright test e2e/corridor.spec.ts e2e/public-surface.spec.ts e2e/theme.spec.ts`
Expected: PASS on `chromium` and `mobile-chrome`.

- [ ] **Step 5: Visual review against the reference**

With the app running (`pnpm --filter @mir/web start`), save this script **outside the repository** (it is not committed) as `retheme-look.mjs`, and run it from `apps/web` with `node <path>/retheme-look.mjs <output-dir>`:

```js
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('@playwright/test');

const OUT = process.argv[2];
const SCENES = ['hero', 'problem', 'corridor', 'upload', 'consent', 'viewer', 'appointment', 'security', 'doors', 'questions', 'close'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

for (const [width, height] of [[1440, 900], [390, 844]]) {
  for (const locale of ['fr', 'ar']) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://127.0.0.1:3001/${locale}?tier=A`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    for (const id of SCENES) {
      await page.evaluate((sceneId) => {
        const el = document.getElementById(sceneId);
        if (el === null) return;
        el.style.position = 'relative';
        const top = el.getBoundingClientRect().top + window.scrollY;
        el.style.position = '';
        window.scrollTo(0, top);
      }, id);
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `${OUT}/${locale}-${width}-${id}.png` });
    }
    await page.close();
  }
}
await browser.close();
```

Look at every screenshot and check, fixing CSS or `helix-config.ts` values where one fails (re-run the relevant e2e after each fix):
- Hero: mint panel, 48px bottom corners; copy block at ~28% height; rule, trust line + rule, chips (end-aligned), CTAs in the bottom band; helix leaning away from the copy, dusty rather than muddy, deep teal far / lime near.
- Arabic: everything mirrored; no clipped ascenders or descenders in headlines; eyebrow not uppercased.
- Panels: S04–S07 slide over one another with rounded tops; S07's rounded bottom sits on white; S08 is never hidden behind a stuck panel.
- S09: cards ~44vw, the teal lead card first; the row travels and releases.
- S10 glass items, lime marker when open; S11 helix beside the white card.
- 390px: no horizontal scroll, chips wrap, the helix band is full-bleed, the header shows the tile and the menu square.
- By hand at 1440 on `/fr?tier=A`: move the cursor across the helix — particles part around it and settle back within about half a second.

- [ ] **Step 6: Finish the status doc**

In `docs/landing-page-status.md`:
1. §2 tree: `motion/` → `WordReveal, BlurIn, ScrollLitText, StackPanel, HorizontalTrack`; `helix/` → `HelixCanvas, renderer, shaders, geometry, config`; `primitives/` → `Card, DemoCard, MirMark, StatusPill`.
2. Add to the deviations table:

```markdown
| Scene 02 | Three plates scrubbed sideways (the page's one pin) | Three cards, static | The light re-theme gives the one pin to Scene 09's door track instead, where the cards genuinely overflow the viewport; §6.4 still holds — one pin on the page. |
| Scene 09 | Doctors' card with a list of links | The whole card is one link | Links cannot nest; each door keeps its single `data-testid` and destination, and the doctors' topics are its body text. |
| 3.1 | `--c-ink-subtle` 50%, `--c-ink-muted` 40% | 62% and 45% | The spec's own rule (every text pair ≥ 4.5:1) cannot hold at 50%/40%. `--c-ink-muted` is for text ≥ 24px only; `lib/site/tokens.test.ts` asserts both thresholds. |
```
3. §3: re-measure and record — the `/[locale]` route's "First Load JS" from the `pnpm --filter @mir/web build` output table (compare with the previous figure in §3 and state the difference), the two poster sizes, the corridor map size, and the `helix:geometry` duration. Re-run LCP and CLS with the method §3 already documents for the 3 Mbit profile and record both figures. If LCP is ≥ 2.0 s or CLS is above 0, stop and report it rather than committing — that is a spec §10 failure, not a doc update.
4. §4 open items, under "Needs a device or a network": add "Helix GPU frame time at Tier A on integrated graphics (spec §10 target ≤ 2 ms) — SwiftShader in CI proves correctness, not speed." Under "Needs a person": add "Owner's visual sign-off of the light re-theme against the reference captures."

- [ ] **Step 7: Commit**

```bash
git add -A apps/web docs/landing-page-status.md
git commit -m "$(cat <<'EOF'
refactor(landing): remove FocalReveal and Plate; status doc for the light re-theme

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B3Gf7jwE6nzLE5MKh7UWHy
EOF
)"
```

---

## Done when

- Lint, type check, unit tests, build, and the landing e2e specs pass on both Playwright projects.
- The Task 10 visual checklist passes in `fr` and `ar` at 1440×900 and 390×844.
- `grep -rnE "FocalReveal|Plate\b|WindowingWipe|HeadlineReveal|ScrubCanvas|SliceCounter|--c-(void|bone|phosphor)" apps/web/components apps/web/lib apps/web/app` finds nothing but prose.
