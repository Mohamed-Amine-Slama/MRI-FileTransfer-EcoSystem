'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type CaseRecord } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { patientBriefLabel } from '../../components/case/labels';
import { RoleGate } from '../../components/RoleGate';
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
} from '../../components/ui';

/**
 * Receiving doctor's inbox — the Tunisian side of the consult.
 *
 * WHAT A DOCTOR SEES BEFORE THEY COMMIT is a summary: the specialty, the
 * referral reason, and when an answer would be due. Not the imaging, which
 * unlocks on acceptance, and not the patient — the lab keeps the identity.
 *
 * ACCEPTING STARTS A CLOCK. It is not an acknowledgement: from that moment the
 * doctor is answerable within the window, and a case they let run out expires
 * and refunds. The button says accept and the row says by when, because a
 * doctor who accepts everything to triage it is a doctor accruing expiries.
 *
 * Declining costs nothing and is not destructive — the lab's payment stays
 * held and they pick again. That asymmetry is why decline is a plain button
 * and accept is the primary one.
 */
export default function DoctorInboxPage(): React.JSX.Element {
  return (
    <RoleGate allow={['tunisia_doctor']}>
      <Inbox />
    </RoleGate>
  );
}

/** The states a receiving doctor still has a decision to make about. */
const ACTIONABLE: ReadonlySet<CaseRecord['status']> = new Set(['paid', 'accepted']);

function Inbox(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();

  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { cases: rows } = await api.cases.list();
      setCases(rows);
    } catch {
      setError(t.genericError);
      setCases([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'accept' | 'decline' | 'answer'): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      if (action === 'accept') {
        await api.cases.accept(id);
        setNotice(t.inboxAccepted);
      } else if (action === 'answer') {
        await api.cases.answer(id);
        setNotice(t.inboxAnswered);
      } else {
        await api.cases.decline(id);
        setNotice(null);
      }
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setBusyId(null);
    }
  };

  const rows = cases === null ? null : cases.filter((c) => ACTIONABLE.has(c.status));

  return (
    <Main wide>
      <PageHeader title={t.inboxTitle} description={t.inboxDescription} />

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      {rows === null ? (
        <Spinner label={t.loading} />
      ) : rows.length === 0 ? (
        <EmptyState testId="inbox-empty">{t.inboxEmpty}</EmptyState>
      ) : (
        <Table data-testid="inbox-list">
          <TableHeader>
            <TableRow>
              <TableHead>{t.colSpecialty}</TableHead>
              <TableHead>{t.colPatient}</TableHead>
              <TableHead>{t.colReason}</TableHead>
              <TableHead>{t.inboxAnswerDue}</TableHead>
              <TableHead>
                <span className="sr-only">{t.colActions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} data-testid="inbox-row" data-status={c.status}>
                {/*
                 * The case reference, never the patient. A doctor works from
                 * the pseudonym and the clinical summary; the identity stays on
                 * the lab's side of the corridor.
                 */}
                <TableCell className="font-medium">
                  <Link
                    href={`/cases/${c.id}`}
                    className="rounded-sm hover:text-primary hover:underline"
                  >
                    {c.specialty}
                  </Link>
                </TableCell>
                {/*
                 * Age and sex, which change how imaging is read — and nothing
                 * else. Migration 0028 removed this doctor's grant on the
                 * patient row, so there is no name here to render even if a
                 * later edit asked for one.
                 */}
                <TableCell className="text-muted-foreground tabular-nums">
                  {patientBriefLabel(t, c)}
                </TableCell>
                <TableCell className="text-muted-foreground">{c.reason ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {c.answerDueAt === null ? (
                    <Badge>{t.caseStatusPaid}</Badge>
                  ) : (
                    formatDate(c.answerDueAt)
                  )}
                </TableCell>
                <TableCell>
                  {c.status === 'paid' && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid="accept-case"
                        disabled={busyId === c.id}
                        onClick={() => void act(c.id, 'accept')}
                      >
                        {t.inboxAccept}
                      </Button>
                      <Button
                        size="sm"
                        data-testid="decline-case"
                        disabled={busyId === c.id}
                        onClick={() => void act(c.id, 'decline')}
                      >
                        {t.inboxDecline}
                      </Button>
                    </div>
                  )}
                  {c.status === 'accepted' && (
                    <div className="flex justify-end">
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid="answer-case"
                        disabled={busyId === c.id}
                        onClick={() => void act(c.id, 'answer')}
                      >
                        {t.inboxAnswer}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Main>
  );
}
