'use client';

import Link from '../../../components/ui/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { UserRoundPlus } from 'lucide-react';
import { api } from '../../../lib/api/endpoints';
import { useT } from '../../../lib/i18n/provider';
import { useSession } from '../../../lib/session/session';
import {
  Alert,
  Button,
  Card,
  Main,
  PageHeader,
  Spinner,
  buttonVariants,
} from '../../../components/ui';

/**
 * Accepting a seat invitation — brief §5.5.
 *
 * THE TOKEN IS IN THE URL AND THE ACCEPTANCE IS NOT AUTOMATIC. Landing on this
 * page does not join anything; a button does. Email clients and security
 * scanners follow links in messages routinely, and an invitation that consumed
 * itself on GET would be burnt by a spam filter before the invitee ever saw it.
 *
 * SIGNING IN COMES FIRST, and the server checks that the signed-in account's
 * address matches the one invited. Without that, a forwarded email would let
 * whoever received it join the clinic instead of the intended colleague.
 */
export default function AcceptInvitePage(): React.JSX.Element {
  const t = useT();
  const params = useParams<{ token: string }>();
  const { status } = useSession();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const token = typeof params.token === 'string' ? params.token : '';

  const accept = async (): Promise<void> => {
    setState('busy');
    setError(null);
    try {
      await api.organisations.acceptInvitation(token);
      setState('done');
    } catch {
      // Unknown, expired, already used, and "not your address" are one answer:
      // distinguishing them would confirm which tokens are real.
      setError(t.inviteInvalid);
      setState('idle');
    }
  };

  return (
    <Main className="max-w-md py-12">
      <PageHeader title={t.inviteTitle} description={t.inviteDescription} />

      {status === 'loading' && <Spinner label={t.loading} />}

      {status === 'anonymous' && (
        <Card>
          <Alert tone="info">{t.inviteSignInFirst}</Alert>
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className={buttonVariants()}
            data-testid="invite-sign-in"
          >
            {t.navSignIn}
          </Link>
        </Card>
      )}

      {status === 'authenticated' &&
        (state === 'done' ? (
          <>
            <Alert tone="success" testId="invite-success">
              {t.inviteSuccess}
            </Alert>
            <Link href="/" className={buttonVariants()}>
              {t.navHome}
            </Link>
          </>
        ) : (
          <Card>
            {error !== null && <Alert tone="danger">{error}</Alert>}
            <Button
              variant="primary"
              className="h-11 w-full"
              data-testid="invite-accept"
              disabled={state === 'busy' || token === ''}
              onClick={() => void accept()}
            >
              <UserRoundPlus aria-hidden="true" />
              {state === 'busy' ? t.loading : t.inviteAccept}
            </Button>
          </Card>
        ))}
    </Main>
  );
}
