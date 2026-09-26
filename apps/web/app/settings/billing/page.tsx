'use client';

import Link from '../../../components/ui/link';
import { useCallback, useEffect, useState } from 'react';
import {
  findTier,
  tiersForSide,
  type PlanCode,
  type PlanTier,
  type PlanUsage,
  type Subscription,
} from '@mir/contracts';
import { api } from '../../../lib/api/endpoints';
import { useDateFormat, useLocale, useT } from '../../../lib/i18n/provider';
import type { Dictionary } from '../../../lib/i18n/dictionary';
import { PROVIDER_ROLES, sideForRole } from '../../../lib/corridor/registry';
import { useSession } from '../../../lib/session/session';
import {
  casesLabel,
  formatPrice,
  perIntervalLabel,
  planName,
  seatsLabel,
} from '../../../lib/plans/labels';
import {
  Alert,
  Badge,
  Button,
  Card,
  Meter,
  Select,
  Spinner,
  buttonVariants,
} from '../../../components/ui';

/**
 * The organisation's plan and what it is using — brief §5.7.
 *
 * TWO THINGS THIS SCREEN IS CAREFUL ABOUT.
 *
 * 1. **It shows no total.** §5.7 P0 forbids merging coordination fees with
 *    subscription charges into one "amount owed", and `LedgerSummary` has no
 *    field to render for it. This panel is about the TIER; the ledger is
 *    reached by a link, where the two kinds stay in separate tables.
 *
 * 2. **It says plainly that changing plan takes no money.** Blocking item L7 is
 *    unresolved, so no payment rail exists and the write records intent. A
 *    "Change plan" button that looked like a purchase would be the dishonest
 *    version of that.
 */
export default function BillingSettings(): React.JSX.Element {
  return (
    <ProviderOnly>
      <BillingPanel />
    </ProviderOnly>
  );
}

/**
 * The panel-level gate.
 *
 * NOT `RoleGate`, and the difference is structural rather than stylistic: that
 * component renders its refusal inside its own `<Main>`, and this panel already
 * sits inside the one the settings layout provides. Two nested `<main>` elements
 * are invalid HTML and give a screen reader two "main" landmarks to choose
 * between. So the refusal here is just the alert.
 *
 * Like every gate in this application it is a usability measure. The API
 * refuses these routes and row-level security refuses the rows regardless
 * (§4.4).
 */
function ProviderOnly({ children }: { children: React.ReactNode }): React.JSX.Element {
  const t = useT();
  const { status, role } = useSession();

  if (status === 'loading') return <Spinner label={t.loading} />;
  if (status === 'anonymous') {
    return (
      <Alert tone="warning" testId="sign-in-required">
        {t.signInRequired}
      </Alert>
    );
  }
  if (role === null || !PROVIDER_ROLES.includes(role)) {
    return (
      <Alert tone="danger" testId="not-authorised">
        {t.notAuthorised}
      </Alert>
    );
  }
  return <>{children}</>;
}

function statusLabel(t: Dictionary, status: Subscription['status']): string {
  const labels: Record<Subscription['status'], string> = {
    trialing: t.subStatusTrialing,
    active: t.subStatusActive,
    past_due: t.subStatusPastDue,
    cancelled: t.subStatusCancelled,
  };
  return labels[status];
}

function statusTone(status: Subscription['status']): 'info' | 'success' | 'warning' | undefined {
  const tones: Record<Subscription['status'], 'info' | 'success' | 'warning' | undefined> = {
    trialing: 'info',
    active: 'success',
    past_due: 'warning',
    cancelled: undefined,
  };
  return tones[status];
}

