/**
 * Reject with `Error('timeout')` if `promise` has not settled within `ms`.
 *
 * The viewer's full-resolution upgrade must END — in an image or in the
 * preview with a message — rather than sit on "Loading full resolution…"
 * forever, which is what a doctor saw before 2026-09-21.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
