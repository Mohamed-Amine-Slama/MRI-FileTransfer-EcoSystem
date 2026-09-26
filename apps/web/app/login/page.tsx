'use client';

import Link from '../../components/ui/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { Alert, Button, Card, Field, Input, Main, PageHeader } from '../../components/ui';

/**
 * Sign-in — BUILD_SPEC P4.
 *
 * Authentication belongs to Keycloak (P4.1), not to this app, and both paths
 * below honour that:
 *
 *  - The form posts email + password to /auth/password-login, which relays a
 *    single token request to Keycloak and returns the access token. The app
 *    never stores or checks a password; policy, lockout and brute-force
 *    protection stay in Keycloak. See app/auth/password-login/route.ts.
 *  - The identity-provider link is the OIDC redirect — the production path,
 *    where credentials are typed on Keycloak's own pages.
 *
 * "Wrong email" and "wrong password" render the same sentence on purpose:
 * anything more specific is an account-enumeration oracle.
 */
export default function LoginPage(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const { signInWithToken } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim() !== '' && password !== '' && !busy;

  const signIn = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/auth/password-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (res.status === 401) {
        setError(t.signInInvalid);
        return;
      }
      if (!res.ok) {
        setError(t.genericError);
        return;
      }
      const { accessToken } = (await res.json()) as { accessToken: string };
      await signInWithToken(accessToken);
      router.push('/');
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    /*
     * A split panel on desktop, a single column on a phone.
     *
     * The second panel is not decoration: someone arriving at a sign-in form
     * for a platform that moves patient records across a border wants to know
     * what it is before typing a password, and the three lines there are the
     * same ones the landing page leads with. It is hidden below `lg` rather
     * than stacked, because on a phone it would push the form off the first
     * screen — and the form is why anyone is here.
     */
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-20">
      <Main className="max-w-md px-0 py-0 sm:px-0">
        <PageHeader title={t.signInTitle} description={t.signInDescription} />

      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <Field label={t.signInEmail}>
            <Input
              data-testid="login-email"
              type="email"
              value={email}
              autoComplete="username"
              inputMode="email"
              spellCheck={false}
              dir="ltr"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label={t.signInPassword}>
            <Input
              data-testid="login-password"
              type="password"
              value={password}
              autoComplete="current-password"
              dir="ltr"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error !== null && <Alert tone="danger">{error}</Alert>}

          <Button
            type="submit"
            variant="primary"
            className="h-11 w-full"
            data-testid="login-submit"
            disabled={!canSubmit}
          >
            <LogIn aria-hidden="true" />
            {t.navSignIn}
          </Button>
        </form>

        {/* §5.1: recovery and registration are reachable from the point of
            failure. Someone who cannot sign in is on this screen, not hunting
            through a footer. */}
        <div className="mt-4 flex flex-wrap justify-between gap-3 border-t pt-4 text-sm">
          <Link
            href="/reset-password"
            data-testid="forgot-password"
            className="font-semibold text-primary hover:underline"
          >
            {t.resetForgot}
          </Link>
          <Link
            href="/signup/provider"
            data-testid="signup-link"
            className="font-semibold text-primary hover:underline"
          >
            {t.navSignUp}
          </Link>
        </div>
      </Card>

      {/* The OIDC redirect — the production path (P4.1): credentials typed on
          the identity provider's own pages, second factor included. */}
      <a
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-input bg-card px-4 text-sm font-medium shadow-sm transition-colors hover:border-primary hover:text-primary"
        href="/api/auth/login"
        data-testid="oidc-login"
      >
        <KeyRound className="size-4" aria-hidden="true" />
        {t.signInContinue}
      </a>
      </Main>

      <aside className="hidden flex-col justify-center lg:flex" aria-hidden="true">
        <p className="marketing-display text-3xl">{t.landingHeadline}</p>
        <p className="mt-4 max-w-md text-muted-foreground">{t.landingSubhead}</p>
        <ul className="mt-8 space-y-3 text-sm">
          {[
            t.landingFeatureTransferTitle,
            t.landingFeaturePipelineTitle,
            t.landingFeatureBillingTitle,
          ].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              {line}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
