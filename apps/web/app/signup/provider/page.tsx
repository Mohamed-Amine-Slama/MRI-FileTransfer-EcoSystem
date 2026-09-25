'use client';

import Link from '../../../components/ui/link';
import { useState } from 'react';
import {
  ENDPOINT_SIDES,
  endpointSideSchema,
  providerKindSchema,
  providerKindsForSide,
  type EndpointSide,
  type ProviderKind,
} from '@mir/contracts';
import { api, type Organisation } from '../../../lib/api/endpoints';
import { CORRIDORS, DEFAULT_CORRIDOR_ID, getCorridor } from '../../../lib/corridor/registry';
import { useLocale, useT } from '../../../lib/i18n/provider';
import { countryName } from '../../../lib/corridor/country-name';
import { CorridorFields, validateFields } from '../../../components/case/CorridorFields';
import { providerKindLabel, sideLabel } from '../../../components/case/labels';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Main,
  PageHeader,
  Select,
  buttonVariants,
} from '../../../components/ui';

/**
 * Provider sign-up — brief §5.1.
 *
 * §3 asks for two distinct provider paths and no admin path. Both are here as
 * ONE form with a side selector rather than two routes, because the difference
 * between them is entirely data: which side of the corridor you sit on decides
 * which credential documents you are asked for, and that list comes from the
 * corridor registry (§4.3). Two hand-written forms would have to be edited
 * every time a corridor is added; this one does not.
 *
 * Admin is absent by construction, not by a hidden option: `EndpointSide`
 * excludes `ops`, so there is no value of this form that creates platform
 * staff. The notice says so, because a clinic administrator looking for their
 * own account needs to be told where to go, not left hunting.
 */
export default function ProviderSignUpPage(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const [corridorId, setCorridorId] = useState(DEFAULT_CORRIDOR_ID);
  const [side, setSide] = useState<EndpointSide>('source');
  const [kind, setKind] = useState<ProviderKind>('clinic');
  const [legalName, setLegalName] = useState('');
  const [seatCount, setSeatCount] = useState('1');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Organisation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const corridor = getCorridor(corridorId);
  // The document requirements are the corridor's, per side. This screen never
  // learns what a licensing body is called or which country issues it.
  const requirements = corridor === null ? [] : corridor[side].documentRequirements;

  const setCredential = (key: string, value: string): void => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const submit = async (): Promise<void> => {
    if (corridor === null) return;
    const found = validateFields(requirements, credentials, t.required);
    if (legalName.trim() === '') found['legalName'] = t.required;
    const seats = Number(seatCount);
    if (!Number.isInteger(seats) || seats < 1) found['seatCount'] = t.required;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setError(t.caseNewValidationFailed);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // The REAL endpoint, not the case layer's fixture store. An organisation
      // is an account-layer record (migration 0010) and has to survive a
      // reload — an application that vanished when the tab closed would be a
      // worse failure than one that never submitted.
      setCreated(
        await api.organisations.create({
          kind,
          legalName: legalName.trim(),
          corridorId,
          side,
          credentials,
          seatCount: seats,
        }),
      );
    } catch {
      setError(t.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  if (created !== null) {
    return (
      <Main>
        <PageHeader title={t.signUpProviderTitle} />
        <Alert tone="success" testId="signup-success">
          {t.signUpSuccess}
        </Alert>
        {/* Straight to the status page: §5.1 asks that an applicant can see
            where their application stands without contacting anyone. */}
        <Card>
          <p className="text-sm text-muted-foreground">{t.verificationPendingBody}</p>
          <div className="mt-4">
            <Link href="/verification" className={buttonVariants()}>
              {t.verificationTitle}
            </Link>
          </div>
        </Card>
      </Main>
    );
  }

  return (
    <Main>
      <PageHeader title={t.signUpProviderTitle} description={t.signUpProviderDescription} />

      <Alert tone="info" testId="admin-notice">
        {t.signUpAdminNotice}
      </Alert>
      {error !== null && <Alert tone="danger">{error}</Alert>}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t.signUpCorridor}>
          <Select
            value={corridorId}
            data-testid="field-corridor"
            onChange={(e) => {
              setCorridorId(e.target.value);
              // Credentials are corridor-specific; carrying them across would
              // submit one corridor's licence number against another's rules.
              setCredentials({});
              setErrors({});
            }}
          >
            {CORRIDORS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={`${t.signUpSide} *`}>
          <Select
            value={side}
            data-testid="field-side"
            onChange={(e) => {
              const parsed = endpointSideSchema.safeParse(e.target.value);
              if (!parsed.success) return;
              setSide(parsed.data);
              // The kind list is per side (§2): a Tunisian applicant can only be
              // a doctor, so a kind carried over from the other side is reset.
              setKind(providerKindsForSide(parsed.data)[0] ?? 'clinic');
              setCredentials({});
              setErrors({});
            }}
          >
            {ENDPOINT_SIDES.map((value) => (
              <option key={value} value={value}>
                {corridor === null
                  ? sideLabel(t, value)
                  : `${countryName(corridor[value].country, locale)} — ${sideLabel(t, value)}`}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          The choice, read back in the applicant's own words.

          Side and kind are two selectors because the corridor decides which
          credentials are asked for — but what a person is choosing is one
          thing: "a hospital on the Libyan side". Saying so removes the step
          where they have to combine two dropdowns in their head to check they
          picked the right one. The country comes from the corridor registry via
          Intl, never from copy, so a second corridor states itself (§4.3).
        */}
        <p className="text-sm text-muted-foreground" data-testid="applying-as">
          {t.signUpApplyingAs}:{' '}
          <span className="font-medium text-foreground">
            {corridor === null
              ? providerKindLabel(t, kind)
              : `${countryName(corridor[side].country, locale)} · ${providerKindLabel(t, kind)}`}
          </span>
        </p>

        <Field label={`${t.signUpOrgName} *`} error={errors['legalName'] ?? null}>
          <Input
            value={legalName}
            data-testid="field-legal-name"
            invalid={errors['legalName'] !== undefined}
            onChange={(e) => {
              setLegalName(e.target.value);
              setErrors((prev) => {
                const { legalName: _removed, ...rest } = prev;
                return rest;
              });
            }}
          />
        </Field>

        <Field label={t.signUpOrgKind}>
          <Select
            value={kind}
            data-testid="field-kind"
            onChange={(e) => {
              const parsed = providerKindSchema.safeParse(e.target.value);
              if (parsed.success) setKind(parsed.data);
            }}
          >
            {providerKindsForSide(side).map((value) => (
              <option key={value} value={value}>
                {providerKindLabel(t, value)}
              </option>
            ))}
          </Select>
        </Field>

        {/* §5.5 multi-seat: the seat count is agreed at registration, because
            the account is an organisation and not a person. */}
        <Field label={`${t.signUpSeats} *`} error={errors['seatCount'] ?? null}>
          <Input
            type="number"
            min={1}
            value={seatCount}
            data-testid="field-seats"
            invalid={errors['seatCount'] !== undefined}
            onChange={(e) => setSeatCount(e.target.value)}
          />
        </Field>

        <CorridorFields
          fields={requirements}
          values={credentials}
          errors={errors}
          onChange={setCredential}
        />

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" disabled={submitting} data-testid="submit-signup">
            {submitting ? t.loading : t.signUpSubmit}
          </Button>
          <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
            {t.navSignIn}
          </Link>
        </div>
      </form>
    </Main>
  );
}
