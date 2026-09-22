import Link from 'next/link';
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
  testId,
}: {
  label: string;
  value: number | null;
  hint?: string;
  /** Makes the whole tile a link to the list the number came from. */
  href?: string;
  testId?: string;
}): React.JSX.Element {
  const body = (
    <CardContent className="space-y-1">
      {value === null ? (
        <Skeleton className="h-9 w-16" />
      ) : (
        <p className="font-display text-3xl font-medium leading-none tabular-nums">{value}</p>
      )}
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
    </CardContent>
  );

  if (href === undefined) {
    return (
      <CardRoot data-testid={testId}>{body}</CardRoot>
    );
  }

  return (
    <CardRoot
      className="transition-colors hover:border-primary focus-within:border-primary"
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
