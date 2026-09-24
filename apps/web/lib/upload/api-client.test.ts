import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../api/client';
import { createUploadApi } from './api-client';

/**
 * Every upload request must carry the session's bearer token. The client used
 * to rely on a cookie this stack never sets, so after a password sign-in
 * `POST /uploads` answered 401 and no study could be sent — the same bug the
 * viewer had (lib/viewer/authed-fetch.ts).
 */
afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

function captureFetch(body: unknown = {}): RequestInit[] {
  const seen: RequestInit[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    seen.push(init);
    return new Response(JSON.stringify(body));
  });
  return seen;
}

describe('createUploadApi', () => {
  it('sends the bearer token on the JSON endpoints', async () => {
    setAccessToken('tok-up');
    const seen = captureFetch({ sessionId: 's1' });
    const api = createUploadApi();
    await api.createSession('p1', 3);
    await api.completeFile('f1');
    expect(seen).toHaveLength(2);
    for (const init of seen) {
      expect(init.credentials).toBe('include');
      expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer tok-up' });
    }
  });

  it('sends the bearer token on chunk uploads', async () => {
    setAccessToken('tok-chunk');
    const seen = captureFetch();
    await createUploadApi().sendChunk('f1', 0, new Uint8Array([1, 2, 3]));
    expect(seen[0]?.headers).toEqual({
      'content-type': 'application/octet-stream',
      authorization: 'Bearer tok-chunk',
    });
  });

  it('adds no authorization header when signed out', async () => {
    const seen = captureFetch({ sessionId: 's1' });
    await createUploadApi().createSession('p1', 1);
    expect(seen[0]?.headers).toEqual({ 'content-type': 'application/json' });
  });
});
