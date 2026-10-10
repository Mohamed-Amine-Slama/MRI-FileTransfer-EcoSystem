import { authedFetch } from '../viewer/authed-fetch';

/** What the API accepts; mirrors the CHECK in migration 0037. */
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png';
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Send one verification document as the raw file. Throws on any non-2xx. */
export async function uploadVerificationDocument(
  organisationId: string,
  key: string,
  file: File,
): Promise<void> {
  const res = await authedFetch(`/api/organisations/${organisationId}/documents/${key}`, {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!res.ok) throw new Error(String(res.status));
}

/** Ops: open an applicant's document in a new tab. */
export async function openVerificationDocument(organisationId: string, key: string): Promise<void> {
  const res = await authedFetch(`/api/admin/organisations/${organisationId}/documents/${key}`);
  if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  // The new tab has loaded it by then; the URL only pins memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
