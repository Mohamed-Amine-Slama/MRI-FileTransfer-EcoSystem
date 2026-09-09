/**
 * GENERATED — do not edit. Run:
 *   node apps/web/scripts/render-corridor-map.mjs ly-tn LY TN
 *
 * The route overlay for §Scene 03's map plate. Geometry derived from Natural
 * Earth 1:50m (naturalearthdata.com), public domain.
 *
 * Keyed by CORRIDOR ID so the scene that renders it names no country — brief
 * §4.3. Adding a corridor means running the script again, not editing a scene.
 */

export interface CorridorMap {
  /** The geography plate, served as a cacheable image. */
  image: string;
  viewBox: string;
  /** The transfer route, drawn on scroll. */
  route: string;
  /** [x, y] in viewBox units. */
  source: [number, number];
  destination: [number, number];
}

export const CORRIDOR_MAPS: Record<string, CorridorMap> = {
  "ly-tn": {
    "image": "/map/ly-tn.svg",
    "viewBox": "0 0 1200 675",
    "route": "M627.4 256.7 Q527.1 13.1 426.7 73",
    "source": [
      627.4,
      256.7
    ],
    "destination": [
      426.7,
      73
    ]
  }
};
