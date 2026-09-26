import { z } from 'zod';

/**
 * Keyset pagination for the lists that grow with use (cases, patients).
 *
 * The cursor is the id of the last row the caller received. The query then
 * compares against THAT row's own (created_at, id) in the database, rather
 * than a timestamp echoed through the client: created_at has microseconds and
 * a JS Date has milliseconds, so a timestamp cursor would skip or repeat rows
 * created in the same millisecond. RLS applies to the lookup like any read, so
 * a cursor naming someone else's row simply matches nothing.
 *
 * The 500 default keeps today's clients (which read one page and expect
 * everything) correct for any realistic account, while bounding what one
 * request can cost the database and the 30s statement timeout.
 */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(500),
  cursor: z.string().uuid().optional(),
});

export interface PageRequest {
  limit: number;
  /** Rows strictly after this id in the list's order. */
  after?: string;
}

/**
 * Callers fetch `limit + 1` rows: the extra one only says whether another page
 * exists, and is never returned.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
  };
}
