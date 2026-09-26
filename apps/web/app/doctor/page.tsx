'use client';

import Link from '../../components/ui/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type CaseRecord } from '../../lib/api/endpoints';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { cn } from '../../lib/utils';
import { doctorModel } from '../../lib/dashboard/doctor-model';
import { isStale } from '../../lib/dashboard/time';
import { caseStatusTone, patientBriefLabel, specialtyLabel } from '../../components/case/labels';
import { DashboardHeader, QueueRow, QueueSection } from '../../components/dashboard/queue';
import { RoleGate } from '../../components/RoleGate';
import { Alert, Button, buttonVariants, Card, Main, Spinner, StatGrid, StatTile } from '../../components/ui';

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

function Inbox(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { user } = useSession();

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

  const act = async (id: string, action: 'accept' | 'decline'): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      if (action === 'accept') {
        await api.cases.accept(id);
        setNotice(t.inboxAccepted);
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

  if (cases === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const now = Date.now();
  const { triage, answering, answered } = doctorModel(cases, now);
  // Age and sex, then the referral reason — the summary a doctor decides on.
  // Never the patient's name: migration 0028 removed that grant.
  const summary = (c: CaseRecord): string =>
    [patientBriefLabel(t, c), c.reason]
      .filter((part) => part !== null && part !== '' && part !== '\u2014')
      .join(' · ');

  return (
    <Main wide className="space-y-6">
      <DashboardHeader
        greeting={user === null ? t.inboxTitle : `${t.dashHello} ${user.displayName}`}
        subtitle={t.inboxDescription}
      >
        <StatGrid className="lg:grid-cols-3">
          <StatTile label={t.dashToTriage} value={triage.length} emphasis testId="tile-triage" />
          <StatTile label={t.dashToAnswer} value={answering.length} testId="tile-answer" />
          <StatTile label={t.dashAnswered7d} value={answered.length} testId="tile-answered" />
        </StatGrid>
      </DashboardHeader>

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <QueueSection
            title={t.dashToTriage}
            count={triage.length}
            empty={t.inboxEmpty}
            testId="inbox-list"
            emptyTestId="inbox-empty"
          >
            {triage.map((c) => (
              <QueueRow
                key={c.id}
                testId="inbox-row"
                dataStatus={c.status}
                reference={c.caseRef}
                href={`/cases/${c.id}`}
                label={specialtyLabel(t, c.specialty)}
                secondary={summary(c)}
                tone={caseStatusTone(c.status)}
                at={c.updatedAt}
                stale={isStale(c, now)}
                action={
                  <>
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
                  </>
                }
              />
            ))}
          </QueueSection>

          <QueueSection
            title={t.dashToAnswer}
            count={answering.length}
            empty={t.dashToAnswerEmpty}
            testId="answer-list"
            emptyTestId="answer-empty"
          >
            {answering.map((c) => (
              <QueueRow
                key={c.id}
                testId="inbox-row"
                dataStatus={c.status}
                reference={c.caseRef}
                href={`/cases/${c.id}`}
                label={specialtyLabel(t, c.specialty)}
                secondary={
                  c.answerDueAt === null
                    ? summary(c)
                    : `${t.inboxAnswerDue}: ${formatDate(c.answerDueAt)} · ${summary(c)}`
                }
                tone={caseStatusTone(c.status)}
                at={c.updatedAt}
                stale={isStale(c, now)}
                action={
                  // Answering IS submitting the report, written beside the images.
                  <Link
                    href={`/cases/${c.id}`}
                    data-testid="write-report"
                    className={buttonVariants({ variant: 'default', size: 'sm' })}
                  >
                    {t.inboxWriteReport}
                  </Link>
                }
              />
            ))}
          </QueueSection>
        </div>

        <aside>
          <Card title={t.navAvailability}>
            <p className="text-sm text-muted-foreground">{t.availabilityDescription}</p>
            <Link
              href="/doctor/availability"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-3')}
            >
              {t.availabilityTitle}
            </Link>
          </Card>
        </aside>
      </div>
    </Main>
  );
}
