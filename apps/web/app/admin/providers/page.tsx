'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Provider } from '@mir/contracts';
import { casesApi } from '../../../lib/api/mock';
import { rolesForSides } from '../../../lib/corridor/registry';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { RoleGate } from '../../../components/RoleGate';
import {
  REJECTION_REASON_KEYS,
  isRejectionReasonKey,
  providerKindLabel,
  sideLabel,
  verificationLabel,
  verificationReasonLabel,
  verificationTone,
  type RejectionReasonKey,
} from '../../../components/case/labels';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Main,
  PageHeader,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui';

/**
 * Provider verification and directory — brief §5.8 and §5.1.
 *
 * The approval queue sits above the directory rather than being a filter on it,
 * because the queue is work and the directory is reference. An ops reviewer
 * opening this page has one question — what is waiting for me — and it should
 * not require a filter to answer.
 *
 * A REJECTION MUST CARRY A REASON, and the reason is a dictionary key chosen
 * from a fixed list, never free text. §4.2 makes an English sentence typed here
 * unreadable to an Arabic-speaking applicant, and §5.1 promises they can learn
 * where they stand without contacting us — which a blank rejection breaks.
 */
const OPS_ROLES = rolesForSides(['ops']);

export default function AdminProvidersPage(): React.JSX.Element {
  return (
    <RoleGate allow={OPS_ROLES}>
      <AdminProviders />
    </RoleGate>
  );
}

function AdminProviders(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const [queue, setQueue] = useState<Provider[] | null>(null);
  const [directory, setDirectory] = useState<Provider[]>([]);
  const [reasons, setReasons] = useState<Record<string, RejectionReasonKey>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pending, all] = await Promise.all([
        casesApi.listVerificationQueue(),
        casesApi.listProviders(),
      ]);
      setQueue(pending);
      setDirectory(all);
    } catch {
      setError(t.genericError);
      setQueue([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (provider: Provider, approve: boolean): Promise<void> => {
    setBusy(provider.id);
    setError(null);
    try {
      const reasonKey = reasons[provider.id];
      // Approvals carry no reason; rejections default to the first listed one
      // rather than being sent blank, so the applicant always sees something
      // actionable on their verification page.
      await casesApi.decideVerification(
        provider.id,
        approve,
        approve ? undefined : (reasonKey ?? REJECTION_REASON_KEYS[0]),
      );
      await load();
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(null);
    }
  };

  if (queue === null) {
    return (
      <Main>
        <Spinner label={t.loading} />
      </Main>
    );
  }

  const needle = search.trim().toLowerCase();
  const matching =
    needle === ''
      ? directory
      : directory.filter((provider) => provider.legalName.toLowerCase().includes(needle));

  return (
    <Main wide>
      <PageHeader title={t.adminProvidersTitle} description={t.adminProvidersDescription} />

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <Card>
        <h2 className="mb-3 font-display text-lg font-medium">{t.adminQueueTitle}</h2>
        {queue.length === 0 ? (
          <EmptyState testId="queue-empty">{t.adminQueueEmpty}</EmptyState>
        ) : (
          <ul className="space-y-3" data-testid="verification-queue">
            {queue.map((provider) => (
              <li key={provider.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{provider.legalName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {providerKindLabel(t, provider.kind)} · {sideLabel(t, provider.side)} ·{' '}
                      {t.verificationSubmittedAt} {formatDate(provider.verification.submittedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      className="h-9 w-auto"
                      aria-label={t.verificationReason}
                      data-testid={`reason-${provider.id}`}
                      value={reasons[provider.id] ?? REJECTION_REASON_KEYS[0]}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!isRejectionReasonKey(value)) return;
                        setReasons((prev) => ({ ...prev, [provider.id]: value }));
                      }}
                    >
                      {REJECTION_REASON_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {verificationReasonLabel(t, key)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy === provider.id}
                      data-testid={`reject-${provider.id}`}
                      onClick={() => void decide(provider, false)}
                    >
                      <X className="size-4" />
                      {t.adminReject}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy === provider.id}
                      data-testid={`approve-${provider.id}`}
                      onClick={() => void decide(provider, true)}
                    >
                      <Check className="size-4" />
                      {t.adminApprove}
                    </Button>
                  </div>
                </div>

                {/* The submitted credentials, so a reviewer decides on the
                    evidence rather than on the organisation's name. Keys come
                    from the corridor's documentRequirements (§4.3). */}
                <dl className="mt-3 grid gap-x-6 gap-y-1 border-t pt-3 sm:grid-cols-2">
                  {Object.entries(provider.verification.credentials).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{key}</dt>
                      <dd className="text-sm">
                        <bdi>{String(value)}</bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-lg font-medium">{t.adminProvidersTitle}</h2>
        {/* §5.8 P1. Matches the legal name, which is the only thing an ops
            user has when a clinic calls in — they do not know our ids. */}
        <div className="mb-3 max-w-sm">
          <Field label={t.search}>
            <Input
              value={search}
              data-testid="provider-search"
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
        {matching.length === 0 ? (
          <EmptyState testId="directory-empty">{t.casesNoMatch}</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colProvider}</TableHead>
                <TableHead>{t.colKind}</TableHead>
                <TableHead>{t.signUpSide}</TableHead>
                <TableHead>{t.colSeats}</TableHead>
                <TableHead>{t.colVerification}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matching.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.legalName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {providerKindLabel(t, provider.kind)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sideLabel(t, provider.side)}
                  </TableCell>
                  <TableCell>{provider.seatCount}</TableCell>
                  <TableCell>
                    <Badge tone={verificationTone(provider.verification.status)}>
                      {verificationLabel(t, provider.verification.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Main>
  );
}
