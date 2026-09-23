'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { summariseLedger, type LedgerEntry, type Provider } from '@mir/contracts';
import { casesApi } from '../../../lib/api/mock';
import { rolesForSides } from '../../../lib/corridor/registry';
import {
  coordinationFeeCsv,
  doctorPayoutCsv,
  downloadCsv,
  subscriptionCsv,
} from '../../../lib/ledger/csv';
import { useLocale, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import { CurrencyTotals } from '../../../components/ledger/CurrencyTotals';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Main,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui';

/**
 * Ledger oversight — brief §5.8.
 *
 * One row per provider account, and the two charge kinds stay in SEPARATE
 * COLUMNS. The temptation on an ops screen is a single "balance" column that
 * sorts, because that is what makes a table feel like a finance tool; §5.7 P0
 * forbids exactly that, and a merged figure here would be worse than on a
 * provider's own ledger, since ops is where invoicing decisions get made.
 *
 * Totals are also never summed across currencies — `CurrencyTotals` renders
 * each currency as its own figure, shared with the provider-facing ledger so
 * the two screens cannot drift.
 */
const OPS_ROLES = rolesForSides(['ops']);

export default function AdminLedgerPage(): React.JSX.Element {
  return (
    <RoleGate allow={OPS_ROLES}>
      <AdminLedger />
    </RoleGate>
  );
}

interface Row {
  provider: Provider | null;
  providerId: string;
  entries: LedgerEntry[];
}

function AdminLedger(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [ledgers, providers] = await Promise.all([
          casesApi.listAllLedger(),
          casesApi.listProviders(),
        ]);
        if (cancelled) return;
        setRows(
          ledgers.map(({ providerId, entries }) => ({
            providerId,
            entries,
            provider: providers.find((p) => p.id === providerId) ?? null,
          })),
        );
      } catch {
        if (cancelled) return;
        setError(t.genericError);
        setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (rows === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  // The export is still two files, for the same reason it is on the provider
  // ledger: there is no schema in which the two kinds share a row.
  const all = rows.flatMap((row) => row.entries);

  return (
    <Main wide>
      <PageHeader
        title={t.adminLedgerTitle}
        description={t.adminLedgerDescription}
        actions={
          <>
            <Button
              size="sm"
              data-testid="export-fees"
              onClick={() => downloadCsv('coordination-fees-all.csv', coordinationFeeCsv(all))}
            >
              <Download className="size-4" />
              {t.ledgerCoordinationFees}
            </Button>
            <Button
              size="sm"
              data-testid="export-payouts"
              onClick={() => downloadCsv('payouts-all.csv', doctorPayoutCsv(all))}
            >
              <Download className="size-4" />
              {t.ledgerDoctorPayouts}
            </Button>
            <Button
              size="sm"
              data-testid="export-subs"
              onClick={() => downloadCsv('subscriptions-all.csv', subscriptionCsv(all))}
            >
              <Download className="size-4" />
              {t.ledgerSubscriptions}
            </Button>
          </>
        }
      />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <Alert tone="info" testId="admin-ledger-separate-note">
        {t.ledgerSeparateNote}
      </Alert>

      {rows.length === 0 ? (
        <EmptyState testId="admin-ledger-empty">{t.ledgerEmpty}</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colProvider}</TableHead>
              <TableHead>{t.ledgerCoordinationFees}</TableHead>
              <TableHead>{t.ledgerDoctorPayouts}</TableHead>
              <TableHead>{t.ledgerSubscriptions}</TableHead>
              <TableHead>{t.ledgerOutstanding}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const summary = summariseLedger(row.entries);
              const outstanding =
                summary.outstanding.coordination_fee +
                summary.outstanding.saas_subscription +
                summary.outstanding.doctor_payout;
              return (
                <TableRow key={row.providerId}>
                  <TableCell className="font-medium">
                    {row.provider?.legalName ?? row.providerId}
                  </TableCell>
                  <TableCell>
                    <CurrencyTotals totals={summary.coordinationFees} locale={locale} />
                  </TableCell>
                  <TableCell>
                    <CurrencyTotals totals={summary.doctorPayouts} locale={locale} />
                  </TableCell>
                  <TableCell>
                    <CurrencyTotals totals={summary.subscriptions} locale={locale} />
                  </TableCell>
                  <TableCell>
                    {/* A COUNT of unpaid entries, never a summed amount: the
                        two kinds and several currencies have no common total,
                        but "three things are unpaid" is unambiguous. */}
                    {outstanding === 0 ? (
                      <span className="text-muted-foreground">{t.none}</span>
                    ) : (
                      <Badge tone="warning">{outstanding}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Main>
  );
}
