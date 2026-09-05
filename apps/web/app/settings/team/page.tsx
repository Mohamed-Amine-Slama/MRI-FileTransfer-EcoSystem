'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRoundPlus } from 'lucide-react';
import { SEAT_ROLES, hasSeatAvailable, type Membership, type SeatRole } from '@mir/contracts';
import { ApiError } from '../../../lib/api/client';
import { api, type Organisation } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import type { Dictionary } from '../../../lib/i18n/dictionary';
import { PROVIDER_ROLES } from '../../../lib/corridor/registry';
import { useSession } from '../../../lib/session/session';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Meter,
  Select,
  Separator,
  Spinner,
} from '../../../components/ui';

/**
 * Seats — brief §5.5 P1 ("team/multi-seat access within a single clinic
 * account"), the row the audit marked partially shipped.
 *
 * THE SEAT COUNT INCLUDES OUTSTANDING INVITATIONS. That is `hasSeatAvailable`'s
 * whole job: counting accepted members alone lets an owner send eleven
 * invitations against ten seats and have the eleventh person be refused when
 * they accept — blaming the invitee for the inviter's mistake. The database
 * re-checks on acceptance regardless, because seats can be lowered afterwards.
 *
 * There is no "remove member" control yet. Nothing in this system grants DELETE
 * to the application (see 0002_rls.up.sql), so revocation is a state change
 * that needs designing rather than a button that quietly does nothing.
 */
export default function TeamSettings(): React.JSX.Element {
  return (
    <ProviderOnly>
      <TeamPanel />
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

function seatRoleLabel(t: Dictionary, seatRole: SeatRole): string {
  const labels: Record<SeatRole, string> = {
    owner: t.seatOwner,
    member: t.seatMember,
    assistant: t.seatAssistant,
  };
  return labels[seatRole];
}

function TeamPanel(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const { user } = useSession();

  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [seatRole, setSeatRole] = useState<SeatRole>('member');
  const [specialty, setSpecialty] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WHICH SEATS THIS PERSON MAY OFFER.
  //
  // An owner may issue any of them. A seated clinician may issue an ASSISTANT
  // seat and nothing else, because an owner/member seat becomes a clinical role
  // on acceptance — the difference between hiring a receptionist and staffing
  // the corridor without an ops decision.
  //
  // This is presentation only. `invitations_clinician_assistant_insert`
  // (migration 0018) refuses the write regardless of what is rendered, which is
  // what actually holds the line (§4.4).
  const mySeat = members.find((m) => m.userId === user?.userId)?.seatRole ?? null;
  const isOwner = mySeat === 'owner';
  const offerableSeats: readonly SeatRole[] = isOwner ? SEAT_ROLES : ['assistant'];

  const load = useCallback(async (): Promise<void> => {
    try {
      const { organisation: found } = await api.organisations.mine();
      setOrganisation(found);
      if (found !== null) {
        const { members: rows } = await api.organisations.members(found.id);
        setMembers(rows);
      }
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

  const invite = async (): Promise<void> => {
    if (organisation === null) return;
    setBusy(true);
    setSent(false);
    setError(null);
    try {
      await api.organisations.invite(organisation.id, {
        email: email.trim(),
        seatRole,
        // Only meaningful for a clinician seat. Sending it for an assistant
        // would record a specialty for somebody who does not practise.
        ...(seatRole === 'assistant' || specialty.trim() === ''
          ? {}
          : { specialty: specialty.trim() }),
      });
      setEmail('');
      setSpecialty('');
      setSent(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.isConflict ? t.teamNoSeats : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label={t.loading} />;

  if (organisation === null) {
    return <EmptyState testId="team-no-org">{t.teamNoOrganisation}</EmptyState>;
  }

  // Outstanding invitations are not listed by the API (the token must never
  // leave the server), so availability is computed from what is knowable here:
  // seats filled against the limit. The server is the authority and refuses
  // with a conflict if an invitation would overshoot.
  const seatsFree = hasSeatAvailable(organisation.seatCount, members.length, 0);

  return (
    <div className="space-y-4">
      <Card title={t.teamTitle}>
        <p className="text-sm text-muted-foreground">{t.teamDescription}</p>
        <Meter
          label={t.teamSeats}
          used={members.length}
          limit={organisation.seatCount}
          unlimitedLabel={t.billingUnlimited}
          testId="team-seats"
        />
      </Card>

      <Card title={t.teamInvite}>
        {(error !== null || loadFailed) && <Alert tone="danger">{error ?? t.genericError}</Alert>}
        {sent && (
          <Alert tone="success" testId="team-invite-sent">
            {t.teamInviteSent}
          </Alert>
        )}
        {!seatsFree && <Alert tone="warning">{t.teamNoSeats}</Alert>}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void invite();
          }}
        >
          <Field label={t.teamInviteEmail}>
            <Input
              data-testid="invite-email"
              type="email"
              value={email}
              dir="ltr"
              inputMode="email"
              spellCheck={false}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label={t.teamInviteRole} hint={t.seatOwnerHint}>
            <Select
              data-testid="invite-seat-role"
              className="max-w-xs"
              value={seatRole}
              onChange={(e) => {
                const next = offerableSeats.find((r) => r === e.target.value);
                if (next !== undefined) setSeatRole(next);
              }}
            >
              {offerableSeats.map((value) => (
                <option key={value} value={value}>
                  {seatRoleLabel(t, value)}
                </option>
              ))}
            </Select>
          </Field>

          {seatRole !== 'assistant' && (
            <Field label={t.teamInviteSpecialty} hint={t.teamInviteSpecialtyHint}>
              <Input
                data-testid="invite-specialty"
                className="max-w-xs"
                value={specialty}
                maxLength={120}
                onChange={(e) => setSpecialty(e.target.value)}
              />
            </Field>
          )}

          {!isOwner && (
            <p className="text-sm text-muted-foreground" data-testid="assistant-only-hint">
              {t.teamAssistantOnlyHint}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            data-testid="invite-submit"
            disabled={busy || email.trim() === '' || !seatsFree}
          >
            <UserRoundPlus aria-hidden="true" />
            {busy ? t.loading : t.teamInviteSend}
          </Button>
        </form>
      </Card>

      <Card title={t.teamMembers}>
        {members.length === 0 ? (
          <EmptyState testId="team-empty">{t.teamEmpty}</EmptyState>
        ) : (
          <ul className="divide-y">
            {members.map((member, index) => (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 py-3">
                {index > 0 && <Separator className="sr-only" />}
                <Avatar name={member.displayName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.displayName}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    <bdi>{member.email}</bdi>
                  </p>
                </div>
                <Badge tone={member.seatRole === 'owner' ? 'info' : undefined}>
                  {seatRoleLabel(t, member.seatRole)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDate(member.acceptedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
