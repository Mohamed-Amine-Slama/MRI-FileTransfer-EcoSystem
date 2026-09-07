'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, Users } from 'lucide-react';
import { isTerminalStatus, type Case } from '@mir/contracts';
import { casesApi } from '../../lib/api/mock';
import { PROVIDER_ROLES } from '../../lib/corridor/registry';
import { useCurrentProvider } from '../../lib/provider/current-provider';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { CaseStatusBadge } from '../../components/case/CaseStatusBadge';
import { isAwaitingSide, nextActionLabel } from '../../components/case/labels';
import {
  Alert,
  Card,
  EmptyState,
  Main,
  PageHeader,
  Spinner,
  buttonVariants,
} from '../../components/ui';

/**
 * The practice workspace — brief §5.5.
 *
 * §5.5 P0 asks for "one workspace showing active cases, tasks, and upcoming
 * appointments". The distinction that makes this useful rather than a second
 * case list is TASKS: a case is a task for THIS provider only when the next
 * action for their side is something they must do. That judgement already
 * exists in `nextActionLabel`, keyed by status and side, so the split is
 * derived from the same table both parties' screens read rather than from a
 * second opinion about who owes what.
 */
export default function WorkspacePage(): React.JSX.Element {
  return (
    <RoleGate allow={PROVIDER_ROLES}>
      <Workspace />
    </RoleGate>
  );
}

function Workspace(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { provider, providerId, side, loading } = useCurrentProvider();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (providerId === null) {
      setCases([]);
      return;
    }
    void casesApi
      .listCases({ providerId })
      .then(setCases)
      .catch(() => {
        setError(t.genericError);
        setCases([]);
      });
  }, [providerId, loading, t]);

  if (loading || cases === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const active = cases.filter((item) => !isTerminalStatus(item.status));
  // `isAwaitingSide` reads the same next-action table the case list renders,
  // so a case cannot be a task here and "nothing to do" three clicks away.
  const tasks = side === null ? [] : active.filter((item) => isAwaitingSide(item.status, side));

  return (
    <Main wide>
      <PageHeader
        title={t.workspaceTitle}
        description={t.workspaceDescription}
        actions={
          <Link href="/cases" className={buttonVariants({ variant: 'outline' })}>
            {t.casesTitle}
          </Link>
        }
      />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.workspaceTasks}</h2>
            {tasks.length === 0 ? (
              <EmptyState testId="tasks-empty">{t.workspaceTasksEmpty}</EmptyState>
            ) : (
              <ul className="space-y-2" data-testid="task-list">
                {tasks.map((item) => (
                  <li key={item.ref}>
                    <Link
                      href={`/cases/${item.ref}`}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:border-primary"
                    >
                      <span className="min-w-0">
                        <bdi className="font-mono text-xs font-semibold">{item.ref}</bdi>
                        <span className="mt-0.5 block text-sm">
                          {side === null ? '—' : nextActionLabel(t, item.status, side)}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.workspaceActiveCases}</h2>
            {active.length === 0 ? (
              <EmptyState testId="active-empty">{t.casesEmpty}</EmptyState>
            ) : (
              <ul className="space-y-2" data-testid="active-list">
                {active.map((item) => (
                  <li
                    key={item.ref}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <bdi className="font-mono text-xs font-semibold">{item.ref}</bdi>
                      <CaseStatusBadge status={item.status} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(item.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.workspaceSeats}</h2>
            {/* §5.5 P0: the account is an organisation with several users, so
                the seat count is stated rather than implied by whoever is
                logged in. */}
            <p className="flex items-center gap-2 text-sm">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-2xl font-bold" data-testid="seat-count">
                {provider?.seatCount ?? '—'}
              </span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{provider?.legalName ?? ''}</p>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">{t.navCases}</h2>
            {/* The workspace links into the case list rather than carrying its
                own copy of it: two views of the same rows competing to be the
                real one is how they drift apart. */}
            <Link href="/cases" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t.casesTitle}
            </Link>
          </Card>
        </div>
      </div>
    </Main>
  );
}
