import { authedFetch } from '../viewer/authed-fetch';
import type { UploaderApi } from './uploader';

/**
 * HTTP client for the upload endpoints.
 *
 * Chunks are sent as raw octet-stream bodies rather than multipart: multipart
 * adds base64-ish overhead and a parse step on both ends for no benefit when
 * the payload is a single opaque blob. On a constrained uplink that overhead
 * is real money.
 *
 * Every request carries the session's bearer token, read per request — the
 * same bug the viewer had (see lib/viewer/authed-fetch.ts): this stack keeps
 * the token in memory and sets no cookie, so `credentials: 'include'` alone
 * sent every upload unauthenticated and `POST /uploads` answered 401.
 * authedFetch also renews the five-minute token on a 401, which a long study
 * transfer always outlives.
 */
export function createUploadApi(baseUrl = '/api'): UploaderApi {
  async function json<T>(path: string, init: RequestInit): Promise<T> {
    const res = await authedFetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async createSession(patientId, expectedFileCount) {
      return json('/uploads', {
        method: 'POST',
        body: JSON.stringify({ patientId, expectedFileCount }),
      });
    },

    async registerFile(input) {
      return json(`/uploads/${input.sessionId}/files`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    async sendChunk(fileId, chunkIndex, data) {
      const res = await authedFetch(`${baseUrl}/uploads/files/${fileId}/chunks/${chunkIndex}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        // Copy into a fresh ArrayBuffer: `data` is usually a subarray view over
        // a much larger buffer, and passing the view sends the WHOLE backing
        // buffer. That turns a 64 KiB chunk into a multi-megabyte request.
        body: data.slice().buffer as ArrayBuffer,
      });
      if (!res.ok) throw new Error(`chunk ${chunkIndex} failed: ${res.status}`);
    },

    async completeFile(fileId) {
      await json(`/uploads/files/${fileId}/complete`, { method: 'POST' });
    },
  };
}
