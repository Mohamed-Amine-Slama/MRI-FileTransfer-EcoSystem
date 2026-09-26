import { isTerminalStatus, type CaseStatus } from '@mir/contracts';

/**
 * A live case with no recorded movement for this long is flagged "stale".
 *
 * Cases carry no due date the whole platform agrees on (spec 2026-09-25 D3), so
 * age since the last update is the honest signal: it says "nobody has touched
 * this", not "this is late".
 */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isStale(c: { status: CaseStatus; updatedAt: string }, now: number): boolean {
  if (isTerminalStatus(c.status)) return false;
  const at = Date.parse(c.updatedAt);
  return !Number.isNaN(at) && now - at > STALE_AFTER_MS;
}

export function isWithinDays(iso: string | null | undefined, days: number, now: number): boolean {
  if (iso === null || iso === undefined) return false;
  const at = Date.parse(iso);
  return !Number.isNaN(at) && now - at <= days * DAY_MS;
}

/** Same calendar day in the viewer's own time zone — "opened today". */
export function isSameLocalDay(iso: string, now: number): boolean {
  const a = new Date(iso);
  const b = new Date(now);
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** "5 hr. ago" in the given BCP-47 locale: minutes under an hour, hours under a day, then days. */
export function relativeAge(iso: string, now: number, locale: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}
