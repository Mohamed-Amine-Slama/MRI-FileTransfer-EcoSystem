'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Role } from '@mir/contracts';
import { ApiError, getAccessToken, refreshAccessToken, setAccessToken } from '../api/client';
import { api, type SessionUser } from '../api/endpoints';

/**
 * Renew ahead of the five-minute token expiry, so requests that cannot retry
 * on 401 themselves (Cornerstone's image XHRs) never go out with a dead token.
 */
const RENEW_EVERY_MS = 4 * 60_000;

/**
 * Client session state.
 *
 * WHAT THIS IS NOT: an authorization mechanism. Everything here is a hint for
 * rendering — which links to show, which page to redirect away from. The
 * decisions that matter are made twice on the server, by the route guard
 * (P4.2) and again by row-level security (ADR-6), neither of which trusts
 * anything the browser says. Treating this as security would mean a user who
 * edits their own memory gains access; they do not.
 *
 * The token is held in memory by the API client, so a reload requires a fresh
 * one from the identity provider — which /auth/refresh gets with the httpOnly
 * refresh cookie. See setAccessToken for why not localStorage.
 */

type Status = 'loading' | 'authenticated' | 'anonymous';

interface SessionContextValue {
  status: Status;
  user: SessionUser | null;
  role: Role | null;
  signInWithToken: (token: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  const load = useCallback(async () => {
    // After a reload the in-memory token is gone; the httpOnly refresh cookie
    // (set at sign-in, see lib/auth/keycloak-token.ts) mints a new one.
    if (getAccessToken() === null) await refreshAccessToken();
    // Still no token: the API authenticates by bearer only, so /me would be a
    // guaranteed 401. Skip the round trip — every signed-out page load paid it.
    if (getAccessToken() === null) {
      setUser(null);
      setStatus('anonymous');
      return;
    }
    try {
      const me = await api.session.me();
      setUser(me);
      setStatus('authenticated');
    } catch (err) {
      // A 401 is the normal anonymous case, not an error worth surfacing.
      // Anything else (the API being down) is also not something a visitor can
      // act on, so both land on "anonymous" and the screens handle it.
      if (!(err instanceof ApiError) || !err.isUnauthenticated) {
        console.warn('session lookup failed', err);
      }
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  // On mount, restore the token from the refresh cookie and, if one comes
  // back, ask the API who we are; otherwise render anonymous.
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const id = setInterval(() => void refreshAccessToken(), RENEW_EVERY_MS);
    return () => clearInterval(id);
  }, [status]);

  const signInWithToken = useCallback(
    async (token: string) => {
      setAccessToken(token);
      await load();
    },
    [load],
  );

  const signOut = useCallback(() => {
    // Revoke and clear the refresh cookie, or the next reload signs back in.
    void fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      role: user?.role ?? null,
      signInWithToken,
      signOut,
      refresh: load,
    }),
    [status, user, signInWithToken, signOut, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
