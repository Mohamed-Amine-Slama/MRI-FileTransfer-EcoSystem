import type { NextResponse } from 'next/server';

/**
 * Server-only helpers shared by the /auth route handlers.
 *
 * THE REFRESH COOKIE is what lets a reload keep the session. The access token
 * still lives in memory only (lib/api/client.ts); what survives a reload is
 * Keycloak's refresh token, in a cookie page scripts cannot read (httpOnly),
 * that is never sent cross-site (SameSite=Strict), and only to /auth (Path), so
 * no API request ever carries it. Before this, every reload, typed URL or new
 * tab signed the user out.
 */
export const REFRESH_COOKIE = 'mir_rt';

/** Keycloak's token endpoint, or undefined when sign-in is not configured. */
export function keycloakTokenUrl(): string | undefined {
  const issuer = process.env['KEYCLOAK_ISSUER_URL'];
  return (
    process.env['KEYCLOAK_TOKEN_URL'] ??
    (issuer === undefined || issuer === ''
      ? undefined
      : `${issuer.replace(/\/$/, '')}/protocol/openid-connect/token`)
  );
}

export function webClientId(): string {
  return process.env['KEYCLOAK_WEB_CLIENT_ID'] ?? 'mir-web';
}

/** Keycloak's refresh-token revocation (logout) endpoint, next to the token endpoint. */
export function keycloakLogoutUrl(): string | undefined {
  return keycloakTokenUrl()?.replace(/\/token$/, '/logout');
}

export function setRefreshCookie(
  res: NextResponse,
  request: Request,
  token: string,
  maxAgeSeconds: number | undefined,
): void {
  res.cookies.set(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    // Secure whenever the page itself is https; a plain-http localhost stack
    // would otherwise never get the cookie back.
    secure: new URL(request.url).protocol === 'https:',
    path: '/auth',
    // Keycloak says how long the refresh token lives; the cookie must not
    // outlive it. Without the hint, a session cookie (dies with the browser).
    ...(maxAgeSeconds !== undefined && maxAgeSeconds > 0 ? { maxAge: maxAgeSeconds } : {}),
  });
}

export function clearRefreshCookie(res: NextResponse): void {
  res.cookies.set(REFRESH_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/auth', maxAge: 0 });
}

/** The Cookie header's refresh token, if any. */
export function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) {
      const value = rest.join('=');
      return value === '' ? undefined : decodeURIComponent(value);
    }
  }
  return undefined;
}
