'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { ENTITLEMENTS, type PlanTier } from '@mir/contracts';
import { api } from '../../lib/api/endpoints';
import { useLocale, useT } from '../../lib/i18n/provider';
import {
  casesLabel,
  entitlementLabel,
  formatPrice,
  perIntervalLabel,
  planBlurb,
  planName,
  seatsLabel,
} from '../../lib/plans/labels';
import { useSession } from '../../lib/session/session';
import { cn } from '../../lib/utils';
import { Alert, Spinner, buttonVariants } from '../../components/ui';

/**
 * Public pricing — brief §2, §5.7.
 *
 * Two plans, one per corridor side, at the owner's yearly prices (migration
 * 0033, spec 2026-09-21 §4). The placeholder notice this page used to carry
 * went with the placeholder tiers.
 *
 * THIS IS THE MARKETING REGISTER, and it is confined to it. §4.1 requires the
 * signed-in product to read as calm and precise because clinic staff use it to
 * move patient data; a pricing page has the opposite job. The gradient and the
 * display type come from `.marketing`, which only `PublicChrome` sets — so
 * nothing here can leak onto a case, file, or money screen.
 *
 * The one thing that does NOT get the softer voice is the separation of
 * charges. §5.7 P0 forbids merging coordination fees with subscription
 * charges, and that is stated in the subtitle rather than buried in a footnote,
 * because a clinic comparing tiers is exactly who needs to know the
 * per-case fee is not in these numbers.
 */
export default function PricingPage(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const { status } = useSession();

  const [plans, setPlans] = useState<PlanTier[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { plans: catalogue } = await api.plans.catalogue();
        setPlans(catalogue);
      } catch {
        setFailed(true);
        setPlans([]);
      }
    })();
  }, []);

  const localeTag = { ar: 'ar-LY', fr: 'fr-TN', en: 'en-GB' }[locale];

  return (
    <main>
      <section className="marketing-hero border-b">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <h1 className="marketing-display text-4xl sm:text-5xl">{t.pricingTitle}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t.pricingSubtitle}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-12 sm:px-6">
        {failed && <Alert tone="danger">{t.genericError}</Alert>}
        {plans === null && <Spinner label={t.loading} />}

        {plans !== null && plans.length > 0 && (
          <div className="grid gap-5 md:grid-cols-2" data-testid="pricing-tiers">
            {plans.map((tier) => (
              <PlanCard
                key={tier.code}
                tier={tier}
                localeTag={localeTag}
                // One plan per side: neither is the "recommended" one.
                featured={false}
                signedIn={status === 'authenticated'}
              />
            ))}
          </div>
        )}

        <Alert tone="info" testId="pricing-no-charge">
          {t.pricingNoChargeNote}
        </Alert>

        {plans !== null && plans.length > 0 && <ComparisonTable plans={plans} />}
      </div>
    </main>
  );
}

function PlanCard({
  tier,
  localeTag,
  featured,
  signedIn,
}: {
  tier: PlanTier;
  localeTag: string;
  featured: boolean;
  signedIn: boolean;
}): React.JSX.Element {
  const t = useT();

  return (
    <section
      data-testid={`plan-${tier.code}`}
      className={cn(
        'flex flex-col rounded-xl border bg-card p-6 shadow-sm transition-colors',
        featured && 'border-primary shadow-md',
      )}
    >
      <h2 className="font-display text-lg font-medium">{planName(t, tier)}</h2>
      <p className="mt-1 min-h-10 text-sm text-muted-foreground">{planBlurb(t, tier)}</p>

      <p className="mt-5 flex items-baseline gap-1.5">
        {tier.price === null ? (
          <span className="text-3xl font-bold tracking-tight">{t.pricingContactUs}</span>
        ) : (
          <>
            <span className="text-4xl font-bold tracking-tight tabular-nums">
              {formatPrice(tier.price, localeTag)}
            </span>
            <span className="text-sm text-muted-foreground">
              {perIntervalLabel(t, tier.interval)}
            </span>
          </>
        )}
      </p>

      <ul className="mt-6 flex-1 space-y-2.5 text-sm">
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          {seatsLabel(t, tier.seatLimit)}
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          {casesLabel(t, tier.monthlyCaseLimit)}
        </li>
        {tier.entitlements.map((entitlement) => (
          <li key={entitlement} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            {entitlementLabel(t, entitlement)}
          </li>
        ))}
      </ul>

      <Link
        href={signedIn ? '/settings/billing' : '/signup'}
        data-testid={`plan-cta-${tier.code}`}
        className={cn(
          buttonVariants({ variant: featured ? 'default' : 'outline' }),
          'mt-6 h-11 w-full',
        )}
      >
        {signedIn ? t.pricingChoose : t.pricingSignedOutCta}
      </Link>
    </section>
  );
}

/**
 * The same information as a grid.
 *
 * Not decoration: the cards answer "what is this tier", and the table answers
 * "which tier has the thing I need", which is a different question and the one
 * someone comparing three options is actually asking. It scrolls inside its own
 * container rather than the page (§4.5).
 */
function ComparisonTable({ plans }: { plans: PlanTier[] }): React.JSX.Element {
  const t = useT();

  /*
   * `w-full` and `min-w-[36rem]` together were a contradiction — "fill the
   * container" and "be at least 576px wide" — and Chromium resolved it by
   * letting the table push the DOCUMENT wider on a narrow screen instead of
   * scrolling inside its box. On a phone that turns one wide table into a
   * horizontally scrolling page, which §4.5 forbids.
   *
   * `w-max min-w-full` states the intent without the conflict: as wide as the
   * content needs, and never narrower than the container.
   */
  return (
    <div className="w-full overflow-x-auto rounded-lg border" data-testid="pricing-comparison">
      <table className="w-max min-w-full border-collapse text-sm">
        <caption className="sr-only">{t.pricingTitle}</caption>
        <thead>
          <tr className="border-b bg-muted/50">
            <th scope="col" className="p-3 text-start font-semibold">
              {t.pricingTitle}
            </th>
            {plans.map((tier) => (
              <th key={tier.code} scope="col" className="p-3 text-start font-semibold">
                {planName(t, tier)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <th scope="row" className="p-3 text-start font-medium">
              {t.teamSeats}
            </th>
            {plans.map((tier) => (
              <td key={tier.code} className="p-3">
                {seatsLabel(t, tier.seatLimit)}
              </td>
            ))}
          </tr>
          <tr className="border-b">
            <th scope="row" className="p-3 text-start font-medium">
              {t.billingCasesThisPeriod}
            </th>
            {plans.map((tier) => (
              <td key={tier.code} className="p-3">
                {casesLabel(t, tier.monthlyCaseLimit)}
              </td>
            ))}
          </tr>
          {ENTITLEMENTS.map((entitlement) => (
            <tr key={entitlement} className="border-b last:border-b-0">
              <th scope="row" className="p-3 text-start font-medium">
                {entitlementLabel(t, entitlement)}
              </th>
              {plans.map((tier) => (
                <td key={tier.code} className="p-3">
                  {tier.entitlements.includes(entitlement) ? (
                    <>
                      <Check className="size-4 text-success" aria-hidden="true" />
                      {/* The tick is not the only carrier of the answer. */}
                      <span className="sr-only">{t.confirm}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">{t.none}</span>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
