import { NextResponse } from 'next/server';
import {
  clearRefreshCookie,
  keycloakTokenUrl,
  readRefreshCookie,
  setRefreshCookie,
  webClientId,
} from '../../../lib/auth/keycloak-token';

/**
 * Trades the httpOnly refresh cookie for a fresh access token.
 *
 * The session layer calls this on page load, when the in-memory token is gone.
 * Every refusal is the same 401 and clears the cookie: a refresh token Keycloak
 * refused (expired, revoked, idle-timed-out) will not start working on a retry.
 * Keycloak rotates refresh tokens, so the new one replaces the cookie.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const tokenUrl = keycloakTokenUrl();
  const refreshToken = readRefreshCookie(request);

  const refused = (): NextResponse => {
    const res = NextResponse.json({ error: 'no_session' }, { status: 401 });
    clearRefreshCookie(res);
    return res;
  };

  if (tokenUrl === undefined || refreshToken === undefined) return refused();

  let upstream: Response;
  try {
    upstream = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: webClientId(),
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Keycloak unreachable is not "your session ended": keep the cookie so the
    // next load can try again.
    return NextResponse.json({ error: 'identity_provider_unreachable' }, { status: 502 });
  }

  if (!upstream.ok) return refused();

  const tokens = (await upstream.json()) as {
    access_token?: string;
    refresh_token?: string;
    refresh_expires_in?: number;
  };
  if (typeof tokens.access_token !== 'string') return refused();

  const res = NextResponse.json({ accessToken: tokens.access_token });
  if (typeof tokens.refresh_token === 'string') {
    setRefreshCookie(res, request, tokens.refresh_token, tokens.refresh_expires_in);
  }
  return res;
}
