'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, type CaseRecord, type DirectoryEntry } from '../../../../lib/api/endpoints';
import { useDateFormat, useLocale, useT } from '../../../../lib/i18n/provider';
import { SOURCE_ROLES } from '../../../../lib/corridor/registry';
import { RoleGate } from '../../../../components/RoleGate';
import { formatMoney } from '../../../../components/case/labels';
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
} from '../../../../components/ui';

/**
 * Choosing a doctor — the screen that replaced booking a slot.
 *
 * TWO FACTS A LAB CANNOT INFER, and both are on this page:
 *
 *   1. The price is HELD until it expires. What the directory shows is
 *      indicative — surge moves with how many doctors are on — and what the
 *      confirmation shows is locked. Showing one number and charging another
 *      is a dispute the platform loses, so the screen is explicit about which
 *      is which.
 *   2. A decline costs nothing. A lab that thinks a refusal burns their payment
 *      will hesitate over the choice, and hesitating is the wrong response —
 *      picking again is free and immediate.
 *
 * A CLOSED SPECIALTY IS NOT AN EMPTY TABLE. When the API answers 409 the screen
 * says nobody is accepting this specialty right now. An empty list with no
 * explanation reads as a broken page, and the lab's next move — try later, or
 * try another specialty — depends on knowing which it is.
 */
export default function PickDoctorPage(): React.JSX.Element {
  return (
    <RoleGate allow={SOURCE_ROLES}>
      <PickDoctor />
    </RoleGate>
  );
}

/** 409 from the API: the specialty is closed, or that doctor just switched off. */
function isConflict(err: unknown): boolean {
  return (err as { status?: number }).status === 409;
}

function PickDoctor(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const formatDate = useDateFormat();
  const router = useRouter();
  const params = useParams<{ ref: string }>();
  const caseId = params.ref;

  const [item, setItem] = useState<CaseRecord | null>(null);
  const [doctors, setDoctors] = useState<DirectoryEntry[] | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const record = await api.cases.get(caseId);
      setItem(record);
      try {
        const { doctors: rows } = await api.cases.directory(record.specialty);
        setDoctors(rows);
        setClosed(rows.length === 0);
      } catch (err) {
        setDoctors([]);
        setClosed(isConflict(err));
        if (!isConflict(err)) setError(t.genericError);
      }
    } catch {
      setError(t.genericError);
      setDoctors([]);
    }
  }, [caseId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Choosing and pricing are ONE call, because the doctor's tier is a term in
   * the price. There is nothing to confirm between them, and a two-step flow
   * would invite a screen that shows a price computed against a doctor the lab
   * has not yet chosen.
   */
  const choose = async (doctorId: string): Promise<void> => {
    setBusyId(doctorId);
    setError(null);
    try {
      const quoted = await api.cases.quote(caseId, doctorId);
      setItem(quoted);
    } catch (err) {
      // 409 here means this doctor switched off between the page rendering and
      // the click. Reload rather than retry against someone else: referring a
      // patient to a doctor nobody chose is not a recoverable action.
      setError(isConflict(err) ? t.pickDoctorGoneAway : t.genericError);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (item === null || doctors === null) return <Spinner label={t.loading} />;

  if (item.status === 'quoted' && item.quotedAmountMinor !== null) {
    return (
      <Main>
        <PageHeader title={t.pickDoctorQuotedTitle} description={t.pickDoctorQuotedDescription} />
        <Card>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t.pickDoctorColDoctor}</dt>
              <dd className="font-medium" data-testid="quoted-doctor">
                {item.doctorName ?? item.doctorId}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t.pickDoctorColPrice}</dt>
              <dd className="font-semibold tabular-nums" data-testid="quoted-price">
                {formatMoney(locale, {
                  amountMinor: item.quotedAmountMinor,
                  currency: item.quotedCurrency ?? 'USD',
                })}
              </dd>
            </div>
          </dl>

          {/* The two facts. Both from the dictionary — this copy is the
              product's promise about money and must translate. */}
          {item.quoteExpiresAt !== null && (
            <Alert tone="info" testId="quote-held">
              {t.quoteHeldUntil} {formatDate(item.quoteExpiresAt)}
            </Alert>
          )}
          <p className="mt-3 text-sm text-muted-foreground" data-testid="decline-note">
            {t.declineNoSecondCharge}
          </p>

          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => router.push(`/cases/${caseId}`)}>
              {t.viewDetails}
            </Button>
          </div>
        </Card>
      </Main>
    );
  }

  return (
    <Main wide>
      <PageHeader title={t.pickDoctorTitle} description={t.pickDoctorDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {closed ? (
        <EmptyState testId="specialty-closed">{t.specialtyClosed}</EmptyState>
      ) : doctors.length === 0 ? (
        <EmptyState testId="directory-empty">{t.directoryEmpty}</EmptyState>
      ) : (
        <>
          <Table data-testid="directory-list">
            <TableHeader>
              <TableRow>
                <TableHead>{t.pickDoctorColDoctor}</TableHead>
                <TableHead>{t.colSpecialty}</TableHead>
                <TableHead>{t.pickDoctorColTier}</TableHead>
                <TableHead>{t.pickDoctorColPrice}</TableHead>
                <TableHead>
                  <span className="sr-only">{t.colActions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {doctors.map((d) => (
                <TableRow key={d.id} data-testid="directory-row">
                  <TableCell className="font-medium">{d.displayName}</TableCell>
                  <TableCell className="text-muted-foreground">{d.specialty}</TableCell>
                  <TableCell>
                    <Badge>{d.tierCode}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {d.indicativeAmountMinor === null ? (
                      '—'
                    ) : (
                      formatMoney(locale, {
                        amountMinor: d.indicativeAmountMinor,
                        currency: d.indicativeCurrency ?? 'USD',
                      })
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid="choose-doctor"
                        disabled={busyId !== null}
                        onClick={() => void choose(d.id)}
                      >
                        {t.pickDoctorChoose}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p className="mt-3 text-sm text-muted-foreground" data-testid="indicative-note">
            {t.priceIndicative}
          </p>
        </>
      )}
    </Main>
  );
}
