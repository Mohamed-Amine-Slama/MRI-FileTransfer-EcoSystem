/**
 * The phantom CT imagery the landing page still shows — S05's consent
 * thumbnails (three frames of the Tier B set) and S06's viewer poster.
 *
 * `scripts/render-slices.mjs` writes the files and `tier.test.ts` counts them
 * against this table, so a disagreement fails the build rather than leaving a
 * blank thumbnail on a real connection.
 */

export const SEQUENCE = {
  basePath: '/seq/hero',
  poster: '/seq/hero/poster.avif',
  frames: { b: 24 },
  /** Intrinsic size of the poster. */
  width: 1280,
  height: 720,
} as const;

/** Zero-padded frame filename, matching what the render script writes. */
export function framePath(dir: 'b', index: number): string {
  return `${SEQUENCE.basePath}/${dir}/${String(index + 1).padStart(4, '0')}.avif`;
}
