'use client';

import Link from '../../components/ui/link';
import type { VerificationStatus } from '@mir/contracts';
import { PROVIDER_ROLES } from '../../lib/corridor/registry';
import { useOrganisation } from '../../lib/account/organisation';
import { useDateFormat, useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import {
  verificationLabel,
  verificationReasonLabel,
  verificationTone,
} from '../../components/case/labels';
import {
  Alert,
  Badge,
  Card,
  Main,
  PageHeader,
  Spinner,
  buttonVariants,
} from '../../components/ui';
import type { Tone } from '../../components/case/labels';

/**
 * Verification status — brief §5.1.
 *
 * The brief's requirement is specific: the provider must be able to see where
 * their application stands "with no need to contact the platform team". So
 * this page states the decision, the date it was taken, and — when refused —
 * the reason, rather than a status word that prompts a phone call.
 *
 * `decidedAt` is guaranteed present on a decided verification by the contract's
 * refinement, so the date below cannot be a decided application with a blank
 * date.
 */
/**
 * APPLICANTS MUST REACH THIS SCREEN, and that is why the gate is not just the
 * provider roles. §5.1 P0 requires an organisation to see where its application
 * stands "with no need to contact the platform team" — and while it is pending,
 * nobody at that organisation holds a clinical role yet. Gating on the roles the
 * decision GRANTS would have made the screen reachable only after it stopped
 * being needed.
 */
export default function VerificationPage(): React.JSX.Element {
  return (
    <RoleGate allow={[...PROVIDER_ROLES, 'applicant']}>
      <VerificationStatusView />
    </RoleGate>
  );
}

function bodyFor(t: ReturnType<typeof useT>, status: VerificationStatus): string {
  const bodies: Record<VerificationStatus, string> = {
    pending: t.verificationPendingBody,
    approved: t.verificationApprovedBody,
    rejected: t.verificationRejectedBody,
  };
  return bodies[status];
}

function alertToneFor(status: VerificationStatus): Tone {
  return verificationTone(status);
}

function VerificationStatusView(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  // The REAL organisation record, not the case layer's fixture. Verification is
  // an account-layer concern (migration 0010) and the row a screen shows here
  // has to be the one ops actually decided on.
  const { organisation: provider, loading, failed } = useOrganisation();

  if (loading) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  // A load failure is NOT "you have not applied". Telling an applicant they
  // have no application when the request merely failed would send them to fill
  // the form in a second time.
  if (failed) {
    return (
      <Main>
        <PageHeader title={t.verificationTitle} />
        <Alert tone="danger">{t.genericError}</Alert>
      </Main>
    );
  }

  if (provider === null) {
    return (
      <Main>
        <PageHeader title={t.verificationTitle} />
        <Alert tone="warning" testId="no-provider">
          {t.signUpProviderDescription}
        </Alert>
        <Link href="/signup/provider" className={buttonVariants()}>
          {t.signUpProviderTitle}
        </Link>
      </Main>
    );
  }

  const { verification } = provider;
  const reason = verificationReasonLabel(t, verification.reasonKey);

  return (
    <Main>
      <PageHeader
        title={t.verificationTitle}
        description={provider.legalName}
        actions={
          <Badge tone={verificationTone(verification.status)} testId="verification-status">
            {verificationLabel(t, verification.status)}
          </Badge>
        }
      />

      <Alert tone={alertToneFor(verification.status)} testId="verification-body">
        {bodyFor(t, verification.status)}
      </Alert>

      <Card>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t.verificationSubmittedAt}</dt>
            <dd className="text-sm">{formatDate(verification.submittedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.verificationDecidedAt}</dt>
            <dd className="text-sm">
              {verification.decidedAt === undefined ? '—' : formatDate(verification.decidedAt)}
            </dd>
          </div>
          {verification.status === 'rejected' && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t.verificationReason}</dt>
              {/* A reason key we do not recognise resolves to null and the
                  field falls back rather than printing the raw key. */}
              <dd className="text-sm" data-testid="rejection-reason">
                {reason ?? t.none}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      {verification.status === 'approved' && (
        <div className="flex flex-wrap gap-3">
          <Link href="/cases/new" className={buttonVariants()}>
            {t.casesNew}
          </Link>
          <Link href="/cases" className={buttonVariants({ variant: 'outline' })}>
            {t.casesTitle}
          </Link>
        </div>
      )}
    </Main>
  );
}
