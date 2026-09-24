import { NextResponse } from 'next/server';
import {
  clearRefreshCookie,
  keycloakLogoutUrl,
  readRefreshCookie,
  webClientId,
} from '../../../lib/auth/keycloak-token';

/**
 * Ends the session: revokes the refresh token at Keycloak and clears the cookie.
 *
 * Clearing the cookie alone would leave a still-valid refresh token wherever it
 * had been copied; revoking it alone would leave a dead cookie. The revoke is
 * best-effort: an unreachable Keycloak must not keep the user signed in here.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const logoutUrl = keycloakLogoutUrl();
  const refreshToken = readRefreshCookie(request);

  if (logoutUrl !== undefined && refreshToken !== undefined) {
    try {
      await fetch(logoutUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: webClientId(), refresh_token: refreshToken }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Best-effort; the cookie is cleared regardless.
    }
  }

  const res = new NextResponse(null, { status: 204 });
  clearRefreshCookie(res);
  return res;
}
