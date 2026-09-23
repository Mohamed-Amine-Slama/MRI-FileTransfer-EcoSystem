'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  summariseLedger,
  type CoordinationFeeEntry,
  type CurrencyCode,
  type DoctorPayoutEntry,
  type LedgerEntry,
  type LedgerSummary,
  type Money,
  type SaasSubscriptionEntry,
} from '@mir/contracts';
import { casesApi } from '../../lib/api/mock';
import { PROVIDER_ROLES } from '../../lib/corridor/registry';
import {
  coordinationFeeCsv,
  doctorPayoutCsv,
  downloadCsv,
  subscriptionCsv,
} from '../../lib/ledger/csv';
import { useCurrentProvider } from '../../lib/provider/current-provider';
import { useDateFormat, useLocale, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { CurrencyTotals } from '../../components/ledger/CurrencyTotals';
import {
  formatMoney,
  paymentStatusLabel,
  paymentStatusTone,
} from '../../components/case/labels';
import {
  Alert,
  Badge,
  Button,
  Card,
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
} from '../../components/ui';

/**
 * The provider ledger — brief §5.7.
 *
 * The screen is two tables, not one with a type column, for the same reason
 * the contract is a union and the export is two files: §5.7 P0 says the two
 * charge kinds must never collapse into one ambiguous "amount owed". Each
 * section carries its own note saying what the charge is for, because a clinic
 * disputing an invoice needs to know which of the two it is looking at before
 * anything else.
 *
 * Totals are per currency and per kind. There is no grand total anywhere on
 * this page — summing USD and EUR would be a lie, and summing a coordination
 * fee with a subscription would be a different one.
 */
export default function LedgerPage(): React.JSX.Element {
  return (
    <RoleGate allow={PROVIDER_ROLES}>
      <LedgerView />
    </RoleGate>
  );
}

function SectionHeading({
  title,
  note,
  totals,
  outstanding,
  locale,
  outstandingLabel,
  onExport,
  exportLabel,
  testId,
}: {
  title: string;
  note: string;
  totals: Partial<Record<CurrencyCode, Money>>;
  outstanding: number;
  locale: string;
  outstandingLabel: string;
  onExport: () => void;
  exportLabel: string;
  testId: string;
}): React.JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-lg font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{note}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <CurrencyTotals totals={totals} locale={locale} />
          {outstanding > 0 && (
            <Badge tone="warning" testId={`${testId}-outstanding`}>
              {outstandingLabel} · {outstanding}
            </Badge>
          )}
        </div>
      </div>
      <Button size="sm" onClick={onExport} data-testid={`${testId}-export`}>
        <Download className="size-4" />
        {exportLabel}
      </Button>
    </div>
  );
}

function LedgerView(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const formatDate = useDateFormat();
  const { providerId, side, loading: providerLoading } = useCurrentProvider();
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providerLoading) return;
    if (providerId === null) {
      setEntries([]);
      return;
    }
    void casesApi
      .listLedger(providerId)
      .then(setEntries)
      .catch(() => {
        setError(t.genericError);
        setEntries([]);
      });
  }, [providerId, providerLoading, t]);

  if (providerLoading || entries === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  // Narrowed once, here, so neither table can accidentally receive the other's
  // rows and neither JSX block needs a per-row type check.
  const fees: CoordinationFeeEntry[] = entries.filter(
    (entry): entry is CoordinationFeeEntry => entry.kind === 'coordination_fee',
  );
  const payouts: DoctorPayoutEntry[] = entries.filter(
    (entry): entry is DoctorPayoutEntry => entry.kind === 'doctor_payout',
  );
  const subscriptions: SaasSubscriptionEntry[] = entries.filter(
    (entry): entry is SaasSubscriptionEntry => entry.kind === 'saas_subscription',
  );
  const summary: LedgerSummary = summariseLedger(entries);

  // The per-case section depends on the side (spec 2026-09-21 §3): a clinic
  // owes the platform a remittance per paid case, while the platform owes a
  // doctor a payout per answered case. Neither side has the other's rows.
  const receiving = side === 'destination';
  const perCase: (CoordinationFeeEntry | DoctorPayoutEntry)[] = receiving ? payouts : fees;

  return (
    <Main wide>
      <PageHeader title={t.ledgerTitle} description={t.ledgerDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {/* Stated in the interface, not just enforced behind it: the provider is
          told why there is no single figure, rather than left to wonder. */}
      <Alert tone="info" testId="ledger-separate-note">
        {t.ledgerSeparateNote}
      </Alert>

      <Card>
        <SectionHeading
          title={receiving ? t.ledgerDoctorPayouts : t.ledgerCoordinationFees}
          note={receiving ? t.ledgerDoctorPayoutsNote : t.ledgerCoordinationFeesNote}
          totals={receiving ? summary.doctorPayouts : summary.coordinationFees}
          outstanding={
            receiving ? summary.outstanding.doctor_payout : summary.outstanding.coordination_fee
          }
          outstandingLabel={t.ledgerOutstanding}
          locale={locale}
          exportLabel={t.ledgerExportCsv}
          onExport={() =>
            receiving
              ? downloadCsv('payouts.csv', doctorPayoutCsv(entries))
              : downloadCsv('coordination-fees.csv', coordinationFeeCsv(entries))
          }
          testId="fees"
        />
        {perCase.length === 0 ? (
          <EmptyState testId="fees-empty">{t.ledgerEmpty}</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colCaseRef}</TableHead>
                <TableHead>{t.colDate}</TableHead>
                <TableHead>{t.colAmount}</TableHead>
                <TableHead>{t.colPaymentStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perCase.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <bdi className="font-mono text-xs font-semibold">{entry.caseRef}</bdi>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(entry.occurredAt)}
                  </TableCell>
                  <TableCell>
                    <bdi className="font-semibold">{formatMoney(locale, entry.amount)}</bdi>
                  </TableCell>
                  <TableCell>
                    <Badge tone={paymentStatusTone(entry.status)}>
                      {paymentStatusLabel(t, entry.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <SectionHeading
          title={t.ledgerSubscriptions}
          note={t.ledgerSubscriptionsNote}
          totals={summary.subscriptions}
          outstanding={summary.outstanding.saas_subscription}
          outstandingLabel={t.ledgerOutstanding}
          locale={locale}
          exportLabel={t.ledgerExportCsv}
          onExport={() => downloadCsv('subscriptions.csv', subscriptionCsv(entries))}
          testId="subs"
        />
        {subscriptions.length === 0 ? (
          <EmptyState testId="subs-empty">{t.ledgerEmpty}</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colPeriod}</TableHead>
                <TableHead>{t.colAmount}</TableHead>
                <TableHead>{t.colPaymentStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-muted-foreground">
                    {formatDate(entry.periodStart)} – {formatDate(entry.periodEnd)}
                  </TableCell>
                  <TableCell>
                    <bdi className="font-semibold">{formatMoney(locale, entry.amount)}</bdi>
                  </TableCell>
                  <TableCell>
                    <Badge tone={paymentStatusTone(entry.status)}>
                      {paymentStatusLabel(t, entry.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Main>
  );
}
