import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './endpoints';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('paged lists', () => {
  it('follows nextCursor until the API says there is no more', async () => {
    const pages: Record<string, unknown> = {
      '/api/patients': { patients: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' },
      '/api/patients?cursor=b': { patients: [{ id: 'c' }], nextCursor: null },
    };
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(pages[url]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { patients } = await api.patients.list();

    expect(patients.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an existing query string when adding the cursor', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('cursor=') ? { cases: [{ id: 'y' }], nextCursor: null } : { cases: [{ id: 'x' }], nextCursor: 'x' },
        ),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cases } = await api.cases.list({ from: '2026-01-01' });

    expect(cases.map((c) => c.id)).toEqual(['x', 'y']);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/cases?from=2026-01-01&cursor=x');
  });
});
