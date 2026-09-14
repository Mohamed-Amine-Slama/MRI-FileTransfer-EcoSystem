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
