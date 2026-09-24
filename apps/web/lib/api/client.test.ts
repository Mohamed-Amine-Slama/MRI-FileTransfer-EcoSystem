import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, setAccessToken } from './client';

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
