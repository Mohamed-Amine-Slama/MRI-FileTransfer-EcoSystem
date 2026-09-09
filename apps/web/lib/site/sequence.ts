/**
 * The hero slice sequence, as numbers both the renderer and the player agree
 * on — Landing-Page-Specs §6.5.
 *
 * `scripts/render-slices.mjs` writes the frames and `ScrubCanvas` reads them.
 * If those two disagree about how many there are, the canvas requests a file
 * that does not exist and the last frames of the scrub go blank — a failure
 * that only appears at the bottom of the hero, on a real connection, and
 * therefore never in review. `sequence.test.ts` counts the files on disk
 * against this table so the disagreement fails the build instead.
 */

export const SEQUENCE = {
  basePath: '/seq/hero',
  poster: '/seq/hero/poster.avif',
  /** Frames per tier directory. Tier C loads none — the poster is the hero. */
  frames: { a: 36, b: 24 },
  /** Intrinsic size of a frame, and therefore of the canvas backing store. */
  width: 1280,
  height: 720,
} as const;

/** Zero-padded frame filename, matching what the render script writes. */
export function framePath(dir: 'a' | 'b', index: number): string {
  return `${SEQUENCE.basePath}/${dir}/${String(index + 1).padStart(4, '0')}.avif`;
}

/**
 * Load order: first, last, middle, then recursively bisect — §6.5.
 *
 * This matters more than the total frame count. A user who scrolls fast on a
 * slow connection sees a stepping approximation of the whole volume rather
 * than a blank rectangle that fills in from the top, because every scroll
 * position has a nearby loaded frame almost immediately.
 */
export function bisectOrder(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];

  const out = [0, n - 1];
  const seen = new Set(out);
  const queue: [number, number][] = [[0, n - 1]];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    const [lo, hi] = next;
    const mid = Math.floor((lo + hi) / 2);
    if (mid === lo || mid === hi || seen.has(mid)) continue;
    seen.add(mid);
    out.push(mid);
    queue.push([lo, mid], [mid, hi]);
  }

  return out;
}
