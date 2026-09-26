export const PAGE_SIZE = 25;

/**
 * One page of an already-loaded list. The page is clamped, so a filter that
 * shrinks the list under the reader never leaves them on an empty page.
 *
 * ponytail: client paging over a fully loaded list; move to server paging when
 * a provider's list exceeds a few hundred rows.
 */
export function pageOf<T>(
  rows: readonly T[],
  page: number,
  size: number = PAGE_SIZE,
): { rows: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pages,
    from: slice.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}
