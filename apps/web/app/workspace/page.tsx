'use client';

import Link from '../../components/ui/link';
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import type { Case, CaseSide } from '@mir/contracts';
import { casesApi } from '../../lib/api/mock';
import { PROVIDER_ROLES } from '../../lib/corridor/registry';
import { useCurrentProvider } from '../../lib/provider/current-provider';
import { useSession } from '../../lib/session/session';
import { useT } from '../../lib/i18n/provider';
import type { Dictionary } from '../../lib/i18n/dictionary';
import { cn } from '../../lib/utils';
import { capQueue } from '../../lib/dashboard/queue';
import { isStale } from '../../lib/dashboard/time';
import { workspaceModel } from '../../lib/dashboard/workspace-model';
import { RoleGate } from '../../components/RoleGate';
import { caseStatusTone, nextActionKey, nextActionLabel } from '../../components/case/labels';
import { DashboardHeader, QueueRow, QueueSection } from '../../components/dashboard/queue';
import { Alert, Card, Main, Spinner, StatGrid, StatTile, buttonVariants } from '../../components/ui';

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
  const { user } = useSession();
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

  const now = Date.now();
  const { tasks, waiting, stale, answered } = workspaceModel(cases, side, now);
  const shownTasks = capQueue(tasks);
  const shownWaiting = capQueue(waiting);
  const isSource = side === 'source';

  return (
    <Main wide className="space-y-6">
      <DashboardHeader
        greeting={user === null ? t.workspaceTitle : `${t.dashHello} ${user.displayName}`}
        subtitle={t.workspaceDescription}
        action={
          isSource ? (
            <Link href="/cases/new" className={buttonVariants()}>
              {t.casesNew}
            </Link>
          ) : undefined
        }
      >
        <StatGrid>
          <StatTile label={t.dashNeedsYou} value={tasks.length} href="/cases" emphasis testId="tile-needs-you" />
          <StatTile label={t.dashWaitingDoctor} value={waiting.length} testId="tile-waiting" />
          <StatTile label={t.dashStaleTile} value={stale.length} hint={t.dashStale} testId="tile-stale" />
          <StatTile label={t.dashAnswered7d} value={answered.length} testId="tile-answered" />
        </StatGrid>
      </DashboardHeader>

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <QueueSection
            title={t.dashNeedsYou}
            count={tasks.length}
            more={shownTasks.more}
            seeAllHref="/cases"
            empty={t.workspaceTasksEmpty}
            testId="task-list"
            emptyTestId="tasks-empty"
          >
            {shownTasks.shown.map((item) => (
              <QueueRow
                key={item.ref}
                reference={item.ref}
                href={`/cases/${item.ref}`}
                label={side === null ? '—' : nextActionLabel(t, item.status, side)}
                tone={caseStatusTone(item.status)}
                at={item.updatedAt}
                stale={isStale(item, now)}
                dataStatus={item.status}
                action={side === null ? undefined : <TaskAction t={t} item={item} side={side} />}
              />
            ))}
          </QueueSection>

          <QueueSection
            title={t.dashWaitingDoctor}
            count={waiting.length}
            more={shownWaiting.more}
            seeAllHref="/cases"
            empty={t.dashWaitingEmpty}
            testId="waiting-list"
            emptyTestId="waiting-empty"
          >
            {shownWaiting.shown.map((item) => (
              <QueueRow
                key={item.ref}
                reference={item.ref}
                href={`/cases/${item.ref}`}
                label={side === null ? '—' : nextActionLabel(t, item.status, side)}
                tone={caseStatusTone(item.status)}
                at={item.updatedAt}
                stale={isStale(item, now)}
                dataStatus={item.status}
              />
            ))}
          </QueueSection>
        </div>

        <aside className="space-y-5">
          <Card title={t.dashYourClinic}>
            {/* §5.5 P0: the account is an organisation with several users, so
                the seat count is stated rather than implied by whoever is
                logged in. */}
            <p className="flex items-center gap-2 text-sm">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-display text-2xl font-medium tabular-nums" data-testid="seat-count">
                {provider?.seatCount ?? '—'}
              </span>
              <span className="text-muted-foreground">{t.workspaceSeats}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{provider?.legalName ?? ''}</p>
            <Link
              href="/settings/team"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3')}
            >
              {t.settingsTeam}
            </Link>
          </Card>

          {isSource && (
            <Card title={t.dashQuickLinks}>
              <ul className="space-y-1 text-sm">
                {(
                  [
                    ['/cases/new', t.casesNew],
                    ['/upload', t.navUpload],
                    ['/patients', t.navPatients],
                  ] as const
                ).map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="font-medium text-primary hover:underline">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </Main>
  );
}

/** The one button a task row needs, chosen from the same table as its label. */
function TaskAction({ t, item, side }: { t: Dictionary; item: Case; side: CaseSide }): React.JSX.Element {
  const key = nextActionKey(item.status, side);
  const label = key === 'pickDoctor' ? t.dashActionPick : key === 'pay' ? t.dashActionPay : t.dashActionOpen;
  const href = key === 'pickDoctor' ? `/cases/${item.ref}/pick-doctor` : `/cases/${item.ref}`;
  return (
    <Link href={href} className={buttonVariants({ size: 'sm' })} data-testid="task-action">
      {label}
    </Link>
  );
}
