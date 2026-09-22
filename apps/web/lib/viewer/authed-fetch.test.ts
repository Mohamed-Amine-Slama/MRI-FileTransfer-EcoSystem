import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/client';
import { authHeaders, authedFetch } from './authed-fetch';

/**
 * The viewer's requests must carry the session's bearer token like every
 * other API call. They used to rely on a cookie this stack never sets, so every
 * DICOMweb request was unauthenticated and the viewer hung (spec 2026-09-21 §6).
 */
afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe('authHeaders', () => {
  it('carries the bearer token when signed in', () => {
    setAccessToken('tok-123');
    expect(authHeaders()).toEqual({ authorization: 'Bearer tok-123' });
  });

  it('is empty when there is no token', () => {
    expect(authHeaders()).toEqual({});
  });
});

describe('authedFetch', () => {
  it('sends the token, keeps caller headers, and includes credentials', async () => {
    setAccessToken('tok-456');
    const seen: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response('{}');
    });
    await authedFetch('/api/x', { headers: { accept: 'application/dicom+json' } });
    expect(seen[0]?.credentials).toBe('include');
    expect(seen[0]?.headers).toEqual({
      accept: 'application/dicom+json',
      authorization: 'Bearer tok-456',
    });
  });
});
