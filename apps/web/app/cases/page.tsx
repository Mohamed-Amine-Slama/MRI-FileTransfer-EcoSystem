'use client';

import Link from '../../components/ui/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FilePlus2 } from 'lucide-react';
import { CASE_STATUSES, type Case, type CaseStatus } from '@mir/contracts';
import { casesApi } from '../../lib/api/mock';
import { pageOf } from '../../lib/dashboard/pagination';
import { PROVIDER_ROLES } from '../../lib/corridor/registry';
import { useCurrentProvider } from '../../lib/provider/current-provider';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { Pager } from '../../components/ui/pager';
import { CaseStatusBadge } from '../../components/case/CaseStatusBadge';
import { caseStatusLabel, nextActionLabel } from '../../components/case/labels';
import {
  Alert,
  EmptyState,
  Field,
  Input,
  Main,
  PageHeader,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from '../../components/ui';

/**
 * The provider case list — brief §5.3.
 *
 * Every row states the status AND what is expected of the viewer next, because
 * §5.3 P1 asks for exactly that and because a status alone leaves a clinic
 * guessing whether the ball is in their court. The next-action text is derived
 * from the viewer's corridor side, so the two parties are told different — and
 * correct — things about the same case.
 *
 * Filtering is server-side in shape (the query goes to the API) even though the
 * current implementation filters fixtures, so the screen does not have to
 * change when the real endpoint arrives.
 */
export default function CasesPage(): React.JSX.Element {
  return (
    <RoleGate allow={PROVIDER_ROLES}>
      <CasesList />
    </RoleGate>
  );
}

function CasesList(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat({ short: true });
  const { providerId, side, loading: providerLoading } = useCurrentProvider();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // An inverted range returns nothing, which reads as "no cases" rather than
  // as a typo. Saying so is the difference between the clinic fixing the
  // filter and the clinic phoning us about missing cases.
  const invalidRange = from !== '' && to !== '' && from > to;

  const load = useCallback(async () => {
    // No organisation yet means no cases, not "still loading".
    if (providerId === null) {
      setCases([]);
      return;
    }
    setError(null);
    try {
      setCases(
        await casesApi.listCases({
          providerId,
          ...(status === '' ? {} : { status }),
          ...(search.trim() === '' ? {} : { search: search.trim() }),
          ...(from === '' ? {} : { updatedFrom: from }),
          ...(to === '' ? {} : { updatedTo: to }),
        }),
      );
    } catch {
      setError(t.genericError);
      setCases([]);
    }
  }, [providerId, status, search, from, to, t]);

  // A new filter is a new list: start it from its first page.
  useEffect(() => {
    setPage(1);
    void load();
  }, [load]);

  if (providerLoading || cases === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const paged = pageOf(cases, page);
  const filtered = search.trim() !== '' || status !== '' || from !== '' || to !== '';

  return (
    <Main wide>
      <PageHeader
        title={`${t.casesTitle} · ${cases.length}`}
        description={t.casesDescription}
        actions={
          <Link href="/cases/new" className={buttonVariants()}>
            <FilePlus2 className="size-4" />
            {t.casesNew}
          </Link>
        }
      />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {invalidRange && (
        <Alert tone="warning" testId="invalid-range">
          {t.casesFilterInvalidRange}
        </Alert>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t.casesFilterStatus}>
          <Select
            value={status}
            data-testid="filter-status"
            onChange={(e) => setStatus(e.target.value as CaseStatus | '')}
          >
            <option value="">{t.filterAll}</option>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {caseStatusLabel(t, s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.casesSearchRef}>
          <Input
            value={search}
            data-testid="search-ref"
            placeholder="MIR-2026-0417"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        {/* §5.3 P1 completes the filter set: status, date, reference. Dates are
            native inputs so the clinic gets their own locale's date picker. */}
        <Field label={t.casesFilterFrom}>
          <Input
            type="date"
            value={from}
            data-testid="filter-from"
            invalid={invalidRange}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={t.casesFilterTo}>
          <Input
            type="date"
            value={to}
            data-testid="filter-to"
            invalid={invalidRange}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>

      {cases.length === 0 ? (
        <EmptyState testId="cases-empty">{filtered ? t.casesNoMatch : t.casesEmpty}</EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colStatus}</TableHead>
                <TableHead>{t.colCaseRef}</TableHead>
                <TableHead>{t.colNextAction}</TableHead>
                <TableHead>{t.colUpdated}</TableHead>
                <TableHead>{t.colActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((item) => (
                <TableRow key={item.ref}>
                  <TableCell>
                    <CaseStatusBadge status={item.status} />
                  </TableCell>
                  {/* Latin-script reference inside possibly-RTL text: isolate it
                      so the surrounding direction cannot reorder the digits. */}
                  <TableCell>
                    <bdi className="font-mono text-xs font-semibold">{item.ref}</bdi>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {side === null ? '—' : nextActionLabel(t, item.status, side)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(item.updatedAt)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/cases/${item.ref}`}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                    >
                      {t.viewDetails}
                      <ChevronRight className="size-4 rtl:rotate-180" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            page={paged.page}
            pages={paged.pages}
            from={paged.from}
            to={paged.to}
            total={cases.length}
            onPage={setPage}
          />
        </>
      )}
    </Main>
  );
}
