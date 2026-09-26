import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getAccessToken, setAccessToken } from './client';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('apiFetch — identical GETs in flight', () => {
  it('share one request, and each caller gets its own copy', async () => {
    const fetchMock = vi.fn(async () => json({ organisation: { id: 'o1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([
      apiFetch<{ organisation: { id: string } }>('/organisations/mine'),
      apiFetch<{ organisation: { id: string } }>('/organisations/mine'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('asks again once the first answer is back', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/x');
    await apiFetch('/x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never merges across two sessions', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('token-a');
    const first = apiFetch('/organisations/mine');
    setAccessToken('token-b');
    const second = apiFetch('/organisations/mine');
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never merges writes, nor a request that carries its own abort signal', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([
      apiFetch('/cases', { method: 'POST', body: {} }),
      apiFetch('/cases', { method: 'POST', body: {} }),
    ]);
    const ctrl = new AbortController();
    await Promise.all([apiFetch('/y', { signal: ctrl.signal }), apiFetch('/y', { signal: ctrl.signal })]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('still rejects every merged caller with the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"nope"}', { status: 404 })));
    const results = await Promise.allSettled([apiFetch('/z'), apiFetch('/z')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect((results[0] as PromiseRejectedResult).reason).toMatchObject({ status: 404 });
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ status: 404 });
  });
});

describe('apiFetch — expired token', () => {
  /** API answers 200 only to `valid`; /auth/refresh answers with `refreshTo`, or 401 when null. */
  function stubAuth(refreshTo: string | null) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/auth/refresh') {
        return refreshTo === null
          ? new Response('{}', { status: 401 })
          : json({ accessToken: refreshTo });
      }
      const auth = (init?.headers as Record<string, string>)['authorization'];
      return auth === 'Bearer valid' ? json({ ok: true }) : new Response('{}', { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('renews the token once on 401 and replays the request with it', async () => {
    const fetchMock = stubAuth('valid');
    setAccessToken('expired');
    await expect(apiFetch('/cases', { method: 'POST', body: {} })).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/cases', '/auth/refresh', '/api/cases']);
    expect(getAccessToken()).toBe('valid');
  });

  it('surfaces the 401 when the session cannot be renewed', async () => {
    const fetchMock = stubAuth(null);
    setAccessToken('expired');
    await expect(apiFetch('/cases')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not try to renew when signed out', async () => {
    const fetchMock = stubAuth('valid');
    await expect(apiFetch('/cases')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it('every request carries a timeout, so a dead link cannot hang a screen forever', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({}));
  vi.stubGlobal('fetch', fetchMock);
  await apiFetch('/x');
  const init = fetchMock.mock.calls[0]?.[1];
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});
