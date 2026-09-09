import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../shared/config/config.schema';
import { OrthancHttpClient } from './orthanc.http-client';

function config(): AppConfig {
  return {
    ORTHANC_URL: 'http://orthanc.internal:8042',
    ORTHANC_USERNAME: 'mir-api',
    ORTHANC_PASSWORD: 'secret',
  } as unknown as AppConfig;
}

interface Call {
  url: string;
  method: string;
  body: string | undefined;
}

/** Records every request and answers with the queued responses, in order. */
function stubFetch(responder: (call: Call) => Response): {
  calls: Call[];
  restore: () => void;
} {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const call = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    return Promise.resolve(responder(call));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OrthancHttpClient.lookupStudy', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  it('returns the study resource id', async () => {
    const stub = stubFetch(() => json([{ Type: 'Study', ID: 'study-abc' }]));
    restore = stub.restore;

    const id = await new OrthancHttpClient(config()).lookupStudy('1.2.3');

    expect(id).toBe('study-abc');
    expect(stub.calls[0]?.url).toBe('http://orthanc.internal:8042/tools/lookup');
    expect(stub.calls[0]?.method).toBe('POST');
    expect(stub.calls[0]?.body).toBe('1.2.3');
  });

  it('ignores non-study rows rather than taking the first', async () => {
    // /tools/lookup answers for series and instance UIDs from the same call.
    // Taking rows[0] blindly would hand a SERIES id to a study endpoint.
    restore = stubFetch(() =>
      json([
        { Type: 'Series', ID: 'series-xyz' },
        { Type: 'Study', ID: 'study-abc' },
      ]),
    ).restore;

    expect(await new OrthancHttpClient(config()).lookupStudy('1.2.3')).toBe('study-abc');
  });

  it('returns null when Orthanc knows nothing about the uid', async () => {
    restore = stubFetch(() => json([])).restore;
    expect(await new OrthancHttpClient(config()).lookupStudy('1.2.3')).toBeNull();
  });
});

describe('OrthancHttpClient.anonymiseStudy', () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  it('creates the twin and reads back its fresh StudyInstanceUID', async () => {
    const stub = stubFetch((call) =>
      call.url.endsWith('/anonymize')
        ? json({ ID: 'twin-1', FailedInstancesCount: 0 })
        : json({ MainDicomTags: { StudyInstanceUID: '1.2.276.0.7230010.99' } }),
    );
    restore = stub.restore;

    const twin = await new OrthancHttpClient(config()).anonymiseStudy('study-abc', { Keep: [] });

    expect(twin).toEqual({
      orthancId: 'twin-1',
      studyInstanceUid: '1.2.276.0.7230010.99',
      failedInstances: 0,
    });
    // The read-back is a second round trip and is not optional: the anonymise
    // response carries no StudyInstanceUID, and the UID is what every
    // doctor-facing route resolves against.
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]?.url).toBe('http://orthanc.internal:8042/studies/twin-1');
  });

  it('reports failed instances rather than swallowing them', async () => {
    restore = stubFetch((call) =>
      call.url.endsWith('/anonymize')
        ? json({ ID: 'twin-1', FailedInstancesCount: 3 })
        : json({ MainDicomTags: { StudyInstanceUID: '1.2.9' } }),
    ).restore;

    const twin = await new OrthancHttpClient(config()).anonymiseStudy('study-abc', {});
    expect(twin.failedInstances).toBe(3);
  });

  it('throws when the twin has no StudyInstanceUID, rather than storing an empty one', async () => {
    restore = stubFetch((call) =>
      call.url.endsWith('/anonymize')
        ? json({ ID: 'twin-1' })
        : json({ MainDicomTags: {} }),
    ).restore;

    await expect(
      new OrthancHttpClient(config()).anonymiseStudy('study-abc', {}),
    ).rejects.toThrow(/no StudyInstanceUID/);
  });

  it('throws when Orthanc refuses the anonymisation', async () => {
    restore = stubFetch(() => json({ error: 'nope' }, 500)).restore;
    await expect(
      new OrthancHttpClient(config()).anonymiseStudy('study-abc', {}),
    ).rejects.toThrow(/anonymise failed: 500/);
  });
});
