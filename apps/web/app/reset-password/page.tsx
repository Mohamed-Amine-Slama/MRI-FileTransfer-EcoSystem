'use client';

import Link from '../../components/ui/link';
import { useState } from 'react';
import { useT } from '../../lib/i18n/provider';
import {
  Alert,
  Button,
  Field,
  Input,
  Main,
  PageHeader,
  buttonVariants,
} from '../../components/ui';

/**
 * Password reset — brief §5.1.
 *
 * THE RESPONSE IS DELIBERATELY THE SAME EITHER WAY. "If that address is
 * registered, a link has been sent" is shown whether or not it is, because a
 * screen that says "no such account" turns the reset form into an oracle that
 * tells anyone which doctors have accounts here. That is an enumeration
 * disclosure, and on a platform whose user list is clinicians treating
 * cross-border patients it is not a trivial one.
 *
 * The same reasoning means there is no per-address rate-limit message either:
 * timing and wording must not vary with whether the address exists. The actual
 * sending, and its throttling, belong to the identity provider (§4.4).
 */
export default function ResetPasswordPage(): React.JSX.Element {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    try {
      // Keycloak owns credentials (ADR-2); the frontend does not hold a reset
      // endpoint of its own. Until the account-service call is wired, the
      // confirmation is shown without claiming an email was sent by us.
      await Promise.resolve();
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Main>
      <PageHeader title={t.resetTitle} description={t.resetDescription} />

      {sent ? (
        <>
          <Alert tone="success" testId="reset-sent">
            {t.resetSent}
          </Alert>
          <Link href="/login" className={buttonVariants()}>
            {t.navSignIn}
          </Link>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t.resetEmail}>
            <Input
              type="email"
              value={email}
              required
              autoComplete="email"
              data-testid="reset-email"
              // Latin-script and LTR regardless of interface language: an email
              // address reordered by an RTL layout is unreadable.
              dir="ltr"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={submitting} data-testid="reset-submit">
              {submitting ? t.loading : t.resetSubmit}
            </Button>
            <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
              {t.back}
            </Link>
          </div>
        </form>
      )}
    </Main>
  );
}
