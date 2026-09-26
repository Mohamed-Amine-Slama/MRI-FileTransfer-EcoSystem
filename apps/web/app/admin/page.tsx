'use client';

import Link from '../../components/ui/link';
import { useEffect, useState } from 'react';
import { isTerminalStatus, type Case, type Provider } from '@mir/contracts';
import { casesApi } from '../../lib/api/mock';
import { rolesForSides } from '../../lib/corridor/registry';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { capQueue } from '../../lib/dashboard/queue';
import { isSameLocalDay, isStale } from '../../lib/dashboard/time';
import { RoleGate } from '../../components/RoleGate';
import { caseStatusLabel, caseStatusTone, providerKindLabel } from '../../components/case/labels';
import { DashboardHeader, QueueRow, QueueSection } from '../../components/dashboard/queue';
import { Alert, Card, Main, Spinner, StatGrid, StatTile, buttonVariants } from '../../components/ui';

const OPS_ROLES = rolesForSides(['ops']);

/**
 * The platform team's home (spec 2026-09-25 §5.3).
 *
 * Ops has no per-case action in the consult model, so "needs you" here is the
 * verification queue — an applicant cannot work until someone decides — and
 * the cases nobody has moved in two days, which is where a corridor silently
 * fails. Everything else is one link away.
 */
export default function AdminHomePage(): React.JSX.Element {
  return (
    <RoleGate allow={OPS_ROLES}>
      <AdminHome />
    </RoleGate>
  );
}

function AdminHome(): React.JSX.Element {
  const t = useT();
  const { user, role } = useSession();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [queue, setQueue] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([casesApi.listAllCases(), casesApi.listVerificationQueue()])
      .then(([all, pending]) => {
        setCases(all);
        setQueue(pending);
      })
      .catch(() => {
        setError(t.genericError);
        setCases([]);
        setQueue([]);
      });
  }, [t]);

  if (cases === null || queue === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const now = Date.now();
  const active = cases.filter((c) => !isTerminalStatus(c.status));
  const stale = active
    .filter((c) => isStale(c, now))
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  const openedToday = cases.filter((c) => isSameLocalDay(c.createdAt, now));
  const pending = [...queue].sort(
    (a, b) => Date.parse(a.verification.submittedAt) - Date.parse(b.verification.submittedAt),
  );
  const shownPending = capQueue(pending);
  const shownStale = capQueue(stale);

  return (
    <Main wide className="space-y-6">
      <DashboardHeader
        greeting={user === null ? t.navAdminHome : `${t.dashHello} ${user.displayName}`}
        subtitle={t.adminHomeDescription}
      >
        <StatGrid>
          <StatTile
            label={t.dashVerificationsPending}
            value={pending.length}
            href="/admin/providers"
            emphasis
            testId="tile-verifications"
          />
          <StatTile label={t.dashStaleCases} value={stale.length} hint={t.dashStale} testId="tile-stale" />
          <StatTile label={t.dashOpenedToday} value={openedToday.length} testId="tile-today" />
          <StatTile label={t.dashActive} value={active.length} href="/admin/cases" testId="tile-active" />
        </StatGrid>
      </DashboardHeader>

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <QueueSection
            title={t.adminQueueTitle}
            count={pending.length}
            more={shownPending.more}
            seeAllHref="/admin/providers"
            empty={t.dashNoPending}
            testId="verification-queue"
            emptyTestId="verification-queue-empty"
          >
            {shownPending.shown.map((p) => (
              <QueueRow
                key={p.id}
                reference={p.legalName}
                mono={false}
                href="/admin/providers"
                label={providerKindLabel(t, p.kind)}
                tone="warning"
                at={p.verification.submittedAt}
                action={
                  <Link href="/admin/providers" className={buttonVariants({ size: 'sm' })}>
                    {t.dashActionReview}
                  </Link>
                }
              />
            ))}
          </QueueSection>

          <QueueSection
            title={t.dashStaleCases}
            count={stale.length}
            more={shownStale.more}
            seeAllHref="/admin/cases"
            empty={t.dashNoStale}
            testId="stale-list"
            emptyTestId="stale-empty"
          >
            {shownStale.shown.map((c) => (
              <QueueRow
                key={c.ref}
                reference={c.ref}
                href={`/cases/${c.ref}`}
                label={caseStatusLabel(t, c.status)}
                tone={caseStatusTone(c.status)}
                at={c.updatedAt}
                stale
                dataStatus={c.status}
              />
            ))}
          </QueueSection>
        </div>

        <aside>
          <Card title={t.dashQuickLinks}>
            <ul className="space-y-1 text-sm">
              <li>
                <Link href="/admin/cases" className="font-medium text-primary hover:underline">
                  {t.navAdminCases}
                </Link>
              </li>
              <li>
                <Link href="/admin/ledger" className="font-medium text-primary hover:underline">
                  {t.navAdminLedger}
                </Link>
              </li>
              {/* Same gate as the nav: the audit log is admin-only. */}
              {role === 'admin' && (
                <li>
                  <Link href="/admin/audit" className="font-medium text-primary hover:underline">
                    {t.navAudit}
                  </Link>
                </li>
              )}
            </ul>
          </Card>
        </aside>
      </div>
    </Main>
  );
}
