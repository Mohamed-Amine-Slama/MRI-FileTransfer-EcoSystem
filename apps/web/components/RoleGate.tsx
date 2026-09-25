'use client';

import Link from './ui/link';
import type { ReactNode } from 'react';
import type { Role } from '@mir/contracts';
import { useT } from '../lib/i18n/provider';
import { useSession } from '../lib/session/session';
import { Alert, Main, Spinner, buttonVariants } from './ui';

/**
 * Renders children only for the listed roles.
 *
 * THIS IS NOT ACCESS CONTROL. It stops a doctor from staring at a screen full
 * of failed requests that were never meant for them; it does not stop anyone
 * from reading data. Every route behind this is independently refused by the
 * API guard (P4.2) and every row by RLS (ADR-6). If this component were
 * deleted, no patient record would become readable — that is the property that
 * makes it safe to have client-side routing at all.
 */
export function RoleGate({
  allow,
  children,
}: {
  allow: readonly Role[];
  children: ReactNode;
}): React.JSX.Element {
  const t = useT();
  const { status, role } = useSession();

  if (status === 'loading') {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  if (status === 'anonymous') {
    return (
      <Main>
        <Alert tone="warning" testId="sign-in-required">
          {t.signInRequired}
        </Alert>
        <Link href="/login" className={buttonVariants()}>
          {t.navSignIn}
        </Link>
      </Main>
    );
  }

  if (role === null || !allow.includes(role)) {
    return (
      <Main>
        <Alert tone="danger" testId="not-authorised">
          {t.notAuthorised}
        </Alert>
      </Main>
    );
  }

  return <>{children}</>;
}
