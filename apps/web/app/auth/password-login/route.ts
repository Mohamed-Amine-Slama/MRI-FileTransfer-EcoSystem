import { NextResponse } from 'next/server';
import { keycloakTokenUrl, setRefreshCookie, webClientId } from '../../../lib/auth/keycloak-token';

/**
 * Email + password sign-in, relayed to Keycloak's token endpoint (ROPC).
 *
 * P4.1 still holds: this route OWNS NO CREDENTIALS. It forwards exactly one
 * password grant to Keycloak and returns the access token; password policy,
 * lockout, and brute-force protection all remain Keycloak's, and nothing is
 * persisted or logged here. The OIDC redirect stays the production path —
 * this exists so a local or interim deployment has a usable sign-in form
 * instead of a paste-a-JWT box.
 *
 * Failures are deliberately indistinguishable: "no such account", "wrong
 * password", and "account disabled" all return the same 401, because telling
 * them apart turns the form into an account-enumeration oracle.
 *
 * Configuration (runtime env, read per request — nothing is baked at build):
 *   KEYCLOAK_ISSUER_URL   required. The issuer the API validates; the token
 *                         endpoint is derived from it.
 *   KEYCLOAK_TOKEN_URL    optional override for split-horizon setups where
 *                         the web server reaches Keycloak at an internal
 *                         address (compose: http://keycloak:8080/…) while the
 *                         issuer stays the browser-visible one. Requires the
 *                         issuer to be pinned on Keycloak (KC_HOSTNAME), or
 *                         the minted token's `iss` will not match.
 *   KEYCLOAK_WEB_CLIENT_ID optional, default mir-web.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const tokenUrl = keycloakTokenUrl();

  if (tokenUrl === undefined) {
    return NextResponse.json({ error: 'password_login_not_configured' }, { status: 501 });
  }

  let email: string;
  let password: string;
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new Error();
    email = body.email.trim();
    password = body.password;
    if (email === '' || password === '') throw new Error();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: webClientId(),
        scope: 'openid',
        username: email,
        password,
      }),
      // A hung identity provider must fail the sign-in, not the tab.
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({ error: 'identity_provider_unreachable' }, { status: 502 });
  }

  if (!upstream.ok) {
    // Collapse every upstream 4xx into one answer (no enumeration); anything
    // else is the identity provider misbehaving, which is not the user's fault.
    const status = upstream.status >= 400 && upstream.status < 500 ? 401 : 502;
    return NextResponse.json(
      { error: status === 401 ? 'invalid_credentials' : 'identity_provider_error' },
      { status },
    );
  }

  const tokens = (await upstream.json()) as {
    access_token?: string;
    refresh_token?: string;
    refresh_expires_in?: number;
  };
  if (typeof tokens.access_token !== 'string') {
    return NextResponse.json({ error: 'identity_provider_error' }, { status: 502 });
  }

  // Only the access token crosses back to page scripts; the session layer keeps
  // it in memory (never localStorage — see lib/api/client.ts). The refresh
  // token goes into an httpOnly cookie so a reload can mint a new access token
  // through /auth/refresh (see lib/auth/keycloak-token.ts).
  const res = NextResponse.json({ accessToken: tokens.access_token });
  if (typeof tokens.refresh_token === 'string') {
    setRefreshCookie(res, request, tokens.refresh_token, tokens.refresh_expires_in);
  }
  return res;
}
