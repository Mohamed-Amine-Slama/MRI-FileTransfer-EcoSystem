import type { ReactNode } from 'react';

/**
 * The plate — Landing-Page-Specs §3.3.
 *
 * The page's one structural device, and the reason it does not look like every
 * other dark SaaS page. It is NOT a card: a 1px hairline frame with corner
 * ticks, a mono label in the top-inline-start corner, a counter in the
 * bottom-inline-end one, and a 2px radius.
 *
 *   ┌─ CT · AX · 512×512 ───────────────┐
 *   │                                   │
 *   │         [ content ]               │
 *   │                                   │
 *   └──────────────────────── 24 / 180 ─┘
 *
 * It reads as a lightbox frame and a DICOM viewport at once, which is exactly
 * the double meaning the page is built on. Everything that would otherwise
 * have become a rounded card becomes one of these — §3.3 means that
 * literally, and the moment a `rounded-xl` shadow appears anywhere on this
 * page the design has reverted to the template it was written to avoid.
 *
 * The label and counter are positioned with logical insets and sit ON the
 * frame line, punched out with the page background. Under RTL they swap ends
 * with no extra code, because `inset-inline-start` is what "start" means.
 */
export function Plate({
  label,
  counter,
  flush = false,
  padded = true,
  className = '',
  bodyClassName = '',
  children,
}: {
  /** Mono label on the top edge — the DICOM series description. */
  label?: string;
  /** Mono counter on the bottom edge — the slice index. */
  counter?: string;
  /** Transparent rather than surface-filled, for plates over the canvas. */
  flush?: boolean;
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}): React.JSX.Element {
  const classes = ['plate'];
  if (flush) classes.push('plate--flush');
  if (className !== '') classes.push(className);

  return (
    <div className={classes.join(' ')}>
      {/*
        `aria-hidden` on both: they are frame furniture. The label repeats the
        modality that the surrounding copy already states, and the counter is a
        scroll position — announcing either would interrupt a screen-reader
        user mid-sentence to tell them about a decoration.
      */}
      {label !== undefined && (
        <span className="plate-label" aria-hidden="true">
          {label}
        </span>
      )}

      <div className={`${padded ? 'plate-body' : ''} ${bodyClassName}`.trim()}>{children}</div>

      {counter !== undefined && (
        <span className="plate-counter" aria-hidden="true">
          {counter}
        </span>
      )}
    </div>
  );
}
