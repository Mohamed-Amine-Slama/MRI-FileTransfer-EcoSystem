import { getAccessToken, withTokenRetry } from '../api/client';

/**
 * Authentication for the viewer's requests — spec 2026-09-21 §6.
 *
 * WHY THE VIEWER NEEDS ITS OWN HELPER. Every other screen calls the API through
 * `apiFetch`, which attaches the session's bearer token and parses JSON. The
 * viewer's responses are not JSON — image blobs, DICOM JSON, multipart frames —
 * so it used raw `fetch(..., { credentials: 'include' })`, a plain `<img src>`
 * and Cornerstone's own XHR. All three relied on a session COOKIE, and this
 * stack keeps the token in memory (lib/api/client.ts) and sets no cookie. Every
 * DICOMweb request therefore went out unauthenticated and 401'd, and the viewer
 * sat on its placeholder: the "rendering the MRI image" hang.
 *
 * `credentials: 'include'` stays, so a deployment whose edge DOES carry a
 * session cookie keeps working; the bearer header is added alongside it.
 */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

/** Headers are rebuilt per attempt, so the retry after a 401 carries the renewed token. */
export function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return withTokenRetry(() =>
    fetch(url, {
      ...init,
      credentials: 'include',
      headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders() },
    }),
  );
}
