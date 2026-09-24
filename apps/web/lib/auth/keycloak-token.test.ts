import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { REFRESH_COOKIE, readRefreshCookie, setRefreshCookie } from './keycloak-token';

const req = (cookie?: string, url = 'http://localhost/auth/refresh'): Request =>
  new Request(url, { method: 'POST', headers: cookie === undefined ? {} : { cookie } });

describe('refresh cookie', () => {
  it('reads the token among other cookies, keeping "=" inside the value', () => {
    expect(readRefreshCookie(req(`a=1; ${REFRESH_COOKIE}=abc.def==; b=2`))).toBe('abc.def==');
  });

  it('treats a missing or emptied cookie as no session', () => {
    expect(readRefreshCookie(req())).toBeUndefined();
    expect(readRefreshCookie(req(`${REFRESH_COOKIE}=`))).toBeUndefined();
  });

  it('is httpOnly, strict, scoped to /auth, and Secure only over https', () => {
    const http = NextResponse.json({});
    setRefreshCookie(http, req(), 'tok', 1800);
    const set = http.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=strict/i);
    expect(set).toMatch(/Path=\/auth/);
    expect(set).toMatch(/Max-Age=1800/);
    expect(set).not.toMatch(/Secure/i);

    const https = NextResponse.json({});
    setRefreshCookie(https, req(undefined, 'https://mir.example/auth/refresh'), 'tok', 1800);
    expect(https.headers.get('set-cookie')).toMatch(/Secure/i);
  });
});
