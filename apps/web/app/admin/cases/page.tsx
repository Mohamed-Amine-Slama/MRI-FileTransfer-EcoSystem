'use client';

import Link from '../../../components/ui/link';
import { useCallback, useEffect, useState } from 'react';
import {
  CASE_STATUSES,
  caseStatusSchema,
  nextStatuses,
  type Case,
  type CaseStatus,
} from '@mir/contracts';
import { casesApi } from '../../../lib/api/mock';
import { rolesForSides } from '../../../lib/corridor/registry';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { useSession } from '../../../lib/session/session';
import { RoleGate } from '../../../components/RoleGate';
import { CaseStatusBadge } from '../../../components/case/CaseStatusBadge';
import { caseStatusLabel } from '../../../components/case/labels';
import {
  Alert,
  Button,
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
} from '../../../components/ui';

/**
 * The ops case pipeline — brief §5.8.
 *
 * MANUAL STATUS OVERRIDE IS BOUNDED, NOT FREE. §5.8 P1 asks for the ability to
 * intervene; it does not ask for a tool that can set any status from any other.
 * The dropdown offers only `nextStatuses(current)` — the same transition table
 * the provider views read — so ops cannot move a completed case back to
 * in_progress and silently invalidate the coordination fee that completion
 * raised (§5.7). A case with nowhere legal to go says so instead of offering a
 * disabled control with no explanation.
 *
 * Every override writes a case event carrying the actor, because §4.4 requires
 * audit-relevant actions be surfaced — including to the two clinics, who see
 * it appear on the case timeline.
 */
const OPS_ROLES = rolesForSides(['ops']);

export default function AdminCasesPage(): React.JSX.Element {
  return (
    <RoleGate allow={OPS_ROLES}>
      <AdminCases />
    </RoleGate>
  );
}

function AdminCases(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { user } = useSession();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [filter, setFilter] = useState<CaseStatus | ''>('');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Record<string, CaseStatus>>({});
  // Forcing a status needs a backend verb that does not exist yet (spec
  // 2026-09-21 D7); the live case layer says so and the column is hidden.
  const canOverride = casesApi.supports.statusOverride;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCases(await casesApi.listAllCases(filter === '' ? undefined : filter));
    } catch {
      setError(t.genericError);
      setCases([]);
    }
  }, [filter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const override = async (item: Case): Promise<void> => {
    const to = pending[item.ref];
    if (to === undefined) return;
    setBusy(item.ref);
    setError(null);
    try {
      await casesApi.changeCaseStatus(item.ref, to, user?.displayName ?? 'Platform ops');
      setNotice(t.adminOverrideDone);
      setPending((prev) => {
        const { [item.ref]: _removed, ...rest } = prev;
        return rest;
      });
      await load();
    } catch {
      // The mock refuses an illegal transition rather than coercing it, and so
      // will the API. Surfacing the refusal is the correct behaviour.
      setError(t.genericError);
    } finally {
      setBusy(null);
    }
  };

  if (cases === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const needle = search.trim().toLowerCase();
  const visible = needle === '' ? cases : cases.filter((c) => c.ref.toLowerCase().includes(needle));

  return (
    <Main wide>
      <PageHeader title={t.adminCasesTitle} description={t.adminCasesDescription} />

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Field label={t.casesFilterStatus}>
          <Select
            value={filter}
            data-testid="admin-filter-status"
            onChange={(e) => {
              const value = e.target.value;
              if (value === '') {
                setFilter('');
                return;
              }
              const parsed = caseStatusSchema.safeParse(value);
              if (parsed.success) setFilter(parsed.data);
            }}
          >
            <option value="">{t.filterAll}</option>
            {CASE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {caseStatusLabel(t, status)}
              </option>
            ))}
          </Select>
        </Field>
        {/* §5.8 P1: ops search the pipeline the same way a provider searches
            their own list — by the reference a clinic read out over the
            phone. Filtered here rather than server-side because listAllCases
            has no search parameter; the shape is the same either way. */}
        <Field label={t.casesSearchRef}>
          <Input
            value={search}
            data-testid="admin-search-ref"
            placeholder="MIR-2026-0417"
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
      </div>

      {visible.length === 0 ? (
        <EmptyState testId="admin-cases-empty">
          {needle === '' && filter === '' ? t.casesEmpty : t.casesNoMatch}
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colCaseRef}</TableHead>
              <TableHead>{t.colStatus}</TableHead>
              <TableHead>{t.colUpdated}</TableHead>
              {canOverride && <TableHead>{t.adminOverrideTo}</TableHead>}
              {canOverride && <TableHead>{t.colActions}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item) => {
              const options = nextStatuses(item.status);
              const chosen = pending[item.ref] ?? '';
              return (
                <TableRow key={item.ref}>
                  <TableCell>
                    <Link href={`/cases/${item.ref}`} className="hover:underline">
                      <bdi className="font-mono text-xs font-semibold">{item.ref}</bdi>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CaseStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(item.updatedAt)}
                  </TableCell>
                  {canOverride && (
                    <>
                  <TableCell>
                    {options.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{t.adminNoTransitions}</span>
                    ) : (
                      <Select
                        value={chosen}
                        aria-label={t.adminOverrideTo}
                        data-testid={`override-select-${item.ref}`}
                        className="h-9"
                        onChange={(e) => {
                          const parsed = caseStatusSchema.safeParse(e.target.value);
                          if (!parsed.success) return;
                          setPending((prev) => ({ ...prev, [item.ref]: parsed.data }));
                        }}
                      >
                        <option value="">{t.none}</option>
                        {options.map((status) => (
                          <option key={status} value={status}>
                            {caseStatusLabel(t, status)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      disabled={chosen === '' || busy === item.ref}
                      data-testid={`override-apply-${item.ref}`}
                      onClick={() => void override(item)}
                    >
                      {t.adminOverride}
                    </Button>
                  </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Main>
  );
}
