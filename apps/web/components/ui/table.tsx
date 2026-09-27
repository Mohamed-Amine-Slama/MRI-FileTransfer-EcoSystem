import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Data table primitives — the worklist surface of the redesign.
 *
 * The wrapper owns horizontal overflow so a wide table scrolls inside its own
 * bordered container instead of the page. Numbers render tabular so columns
 * of dates and counts align. Headers are `text-start`, never `text-left`,
 * so the table mirrors under RTL (D4).
 */

export function Table({
  className,
  containerClassName,
  ...props
}: HTMLAttributes<HTMLTableElement> & { containerClassName?: string }): React.JSX.Element {
  return (
    <div
      data-slot="table"
      className={cn('w-full overflow-x-auto rounded-lg border bg-card shadow-sm', containerClassName)}
    >
      <table className={cn('w-full caption-bottom text-sm tabular-nums', className)} {...props} />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element {
  return <thead className={cn('bg-muted/60 [&_tr]:border-b', className)} {...props} />;
}

export function TableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>): React.JSX.Element {
  return <tr className={cn('border-b transition-colors hover:bg-muted/40', className)} {...props} />;
}

export function TableHead({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 whitespace-nowrap px-3 text-start align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}
