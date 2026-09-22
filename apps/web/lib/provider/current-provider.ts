'use client';

import { useEffect, useState } from 'react';
import type { CaseAudience, CaseSide, Provider, Role } from '@mir/contracts';
import { api } from '../api/endpoints';
import { isMockMode } from '../api/cases';
import { toProvider } from '../api/live/adapt';
import { casesApi } from '../api/mock';
import { sideForRole } from '../corridor/registry';
import { useSession } from '../session/session';

/**
 * Which provider organisation the signed-in user acts for.
 *
 * The identity backend has no notion of an organisation yet — `SessionUser`
 * carries a role, not a provider — so until it does, the role is mapped onto a
 * fixture organisation through the corridor side. This is the single place
 * that mapping lives, so replacing it with a real claim later touches one file
 * rather than every screen.
 *
 * It resolves by SIDE rather than by role name, so it does not become another
 * §4.3 violation while standing in.
 */
const PROVIDER_BY_SIDE: Partial<Record<CaseSide, string>> = {
  source: 'prov-source-1',
  destination: 'prov-dest-1',
};

export function providerIdForRole(role: Role | null): string | null {
  if (role === null) return null;
  const side = sideForRole(role);
  if (side === null) return null;
  return PROVIDER_BY_SIDE[side] ?? null;
}

export interface CurrentProvider {
  loading: boolean;
  providerId: string | null;
  provider: Provider | null;
  side: CaseSide | null;
}

export function useCurrentProvider(): CurrentProvider {
  const { role } = useSession();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [liveProviderId, setLiveProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const side = role === null ? null : sideForRole(role);
  const mock = isMockMode();
  // Mock mode maps a side onto a fixture organisation; live mode asks the API
  // which organisation the caller is actually seated in.
  const providerId = mock ? providerIdForRole(role) : liveProviderId;

  useEffect(() => {
    let cancelled = false;

    if (role === null || side === null || side === 'ops') {
      // Ops acts for no organisation; an unresolved session has none yet.
      setProvider(null);
      setLiveProviderId(null);
      setLoading(role === null);
      return;
    }

    setLoading(true);
    const resolve = mock
      ? (() => {
          const fixtureId = providerIdForRole(role);
          return fixtureId === null ? Promise.resolve(null) : casesApi.getProvider(fixtureId);
        })()
      : api.organisations.mine().then(({ organisation }) =>
          organisation === null ? null : toProvider(organisation),
        );

    void resolve
      .catch(() => null)
      .then((found) => {
        if (cancelled) return;
        setProvider(found);
        setLiveProviderId(found?.id ?? null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [role, side, mock]);

  return { loading, providerId, provider, side };
}

/**
 * What to pass to the case API as "who is asking" — brief §5.4 P0.
 *
 * Derived from the corridor SIDE, so ops is the only viewer that gets the
 * unrestricted audience and it is reached by being ops rather than by an
 * absent argument. Returns null while the session is still resolving: a
 * screen must wait rather than guess, because guessing here means guessing in
 * the direction of showing someone else's case.
 */
export function audienceFor(side: CaseSide | null, providerId: string | null): CaseAudience | null {
  if (side === 'ops') return { kind: 'ops' };
  if (providerId === null) return null;
  return { kind: 'provider', providerId };
}

export function useCaseAudience(): { audience: CaseAudience | null; loading: boolean } {
  const { side, providerId, loading } = useCurrentProvider();
  return { audience: audienceFor(side, providerId), loading };
}
