import { authedFetch } from '../viewer/authed-fetch';

/** Save the submitted report's PDF. Throws on any non-2xx, for the caller to show. */
export async function downloadReportPdf(caseId: string, caseRef: string): Promise<void> {
  const res = await authedFetch(`/api/cases/${caseId}/report.pdf`);
  if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${caseRef}-report.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
