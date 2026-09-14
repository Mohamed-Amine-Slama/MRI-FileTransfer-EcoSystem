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
