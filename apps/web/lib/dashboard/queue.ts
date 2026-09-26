/** Rows a dashboard queue shows before handing off to the full list. */
export const QUEUE_CAP = 5;

export function capQueue<T>(rows: readonly T[], cap: number = QUEUE_CAP): { shown: T[]; more: boolean } {
  return { shown: rows.slice(0, cap), more: rows.length > cap };
}
