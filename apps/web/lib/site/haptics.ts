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

interface VibratingNavigator extends Navigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

export function hapticsAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof (navigator as VibratingNavigator).vibrate === 'function';
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
  if (!hapticsAvailable()) return;
  if (!MOMENTS.includes(moment)) return;

  try {
    (navigator as VibratingNavigator).vibrate?.(PATTERN);
  } catch {
    // Some in-app WebViews expose the method and reject the call. Nothing to
    // do about it, and nothing that should reach the user.
  }
}
