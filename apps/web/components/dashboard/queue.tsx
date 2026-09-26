'use client';

import Link from '../ui/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useRelativeAge, useT } from '../../lib/i18n/provider';
import { cn } from '../../lib/utils';
import { EmptyState, SectionHeading, type Tone } from '../ui';

/**
 * The three pieces every role's home screen is built from (spec 2026-09-25 §4.3).
 *
 * A dashboard answers one question — "what needs me?" — so it is a band of
 * counts and then short queues ordered by who owes the next move, each row
 * carrying the one action it needs. The full list stays one click away.
 */

export function DashboardHeader({
  greeting,
  subtitle,
  action,
  children,
}: {
  greeting: string;
  subtitle?: string;
  action?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="space-y-5 rounded-lg bg-secondary px-4 py-5 text-secondary-foreground sm:px-6"
      data-testid="dashboard-header"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl font-normal tracking-tight">{greeting}</h1>
          {subtitle !== undefined && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function QueueSection({
  title,
  count,
  seeAllHref,
  more = false,
  empty,
  testId,
  emptyTestId,
  children,
}: {
  title: string;
  /** The full size of the queue, not the number of rows shown. */
  count: number;
  seeAllHref?: string;
  /** True when rows were cut at the cap — only then does "see all" appear. */
  more?: boolean;
  empty: string;
  testId?: string;
  emptyTestId?: string;
  children: ReactNode;
}): React.JSX.Element {
  const t = useT();
  const seeAll =
    seeAllHref !== undefined && more ? (
      <Link
        href={seeAllHref}
        className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        data-testid={testId === undefined ? undefined : `${testId}-see-all`}
      >
        {t.dashSeeAll}
        <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
      </Link>
    ) : undefined;

  return (
    <section className="space-y-3" aria-label={title}>
      <SectionHeading actions={seeAll}>
        {title}
        <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      </SectionHeading>
      {count === 0 ? (
        <EmptyState testId={emptyTestId}>{empty}</EmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" data-testid={testId}>
          {children}
        </ul>
      )}
    </section>
  );
}

const RAIL: Record<Tone | 'neutral', string> = {
  info: 'border-s-info',
  warning: 'border-s-warning',
  danger: 'border-s-danger',
  success: 'border-s-success',
  neutral: 'border-s-border',
};

export function QueueRow({
  reference,
  mono = true,
  href,
  label,
  secondary,
  tone,
  at,
  stale = false,
  action,
  testId,
  dataStatus,
}: {
  /** A case reference (mono) or an organisation name (`mono={false}`). */
  reference: string;
  mono?: boolean;
  href: string;
  label: string;
  secondary?: string;
  /** Leading rail colour; the same tone the status badge uses. */
  tone?: Tone;
  /** ISO instant the row's age is measured from. */
  at: string;
  stale?: boolean;
  action?: ReactNode;
  testId?: string;
  dataStatus?: string;
}): React.JSX.Element {
  const t = useT();
  const age = useRelativeAge();

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-s-[3px] px-4 py-3',
        RAIL[tone ?? 'neutral'],
      )}
      data-testid={testId}
      data-status={dataStatus}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* The reference is the link, not the whole row: the row may also hold
              a button, and interactive content cannot nest. */}
          <Link
            href={href}
            className={cn(
              'rounded-sm hover:text-primary hover:underline',
              mono ? 'font-mono text-xs font-semibold' : 'text-sm font-semibold',
            )}
          >
            <bdi>{reference}</bdi>
          </Link>
          <span className="text-sm">{label}</span>
        </div>
        {secondary !== undefined && (
          // Wraps rather than truncates: for a doctor this line is the referral
          // reason they accept on, and a cut sentence is information lost.
          <p className="mt-0.5 text-xs text-muted-foreground">{secondary}</p>
        )}
      </div>
      <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
        {stale && (
          <>
            <span className="size-2 rounded-full bg-warning" title={t.dashStale} aria-hidden="true" />
            <span className="sr-only">{t.dashStale}</span>
          </>
        )}
        <time dateTime={at}>{age(at)}</time>
      </span>
      {action !== undefined && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </li>
  );
}
