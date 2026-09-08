'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api/endpoints';
import { useT } from '../../../lib/i18n/provider';
import { DESTINATION_ROLES } from '../../../lib/corridor/registry';
import { RoleGate } from '../../../components/RoleGate';
import { Alert, Button, Card, Main, PageHeader, Spinner } from '../../../components/ui';

/**
 * The receiving doctor's availability — one switch.
 *
 * WHAT THIS REPLACED was a calendar: opening hours, weekly recurring rules, a
 * slot length, and windows that had to be withdrawn one by one. None of it
 * described anything a lab could act on, because a lab does not book a time —
 * it sends a case to a doctor who is taking work.
 *
 * DEFAULT OFF, and it stays off until the doctor says otherwise (migration
 * 0026). An approved doctor appearing in every lab's directory the moment ops
 * cleared them would be ops making a decision that is the doctor's.
 *
 * The screen states the consequence of being on, because the switch alone does
 * not: cases arrive priced, and accepting one starts an answer clock.
 */
export default function AvailabilityPage(): React.JSX.Element {
  return (
    <RoleGate allow={DESTINATION_ROLES}>
      <AvailabilitySwitch />
    </RoleGate>
  );
}

function AvailabilitySwitch(): React.JSX.Element {
  const t = useT();
  const [accepting, setAccepting] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Read from the doctor's OWN profile, which is the only place this state is
   * published. There is deliberately no endpoint answering "is doctor X on" —
   * that would make a clinician's working pattern queryable by anyone who knows
   * their id. The directory says who is on; it never says who is off.
   */
  useEffect(() => {
    void (async () => {
      try {
        const profile = await api.account.profile();
        setAccepting(profile.acceptingCases ?? false);
      } catch {
        setAccepting(false);
      }
    })();
  }, []);

  const toggle = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.cases.setAccepting(next);
        setAccepting(res.accepting);
      } catch {
        setError(t.genericError);
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  return (
    <Main>
      <PageHeader title={t.availabilityTitle} description={t.availabilityDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      {accepting === null ? (
        <Spinner label={t.loading} />
      ) : (
        <Card>
          <p className="mb-4 text-sm text-muted-foreground" data-testid="availability-state">
            {accepting ? t.availabilityOnExplainer : t.availabilityOffExplainer}
          </p>
          <Button
            variant={accepting ? undefined : 'primary'}
            disabled={busy}
            data-testid="toggle-accepting"
            onClick={() => void toggle(!accepting)}
          >
            {accepting ? t.availabilityTurnOff : t.availabilityTurnOn}
          </Button>
        </Card>
      )}
    </Main>
  );
}
