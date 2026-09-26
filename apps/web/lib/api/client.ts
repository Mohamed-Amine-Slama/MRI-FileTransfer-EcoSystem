/**
 * HTTP client for the MIR API.
 *
 * ONE PLACE THAT KNOWS HOW TO CALL THE API, for the same reason the viewer
 * builds its `wadors:` URLs in one place (P8.2): every request to patient data
 * must be authorised and audited by the API, and a second ad-hoc fetch helper
 * is how a request eventually goes out without credentials — succeeding
 * anonymously if anything upstream is misconfigured, and leaving no audit row.
 *
 * Errors are typed rather than thrown as bare `Error`. Screens need to
 * distinguish "your session expired" from "that slot was taken" from "the
 * server broke", and matching on message strings is not a way to do that.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 409 — a genuine conflict, e.g. a slot taken by another patient (P10.2). */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /**
   * 404 covers "does not exist" AND "exists but you cannot see it" — §6
   * requires that these be indistinguishable, so the UI must not claim the
   * record is missing. It says "not available to you".
   */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export const API_BASE = '/api';

/** Set by the session layer. Kept in memory only — never localStorage. */
let accessToken: string | null = null;

/**
 * Access tokens live in memory, not localStorage.
 *
 * A bearer token in localStorage is readable by any script that reaches the
 * page, which turns one XSS into a full session takeover against records that
 * are Article 9 special-category data. In memory it dies with the tab, and the
 * cost is a token refresh after a reload — which the identity provider does
 * anyway.
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/*
 * One refresh in flight at a time. StrictMode mounts effects twice, and two
 * concurrent refreshes with the same rotating refresh token can have Keycloak
 * revoke the session between them.
 */
let refreshing: Promise<void> | null = null;

/**
 * Trades the httpOnly refresh cookie for a new access token.
 *
 * Access tokens live five minutes (realm accessTokenLifespan). Called on page
 * load, on a timer by the session layer, and on a 401 by the request helpers —
 * without the last two every screen, upload and viewer request started
 * failing five minutes after the page loaded.
 */
export function refreshAccessToken(): Promise<void> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) return;
      const { accessToken: token } = (await res.json()) as { accessToken?: unknown };
      if (typeof token === 'string') setAccessToken(token);
    } catch {
      // Offline or the route is missing: keep whatever token we had.
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * Runs `request` and, if it was refused with 401 while we held a token, renews
 * the token once and runs it again. A 401 is refused before any handler runs,
 * so replaying a POST here cannot double it.
 */
export async function withTokenRetry<R extends { status: number }>(request: () => Promise<R>): Promise<R> {
  const sentWith = accessToken;
  const first = await request();
  if (first.status !== 401 || sentWith === null) return first;
  if (accessToken === sentWith) await refreshAccessToken();
  if (accessToken === null || accessToken === sentWith) return first;
  return request();
}

/** A request that hangs forever leaves a spinner forever; 30s is generous for JSON. */
const REQUEST_TIMEOUT_MS = 30_000;

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (signal === undefined) return timeout;
  // Older browsers lack AbortSignal.any; the caller's own signal wins there.
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Sent on non-idempotent calls the user could double-submit. */
  idempotencyKey?: string;
}

/**
 * Identical GETs in flight share one request — spec 2026-09-21 §8. Two hooks
 * that both need the caller's organisation on mount used to cost two round
 * trips on every screen. The key carries the bearer token, so a request
 * started for one session is never answered to the next; each caller parses
 * its own copy of the body, so one screen mutating its result cannot change
 * another's. Writes, and requests with their own abort signal, never merge.
 */
const inflight = new Map<string, Promise<{ status: number; text: string }>>();

async function send(path: string, options: RequestOptions): Promise<{ status: number; text: string }> {
  const { method = 'GET', body, signal, idempotencyKey } = options;

  // Built per attempt so a retry after a token refresh carries the new token.
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken !== null) headers['authorization'] = `Bearer ${accessToken}`;
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    signal: withTimeout(signal),
    // Cookies too: the edge may carry the session as a cookie while the API
    // reads a bearer token. Sending both keeps the client working under either
    // arrangement instead of silently 401ing when the deployment changes.
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: res.status === 204 ? '' : await res.text() };
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', signal } = options;
  const attempt = (): Promise<{ status: number; text: string }> =>
    withTokenRetry(() => send(path, options));

  let pending: Promise<{ status: number; text: string }>;
  if (method === 'GET' && signal === undefined) {
    const key = `${accessToken ?? ''} ${path}`;
    const shared = inflight.get(key);
    if (shared !== undefined) {
      pending = shared;
    } else {
      pending = attempt().finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
  } else {
    pending = attempt();
  }
  const { status, text } = await pending;

  if (status === 204) return undefined as T;

  const parsed: unknown = text === '' ? null : safeJson(text);

  if (status < 200 || status >= 300) {
    throw new ApiError(status, parsed, extractMessage(parsed) ?? `${method} ${path} failed`);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON error body (an edge 502 page, say) must not turn into a
    // parse exception that hides the real status code from the caller.
    return text;
  }
}

function extractMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string') return message;
    // Nest's ValidationPipe returns an array of messages.
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return null;
}

/**
 * Idempotency key for actions that move money or create appointments.
 *
 * A patient on a flaky Libyan link WILL tap "confirm" twice. Without a key,
 * that is two authorisations against one card, or two bookings.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
