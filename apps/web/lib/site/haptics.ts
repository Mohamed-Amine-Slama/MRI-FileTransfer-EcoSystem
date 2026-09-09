/**
 * Haptics — Landing-Page-Specs §2.2 channel 6.
 *
 * TWO MOMENTS IN THE WHOLE PAGE: the consent stamp landing, and the upload
 * completing. Nothing else, ever.
 *
 * §2.2's restraint rule is the reason: "A site where everything reacts to
 * everything feels cheap. A site where one moment reaches out and touches you
 * is what people remember and screenshot." A page that buzzes on every scroll
 * milestone is a page people put down.
 *
 * Gated three ways, all of which must hold:
 *   - the device supports `navigator.vibrate` (Android and Samsung Internet;
 *     iOS Safari does not, and will not);
 *   - the user has already interacted, because a vibration without a gesture
 *     is blocked by the browser and is hostile besides;
 *   - motion is not reduced. A vestibular preference is a preference about
 *     the body, and a haptic is the most physical thing on the page.
 */

const MOMENTS = ['consent-stamp', 'upload-complete'] as const;
export type HapticMoment = (typeof MOMENTS)[number];

/** One short tick. §2.2 specifies 8 ms — a tap, not a buzz. */
const PATTERN = [8];

/*
 * `Navigator.vibrate` is declared as REQUIRED by lib.dom, and it is simply
 * absent on iOS Safari. Widening the type would conflict with the built-in
 * declaration, so the check is a runtime `in` test and the call goes through
 * the narrowed alias below.
 */
type Vibrate = (pattern: number | number[]) => boolean;

function vibrateFn(): Vibrate | null {
  if (typeof navigator === 'undefined') return null;
  if (!('vibrate' in navigator)) return null;
  const fn: unknown = navigator.vibrate;
  return typeof fn === 'function' ? (fn.bind(navigator) as Vibrate) : null;
}

export function hapticsAvailable(): boolean {
  return vibrateFn() !== null;
}

/**
 * Fire one of the two permitted moments.
 *
 * `expressive` comes from the tier budget: false on Tier C, which is where a
 * reduced-motion preference lands. The moment name is a parameter rather than
 * documentation so that the type system is what limits this to two callers —
 * adding a third means editing `MOMENTS`, which is a visible decision rather
 * than a line someone slipped into a scroll handler.
 */
export function haptic(moment: HapticMoment, expressive: boolean): void {
  if (!expressive) return;
  if (!MOMENTS.includes(moment)) return;

  const vibrate = vibrateFn();
  if (vibrate === null) return;

  try {
    vibrate(PATTERN);
  } catch {
    // Some in-app WebViews expose the method and reject the call. Nothing to
    // do about it, and nothing that should reach the user.
  }
}
