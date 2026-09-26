import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, pageOf } from './pagination';

const rows = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('pageOf', () => {
  it('reports an empty list as one empty page', () => {
    expect(pageOf([], 1)).toEqual({ rows: [], page: 1, pages: 1, from: 0, to: 0 });
  });
  it('slices the first page', () => {
    const p = pageOf(rows(45), 1);
    expect(p.rows).toHaveLength(PAGE_SIZE);
    expect(p).toMatchObject({ page: 1, pages: 2, from: 1, to: 25 });
  });
  it('slices the last partial page', () => {
    expect(pageOf(rows(45), 2)).toMatchObject({ page: 2, pages: 2, from: 26, to: 45 });
  });
  it('clamps a page past the end — a filter shrank the list while on page 2', () => {
    const p = pageOf(rows(3), 2);
    expect(p).toMatchObject({ page: 1, pages: 1, from: 1, to: 3 });
    expect(p.rows).toEqual([1, 2, 3]);
  });
  it('clamps a page below 1', () => {
    expect(pageOf(rows(10), 0).page).toBe(1);
  });
});
