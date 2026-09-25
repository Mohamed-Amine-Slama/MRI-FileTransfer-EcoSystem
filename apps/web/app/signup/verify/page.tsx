'use client';

import Link from '../../../components/ui/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { VERIFICATION_RESEND_COOLDOWN_SECONDS, verificationCodeSchema } from '@mir/contracts';
import { api } from '../../../lib/api/endpoints';
import { useLocale, useT } from '../../../lib/i18n/provider';
import {
  Alert,
  Button,
  Card,
  Main,
  OtpInput,
  PageHeader,
  buttonVariants,
} from '../../../components/ui';

/**
 * Email verification — brief §5.1.
 *
 * THE SIX DIGITS ARE THE WHOLE SCREEN. Nothing else competes with them,
 * because the person here has just switched to another application to read a
 * code and has come back holding exactly one piece of information.
 *
 * FAILURES ARE INDISTINGUISHABLE, and that is enforced two layers below this
 * one: `identity_verify_email` returns nothing for a wrong code, an expired
 * code, a burnt one, and an unknown address alike, and the endpoint answers 204
 * either way. So this screen genuinely cannot tell the four apart — the single
 * sentence it shows is not a simplification of a richer truth it is hiding.
 *
 * The resend cooldown is a COURTESY, not the control. The real budget is the
 * server's `otpRequest` limit, keyed on the address; this only stops someone
 * hammering a button that is not going to help them.
 */
export default function VerifyEmailPage(): React.JSX.Element {
  return (
    // useSearchParams needs a Suspense boundary to keep the route static.
    <Suspense fallback={null}>
      <VerifyEmailScreen />
    </Suspense>
  );
}

function VerifyEmailScreen(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const email = useSearchParams().get('email') ?? '';

  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(VERIFICATION_RESEND_COOLDOWN_SECONDS);

  // Counts down once per second and stops at zero. Cleared on unmount so a
  // fast navigation does not leave an interval setting state on a dead tree.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const submit = useCallback(
    async (value: string): Promise<void> => {
      if (!verificationCodeSchema.safeParse(value).success || email === '') return;
      setState('busy');
      setError(null);
      try {
        await api.account.verifyEmail(email, value);
        /*
         * The endpoint answers 204 whether or not the code was right — it must,
         * or it becomes an oracle. So success here means "the attempt was
         * accepted", and the screen cannot claim more than that. It sends the
         * user to sign in, which is the honest next step: if the code was
         * wrong, sign-in fails and they come back for a new one.
         */
        setState('done');
      } catch {
        setError(t.genericError);
        setState('idle');
      }
    },
    [email, t],
  );

  const resend = async (): Promise<void> => {
    setCooldown(VERIFICATION_RESEND_COOLDOWN_SECONDS);
    setError(null);
    try {
      await api.account.resendCode(email, locale);
    } catch {
      // Deliberately silent. A failure here would say something about whether
      // the address exists, and the user has already been told to check.
    }
  };

  if (email === '') {
    return (
      <Main className="max-w-md py-12">
        <PageHeader title={t.verifyTitle} />
        <Alert tone="warning" testId="verify-no-email">
          {t.verifyMissingEmail}
        </Alert>
        <Link href="/signup" className={buttonVariants()}>
          {t.signUpTitle}
        </Link>
      </Main>
    );
  }

  if (state === 'done') {
    return (
      <Main className="max-w-md py-12">
        <PageHeader title={t.verifyTitle} />
        <Alert tone="success" testId="verify-success">
          {t.verifySuccess}
        </Alert>
        <Link href="/login" className={buttonVariants()} data-testid="verify-continue">
          {t.navSignIn}
        </Link>
      </Main>
    );
  }

  return (
    <Main className="max-w-md py-12">
      <PageHeader title={t.verifyTitle} description={t.verifyDescription} />

      <Card>
        <div className="flex flex-col items-center gap-5 py-2">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent">
            <MailCheck className="size-6 text-primary" aria-hidden="true" />
          </span>
          {/* The address is echoed so a typo is caught here rather than after
              five minutes of waiting for mail that went somewhere else. */}
          <p className="text-center text-sm text-muted-foreground">
            <bdi className="font-medium text-foreground">{email}</bdi>
          </p>

          <OtpInput
            label={t.verifyCode}
            testId="verify-code"
            value={code}
            invalid={error !== null}
            disabled={state === 'busy'}
            onChange={setCode}
            // Submits itself on the sixth digit. Someone who has just typed a
            // code they read off a screen should not have to find a button.
            onComplete={(value) => void submit(value)}
          />

          {error !== null && <Alert tone="danger">{error}</Alert>}

          <Button
            variant="primary"
            className="h-11 w-full"
            data-testid="verify-submit"
            disabled={code.length !== 6 || state === 'busy'}
            onClick={() => void submit(code)}
          >
            {state === 'busy' ? t.loading : t.verifySubmit}
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            <p>{t.verifyNoEmail}</p>
            {cooldown > 0 ? (
              <p className="mt-1 tabular-nums">
                {t.verifyResendIn} {cooldown} {t.verifySeconds}
              </p>
            ) : (
              <button
                type="button"
                data-testid="verify-resend"
                className="mt-1 font-semibold text-primary hover:underline"
                onClick={() => void resend()}
              >
                {t.verifyResend}
              </button>
            )}
          </div>
        </div>
      </Card>
    </Main>
  );
}
