/**
 * "The load curtain has lifted" — a one-shot signal, spec 2026-09-10 §4.4.
 *
 * The hero's entrance waits for it so the reveal is not spent under the
 * curtain. `S00Load` lifts it on every animating tier: at once for a repeat
 * visit, or when the curtain finishes. Tier C never waits on it, because Tier C
 * never animates.
 */

let lifted = false;
const listeners = new Set<() => void>();

export function liftCurtain(): void {
  if (lifted) return;
  lifted = true;
  for (const listener of listeners) listener();
  listeners.clear();
}

/** Run `fn` when the curtain lifts — immediately if it already has. Returns an unsubscribe. */
export function onCurtainLifted(fn: () => void): () => void {
  if (lifted) {
    fn();
    return () => {};
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function curtainLifted(): boolean {
  return lifted;
}

/** Module state survives between test cases; this is the reset. */
export function resetCurtainForTests(): void {
  lifted = false;
  listeners.clear();
}
