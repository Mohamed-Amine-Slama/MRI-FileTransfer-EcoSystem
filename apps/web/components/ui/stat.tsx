import Link from './link';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { CardContent, CardRoot } from './card';
import { Skeleton } from './skeleton';

/**
 * A count tile.
 *
 * THE NUMERAL WEARS THE TEXT INK, NEVER A STATUS COLOUR. The label carries the
 * meaning, so the tile stays readable to a colour-blind reader and in
 * forced-colors mode — and a screen full of red numbers stops meaning anything
 * the third time someone sees it (§4.1).
 *
 * `value: null` is "still loading", not "zero". They look completely different
 * to someone deciding whether their morning has any work in it, so the tile
 * refuses to render a zero it has not been told.
 */
export function StatTile({
  label,
  value,
  hint,
  href,
  emphasis = false,
  testId,
}: {
  label: string;
  value: number | null;
  hint?: string;
  /** Makes the whole tile a link to the list the number came from. */
  href?: string;
  /**
   * The one tile per dashboard that answers "is there work for me?". It wears
   * the lime highlight; the numeral still wears text ink (rule above).
   */
  emphasis?: boolean;
  testId?: string;
}): React.JSX.Element {
  const labelTone = emphasis ? 'text-highlight-foreground' : 'text-muted-foreground';
  const body = (
    <CardContent className="space-y-1">
      {value === null ? (
        <Skeleton className="h-9 w-16" />
      ) : (
        <p className="font-display text-3xl font-medium leading-none tabular-nums">{value}</p>
      )}
      <p className={cn('text-sm font-medium', labelTone)}>{label}</p>
      {hint !== undefined && <p className={cn('text-xs', labelTone)}>{hint}</p>}
    </CardContent>
  );
  const surface = emphasis ? 'border-highlight-edge bg-highlight text-highlight-foreground' : undefined;

  if (href === undefined) {
    return (
      <CardRoot className={surface} data-testid={testId}>
        {body}
      </CardRoot>
    );
  }

  return (
    <CardRoot
      className={cn('transition-colors hover:border-primary focus-within:border-primary', surface)}
      data-testid={testId}
    >
      <Link href={href} className="block rounded-lg outline-none">
        {body}
      </Link>
    </CardRoot>
  );
}

export function StatGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>;
}

/**
 * A section heading for a band of the dashboard. Quieter than an `h2` from
 * PageHeader, because a dashboard is a set of peers and one of them shouting
 * makes the others look secondary when they are not.
 */
export function SectionHeading({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </h2>
      {actions}
    </div>
  );
}