function BillingPanel(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const formatDate = useDateFormat();
  const { role } = useSession();

  const [plans, setPlans] = useState<PlanTier[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<PlanCode | ''>('');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [{ plans: catalogue }, mine] = await Promise.all([
        api.plans.catalogue(),
        api.plans.mine(),
      ]);
      setPlans(catalogue);
      setSubscription(mine.subscription);
      setUsage(mine.usage);
      setChoice(mine.subscription?.planCode ?? '');
    } catch {
      // A flag, not a translated string: capturing `t` would make the locale a
      // dependency of this callback and reload the panel on every language
      // switch. The sentence is chosen at render time instead.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only the caller's own ladder. The catalogue carries both sides, and a
  // cross-side plan is refused by the database (migration 0022) — offering it
  // here was a button that could only fail.
  const side = role === null ? null : sideForRole(role);
  const offered = side === 'source' || side === 'destination' ? tiersForSide(plans, side) : plans;
  // With no subscription — or one on a retired tier, which is no longer on
  // sale — the side's current plan is preselected.
  const selected: PlanCode | '' = offered.some((tier) => tier.code === choice)
    ? choice
    : (offered[0]?.code ?? '');

  const change = async (): Promise<void> => {
    if (selected === '') return;
    setBusy(true);
    setChanged(false);
    setError(null);
    try {
      await api.plans.change(selected);
      setChanged(true);
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label={t.loading} />;

  const current = subscription === null ? null : findTier(plans, subscription.planCode);
  // Locale tags for money, matching the date formatter's table.
  const localeTag = { ar: 'ar-LY', fr: 'fr-TN', en: 'en-GB' }[locale];

  return (
    <div className="space-y-4">
      {(error !== null || loadFailed) && <Alert tone="danger">{error ?? t.genericError}</Alert>}
      {changed && (
        <Alert tone="success" testId="billing-changed">
          {t.billingChanged}
        </Alert>
      )}

      <Card
        title={t.billingCurrentPlan}
        actions={
          subscription !== null && (
            <Badge tone={statusTone(subscription.status)} testId="billing-status">
              {statusLabel(t, subscription.status)}
            </Badge>
          )
        }
      >
        {current === null ? (
          <p className="text-sm text-muted-foreground" data-testid="billing-no-plan">
            {t.billingNoPlan}
          </p>
        ) : (
          <>
            <p className="text-2xl font-bold" data-testid="billing-plan-name">
              {planName(t, current)}
            </p>
            <p className="text-sm text-muted-foreground">
              {seatsLabel(t, current.seatLimit)} · {casesLabel(t, current.monthlyCaseLimit)}
            </p>
            {subscription !== null && (
              <p className="text-sm text-muted-foreground">
                {t.billingPeriod}: {formatDate(subscription.periodStart)} —{' '}
                {formatDate(subscription.periodEnd)}
              </p>
            )}
          </>
        )}
      </Card>

      {usage !== null && (
        <Card title={t.billingSeatsUsed}>
          <Meter
            label={t.teamSeats}
            used={usage.seatsUsed}
            limit={current?.seatLimit ?? null}
            unlimitedLabel={t.billingUnlimited}
            testId="billing-seat-meter"
          />
          <Meter
            label={t.billingCasesThisPeriod}
            used={usage.casesThisPeriod}
            limit={current?.monthlyCaseLimit ?? null}
            unlimitedLabel={t.billingUnlimited}
            testId="billing-case-meter"
          />
        </Card>
      )}

      <Card title={t.billingChangePlan}>
        {/* Stated before the control, not after it. Someone about to press a
            button that sounds like a purchase needs to know it is not one. */}
        <Alert tone="info" testId="billing-no-charge">
          {t.pricingNoChargeNote}
        </Alert>

        <div className="flex flex-wrap items-end gap-3">
          <Select
            data-testid="billing-plan-select"
            className="max-w-xs"
            value={selected}
            onChange={(e) => setChoice(e.target.value as PlanCode)}
          >
            {offered.map((tier) => (
              <option key={tier.code} value={tier.code}>
                {planName(t, tier)}
                {/* Through formatPrice, which applies the CURRENCY'S exponent.
                    A hardcoded /100 overstates every TND and LYD figure
                    tenfold — on this corridor's own local currencies. */}
                {tier.price === null
                  ? ''
                  : ` — ${formatPrice(tier.price, localeTag)} ${perIntervalLabel(t, tier.interval)}`}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            data-testid="billing-change"
            disabled={busy || selected === '' || selected === subscription?.planCode}
            onClick={() => void change()}
          >
            {busy ? t.loading : t.billingChangePlan}
          </Button>
        </div>
      </Card>

      <div>
        <Link href="/ledger" className={buttonVariants({ variant: 'outline' })}>
          {t.billingLedgerLink}
        </Link>
      </div>
    </div>
  );
}
