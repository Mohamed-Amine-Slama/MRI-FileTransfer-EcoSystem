'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Banknote,
  Briefcase,
  Building2,
  CalendarClock,
  FolderKanban,
  Inbox,
  ScrollText,
  Upload,
  Users,
} from 'lucide-react';
import type { Role } from '@mir/contracts';
import { api, type CaseRecord, type AuditEvent } from '../lib/api/endpoints';
import { useT } from '../lib/i18n/provider';
import type { Dictionary } from '../lib/i18n/dictionary';
import { sideForRole } from '../lib/corridor/registry';
import { useSession } from '../lib/session/session';
import { CaseStatusBadge } from '../components/case/CaseStatusBadge';
import { Landing } from '../components/marketing/Landing';
import {
  Card,
  EmptyState,
  PageHeader,
  Main,
  SectionHeading,
  StatGrid,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui';

/**
 * Landing screen — a per-role dashboard.
 *
 * Every number here is computed CLIENT-SIDE from the same list endpoints the
 * worklists read, so a tile can never disagree with the list behind it. The
 * API has no aggregate endpoints, and adding them for a landing page would
 * create a second source of truth for counts an admin will compare.
 *
 * Every fetch fails soft: the quick-action links render regardless, because
 * the dashboard's one non-negotiable job is routing each role to their work.
 */
export default function Home(): React.JSX.Element {
  const t = useT();
  const { status, role } = useSession();

  /*
   * `/` IS TWO PAGES. A visitor gets the landing page; a signed-in user gets
   * their dashboard. AppShell picks the chrome off the same distinction, so the
   * marketing header and the application sidebar never appear together.
   *
   * The loading state renders the landing page rather than a spinner: it is
   * correct for everyone who is not signed in, it is what most arrivals at this
   * URL are, and a spinner on the front door is a worse first impression than a
   * page that is briefly replaced.
   */
  if (status !== 'authenticated') return <Landing />;

  return (
    <Main wide>
      <PageHeader title={t.appName} description={t.appTagline} />

      {status === 'authenticated' && role !== null && (
        <>
          {role === 'libya_doctor' && <LibyaDoctorDashboard />}
          {role === 'tunisia_doctor' && <TunisiaDoctorDashboard />}
          {role === 'admin' && <AdminDashboard />}

          <QuickActions role={role} />
        </>
      )}
    </Main>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function CasesMiniTable({
  cases,
  title,
  nameOf,
}: {
  cases: CaseRecord[];
  title: string;
  nameOf?: (c: CaseRecord) => string;
}): React.JSX.Element {
  const t = useT();
  const recent = cases.slice(0, 5);

  return (
    <Card
      title={title}
      actions={
        <Link href="/cases" className="text-sm font-medium text-primary hover:underline">
          {t.dashboardViewAll}
        </Link>
      }
    >
      {recent.length === 0 ? (
        <EmptyState>{t.casesEmpty}</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colSpecialty}</TableHead>
              {nameOf !== undefined && <TableHead>{t.colPatient}</TableHead>}
              <TableHead>{t.colStatus}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/cases/${c.id}`}
                    className="rounded-sm hover:text-primary hover:underline"
                  >
                    {c.specialty}
                  </Link>
                </TableCell>
                {nameOf !== undefined && (
                  <TableCell className="text-muted-foreground">{nameOf(c)}</TableCell>
                )}
                <TableCell>
                  <CaseStatusBadge status={c.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Role dashboards
// ---------------------------------------------------------------------------

function useCases(): CaseRecord[] | null {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const { cases: rows } = await api.cases.list();
        setCases(rows);
      } catch {
        setCases([]); // Fail soft: tiles show 0, links still work.
      }
    })();
  }, []);
  return cases;
}

function LibyaDoctorDashboard(): React.JSX.Element {
  const t = useT();
  const cases = useCases();
  const [patientCount, setPatientCount] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { patients } = await api.patients.list();
        setPatientCount(patients.length);
      } catch {
        setPatientCount(0);
      }
    })();
  }, []);

  const count = (s: CaseRecord['status']): number | null =>
    cases === null ? null : cases.filter((c) => c.status === s).length;

  return (
    <>
      <StatGrid>
        {/* Each tile links to the list its number came from. A count with no
            way through to the rows behind it is a fact nobody can act on. */}
        <StatTile label={t.statPatients} value={patientCount} href="/patients" />
        <StatTile
          label={t.statCasesTotal}
          value={cases === null ? null : cases.length}
          href="/cases"
        />
        {/* The two states where the ball is in the LAB's court: a case with no
            doctor yet, and a locked quote nobody has paid. */}
        <StatTile label={t.caseStatusSubmitted} value={count('submitted')} href="/cases" />
        <StatTile label={t.caseStatusQuoted} value={count('quoted')} href="/cases" />
      </StatGrid>
      {cases !== null && <CasesMiniTable cases={cases} title={t.dashboardRecent} />}
    </>
  );
}

function TunisiaDoctorDashboard(): React.JSX.Element {
  const t = useT();
  const cases = useCases();

  const count = (s: CaseRecord['status']): number | null =>
    cases === null ? null : cases.filter((c) => c.status === s).length;

  // Awaiting THIS doctor's decision. `paid` is the state that means it: the
  // lab has settled and the case is sitting in front of them unanswered.
  const awaiting = cases === null ? [] : cases.filter((c) => c.status === 'paid');

  return (
    <>
      <StatGrid>
        <StatTile label={t.dashboardAwaitingDecision} value={count('paid')} href="/doctor" />
        {/* Accepted-but-unanswered is the number that costs a doctor money:
            these are the cases with a clock running against them. */}
        <StatTile label={t.caseStatusAccepted} value={count('accepted')} href="/doctor" />
        <StatTile
          label={t.statCasesTotal}
          value={cases === null ? null : cases.length}
          href="/cases"
        />
      </StatGrid>
      {cases !== null && awaiting.length > 0 && (
        <CasesMiniTable
          cases={awaiting}
          title={t.dashboardAwaitingDecision}
          /* The case reference, never the patient — the identity stays on the
             lab's side of the corridor. */
          nameOf={(c) => c.reason ?? c.specialty}
        />
      )}
    </>
  );
}

function AdminDashboard(): React.JSX.Element {
  const t = useT();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { events: rows } = await api.audit.recent();
        setEvents(rows);
      } catch {
        setEvents([]);
      }
    })();
  }, []);

  const count = (outcome: AuditEvent['outcome']): number | null =>
    events === null ? null : events.filter((e) => e.outcome === outcome).length;

  return (
    <StatGrid>
      <StatTile label={t.auditAllowed} value={count('allowed')} href="/admin/audit" />
      <StatTile label={t.auditDenied} value={count('denied')} href="/admin/audit" />
    </StatGrid>
  );
}

// ---------------------------------------------------------------------------
// Quick actions — the routing job. Rendered for every role, even when every
// fetch above failed, and the testids are the ones the e2e suite knows.
// ---------------------------------------------------------------------------

type DestinationKey =
  | 'patients'
  | 'upload'
  | 'inbox'
  | 'availability'
  | 'audit'
  | 'workspace'
  | 'cases'
  | 'ledger'
  | 'adminCases'
  | 'adminProviders'
  | 'adminLedger';

const DESTINATION_ICONS: Record<DestinationKey, typeof Users> = {
  patients: Users,
  upload: Upload,
  inbox: Inbox,
  availability: CalendarClock,
  audit: ScrollText,
  workspace: Briefcase,
  cases: FolderKanban,
  ledger: Banknote,
  adminCases: FolderKanban,
  adminProviders: Building2,
  adminLedger: Banknote,
};

/**
 * The case-layer destinations, chosen by corridor SIDE rather than by role
 * name (§4.3).
 *
 * Kept separate from `destinationsFor` below on purpose: that switch is V0's,
 * it branches on role literals, and it is on the §4.3 debt allowlist. Adding
 * corridor-aware entries to it would deepen the debt rather than work around
 * it. This function names no country and no role, so it stays correct when a
 * second corridor is configured.
 */
function corridorDestinationsFor(role: Role): { key: DestinationKey; href: string }[] {
  const side = sideForRole(role);
  if (side === null) return [];
  if (side === 'ops') {
    return [
      { key: 'adminCases', href: '/admin/cases' },
      { key: 'adminProviders', href: '/admin/providers' },
      { key: 'adminLedger', href: '/admin/ledger' },
    ];
  }
  return [
    { key: 'workspace', href: '/workspace' },
    { key: 'cases', href: '/cases' },
    { key: 'ledger', href: '/ledger' },
  ];
}

function destinationsFor(role: Role): { key: DestinationKey; href: string }[] {
  switch (role) {
    case 'libya_doctor':
      return [
        { key: 'patients', href: '/patients' },
        { key: 'upload', href: '/upload' },
      ];
    case 'tunisia_doctor':
      return [
        { key: 'inbox', href: '/doctor' },
        { key: 'availability', href: '/doctor/availability' },
      ];
    case 'admin':
      return [{ key: 'audit', href: '/admin/audit' }];
    case 'assistant':
      // The calendar this used to point at is gone, and an assistant reaches
      // their work through the case list like everyone else — which
      // `corridorDestinationsFor` already gives them. Nothing else here is
      // theirs: /patients and /upload are the referring side's, and the
      // imaging screens are gated on a consent they do not hold.
      return [];
    case 'applicant':
      // An applicant has no destinations. Their whole screen is the
      // verification status, which the dashboard surfaces directly rather than
      // as one card among several.
      return [];
  }
}

function label(key: DestinationKey, t: Dictionary): string {
  const map: Record<DestinationKey, string> = {
    patients: t.navPatients,
    upload: t.navUpload,
    inbox: t.navInbox,
    availability: t.navAvailability,
    workspace: t.navWorkspace,
    cases: t.navCases,
    ledger: t.navLedger,
    adminCases: t.navAdminCases,
    adminProviders: t.navAdminProviders,
    adminLedger: t.navAdminLedger,
    audit: t.navAudit,
  };
  return map[key];
}

function description(key: DestinationKey, t: Dictionary): string {
  const map: Record<DestinationKey, string> = {
    patients: t.patientsDescription,
    upload: t.uploadHint,
    inbox: t.inboxDescription,
    availability: t.availabilityDescription,
    audit: t.auditDescription,
    workspace: t.workspaceDescription,
    cases: t.casesDescription,
    ledger: t.ledgerDescription,
    adminCases: t.adminCasesDescription,
    adminProviders: t.adminProvidersDescription,
    adminLedger: t.adminLedgerDescription,
  };
  return map[key];
}

function QuickActions({ role }: { role: Role }): React.JSX.Element {
  const t = useT();
  return (
    <section>
      <SectionHeading>{t.dashboardQuickActions}</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-actions">
        {/* Corridor destinations first: a provider's day starts with their
            caseload, not with the patient index. */}
        {[...corridorDestinationsFor(role), ...destinationsFor(role)].map((d) => {
          const Icon = DESTINATION_ICONS[d.key];
          return (
            <Link
              key={d.href}
              href={d.href}
              data-testid={`home-link-${d.key}`}
              className="group flex flex-col gap-1.5 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary"
            >
              <span className="flex items-center gap-2 font-semibold group-hover:text-primary">
                <Icon className="size-4.5 text-primary" aria-hidden="true" />
                {label(d.key, t)}
              </span>
              <span className="text-sm text-muted-foreground">{description(d.key, t)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
