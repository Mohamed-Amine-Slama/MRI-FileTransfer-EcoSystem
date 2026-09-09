#!/usr/bin/env node
/**
 * The corridor map plate — Landing-Page-Specs §Scene 03.
 *
 * "A flat, topographic plate of the coastline in `--c-line` hairlines on void
 * — no satellite imagery, no 3D globe. Use a hairline projection you generate
 * from open data (Natural Earth), not a screenshot of a map product. It must
 * be geographically accurate to a level that a local person will not laugh at."
 *
 * §2.1 explains why this is a flat plate and not the obvious thing: "glowing
 * arc between two cities on a dark globe" is the single most reused visual in
 * enterprise tech, and border imagery in this region is loaded besides. A
 * hairline coastline is informative rather than triumphal.
 *
 * ---------------------------------------------------------------------------
 * ONE SVG PER CORRIDOR, NAMED BY CORRIDOR ID.
 *
 * Brief §4.3 forbids UI copy, routing, or business logic that assumes a
 * specific corridor. The map is geography, so it cannot avoid being specific —
 * but the COMPONENT can: it loads `/map/${corridor.id}.svg` and names nothing.
 * Configuring a second corridor means running this script again with a new id,
 * not editing a scene.
 * ---------------------------------------------------------------------------
 *
 * Source: Natural Earth 1:50m, public domain (naturalearthdata.com). Recorded
 * in the generated file's own <metadata> so provenance travels with the asset.
 *
 *   node apps/web/scripts/render-corridor-map.mjs ly-tn LY TN
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SOURCES = {
  countries:
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  land: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson',
};

const [, , corridorId = 'ly-tn', ...codes] = process.argv;
const COUNTRIES = codes.length > 0 ? codes : ['LY', 'TN'];

/** The plate's aspect. 16:9 matches every other plate on the page. */
const VIEW = { width: 1200, height: 675 };
/** Degrees of padding around the corridor's own bounding box. */
const PAD = 2.2;
/** Douglas-Peucker tolerance, in projected units. Tuned by eye against size. */
const TOLERANCE = 1.1;

// ---------------------------------------------------------------------------
// Fetch (cached beside the script's output so a rebuild needs no network)
// ---------------------------------------------------------------------------

async function load(url, cacheName) {
  const cache = join(WEB_ROOT, '.map-cache', cacheName);
  try {
    return JSON.parse(readFileSync(cache, 'utf8'));
  } catch {
    // Not cached yet.
  }
  process.stdout.write(`fetching ${cacheName}…\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, text);
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Every ring of a Polygon or MultiPolygon, as flat arrays of [lon, lat]. */
function rings(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

function isoOf(feature) {
  const p = feature.properties;
  const iso = p.ISO_A2 === '-99' ? p.ISO_A2_EH : p.ISO_A2;
  return iso;
}

/**
 * Equirectangular, with the x axis scaled by cos(mean latitude).
 *
 * At 30–38°N a plain lon/lat plot stretches everything east–west by about 20%,
 * which is exactly the kind of thing §Scene 03 says a local person will laugh
 * at. One cosine fixes it, and at this extent the residual error is smaller
 * than the hairline is wide.
 */
function makeProjection(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);

  const spanX = (maxLon - minLon) * kx;
  const spanY = maxLat - minLat;
  const scale = Math.min(VIEW.width / spanX, VIEW.height / spanY);

  const offsetX = (VIEW.width - spanX * scale) / 2;
  const offsetY = (VIEW.height - spanY * scale) / 2;

  return ([lon, lat]) => [
    offsetX + (lon - minLon) * kx * scale,
    // SVG y grows downward; latitude grows upward.
    offsetY + (maxLat - lat) * scale,
  ];
}

/** Perpendicular distance from p to the segment a-b, and to a when a === b. */
function perpendicular(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length;
}

/** Douglas-Peucker on an OPEN polyline. A coastline at full 50m detail is
 *  roughly 40× the bytes this page needs. */
function simplifyOpen(points, tolerance) {
  if (points.length < 3) return points;

  let maxDistance = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicular(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= tolerance) return [first, last];

  return [
    ...simplifyOpen(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyOpen(points.slice(index), tolerance),
  ];
}

/**
 * Douglas-Peucker on a CLOSED ring.
 *
 * The naive version collapses every island to a dot, and does it silently.
 * On a closed ring the first and last points coincide, so the "line" the
 * algorithm measures perpendicular distance against has zero length and every
 * distance comes out as zero — the whole coastline reduces to `M x y L x y Z`
 * and the map renders empty. The ring is therefore cut at the vertex FURTHEST
 * from its start, and the two halves are simplified as open polylines.
 */
function simplify(ring, tolerance) {
  const points = ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;

  if (points.length < 4) return points;

  const start = points[0];
  let far = 1;
  let farDistance = -1;
  for (let i = 1; i < points.length; i++) {
    const distance = Math.hypot(points[i][0] - start[0], points[i][1] - start[1]);
    if (distance > farDistance) {
      farDistance = distance;
      far = i;
    }
  }

  return [
    ...simplifyOpen(points.slice(0, far + 1), tolerance).slice(0, -1),
    ...simplifyOpen(points.slice(far), tolerance),
  ];
}

/** Smallest island worth a path, in projected units. Below this it is a
 *  speck that costs bytes and reads as dirt on the plate. */
const MIN_RING = 3;

/**
 * Clip a projected ring to the visible plate, as open polylines.
 *
 * Without this the file is 47 KB rather than 3, because a coastline that
 * merely touches the view — a continent's outline, say — is carried in whole
 * and then clipped away by the viewBox at render time. The bytes still ship.
 *
 * Runs that leave the plate are simply cut, which turns closed rings into open
 * strokes. That is the correct result: what is being drawn here is a
 * coastline, and a coastline that runs off the edge of a plate should end at
 * the edge rather than close on itself across the sea.
 */
function clipRuns(points, margin) {
  const inside = ([x, y]) =>
    x >= -margin && x <= VIEW.width + margin && y >= -margin && y <= VIEW.height + margin;

  const runs = [];
  let current = [];

  for (const point of points) {
    if (inside(point)) {
      current.push(point);
    } else {
      // Keep the first point outside, so the stroke reaches the edge instead
      // of stopping short of it.
      if (current.length > 0) {
        current.push(point);
        runs.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0) runs.push(current);

  return runs.filter((run) => run.length >= 2);
}

/** Context coastline: clipped, simplified, and open. */
function toContextPaths(ring, project, tolerance) {
  const round = (n) => Math.round(n * 10) / 10;

  return clipRuns(ring.map(project), 24)
    .map((run) => simplifyOpen(run, tolerance))
    .filter((run) => {
      const xs = run.map(([x]) => x);
      const ys = run.map(([, y]) => y);
      return (
        Math.max(...xs) - Math.min(...xs) >= MIN_RING ||
        Math.max(...ys) - Math.min(...ys) >= MIN_RING
      );
    })
    .map(
      (run) =>
        `M${round(run[0][0])} ${round(run[0][1])}` +
        run.slice(1).map(([x, y]) => `L${round(x)} ${round(y)}`).join(''),
    );
}

function toPath(ring, project, tolerance) {
  const projected = simplify(ring.map(project), tolerance);
  if (projected.length < 3) return '';

  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  if (
    Math.max(...xs) - Math.min(...xs) < MIN_RING &&
    Math.max(...ys) - Math.min(...ys) < MIN_RING
  ) {
    return '';
  }

  const round = (n) => Math.round(n * 10) / 10;
  return (
    `M${round(projected[0][0])} ${round(projected[0][1])}` +
    projected
      .slice(1)
      .map(([x, y]) => `L${round(x)} ${round(y)}`)
      .join('') +
    'Z'
  );
}

/**
 * A representative marker point for a country: the centroid of its NORTHERN
 * coastal vertices.
 *
 * Not the label anchor, which for a large desert country sits hundreds of
 * kilometres from anyone. Both endpoints of this corridor are Mediterranean —
 * the clinics, the scanners and the patients are all on the coast — so
 * averaging the vertices in the top fifth of the country's latitude range puts
 * each marker where the medicine actually is, without this script having to
 * know the name of a single city.
 */
function coastalMarker(feature) {
  const points = rings(feature.geometry).flat();
  const lats = points.map(([, lat]) => lat);
  const threshold = Math.max(...lats) - (Math.max(...lats) - Math.min(...lats)) * 0.2;
  const northern = points.filter(([, lat]) => lat >= threshold);
  const sample = northern.length > 0 ? northern : points;

  const lon = sample.reduce((sum, [x]) => sum + x, 0) / sample.length;
  const lat = sample.reduce((sum, [, y]) => sum + y, 0) / sample.length;

  /*
   * Snap to the nearest vertex of the country's own outline.
   *
   * The centroid of the northern coast is usually a few kilometres offshore —
   * a bay's mouth averages out into the water — and a marker floating in the
   * sea is exactly what §Scene 03 means by something a local person will laugh
   * at. Snapping puts it on the coastline itself.
   */
  let best = sample[0];
  let bestDistance = Infinity;
  for (const point of sample) {
    const distance = Math.hypot(point[0] - lon, point[1] - lat);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------

const countries = await load(SOURCES.countries, 'ne_50m_admin_0_countries.geojson');
const land = await load(SOURCES.land, 'ne_50m_land.geojson');

const selected = COUNTRIES.map((code) => {
  const feature = countries.features.find((f) => isoOf(f) === code);
  if (feature === undefined) throw new Error(`no Natural Earth feature for ${code}`);
  return { code, feature };
});

// Bounding box of the corridor's countries, padded.
const all = selected.flatMap(({ feature }) => rings(feature.geometry).flat());
const bbox = [
  Math.min(...all.map(([x]) => x)) - PAD,
  Math.min(...all.map(([, y]) => y)) - PAD,
  Math.max(...all.map(([x]) => x)) + PAD,
  Math.max(...all.map(([, y]) => y)) + PAD,
];

const project = makeProjection(bbox);

const inBox = ([lon, lat]) =>
  lon >= bbox[0] - 1 && lon <= bbox[2] + 1 && lat >= bbox[1] - 1 && lat <= bbox[3] + 1;

/*
 * Context land: every coastline that intersects the view, so the corridor sits
 * in a real sea rather than floating on black. Rings entirely outside the box
 * are dropped before projection — otherwise a Saharan neighbour's full outline
 * is carried through the whole pipeline to end up clipped away.
 */
const context = land.features
  .flatMap((f) => rings(f.geometry))
  .filter((ring) => ring.some(inBox))
  .flatMap((ring) => toContextPaths(ring, project, TOLERANCE * 1.6));

const outlines = selected.map(({ code, feature }) => ({
  code,
  paths: rings(feature.geometry)
    .map((ring) => toPath(ring, project, TOLERANCE))
    .filter((d) => d !== ''),
  marker: project(coastalMarker(feature)).map((n) => Math.round(n * 10) / 10),
}));


/*
 * Two artefacts, and the split is deliberate.
 *
 *   public/map/<id>.svg          the geography — an <img>, cached once by the
 *                                browser and shared across every locale route.
 *   lib/site/corridor-map…ts     the route and the two node positions, which
 *                                the scene draws as an inline overlay because
 *                                the line has to be animated by scroll.
 *
 * Inlining the geography instead would put ~10 KB into each of six prerendered
 * HTML files (three locales × two routes) to save one cacheable request. The
 * overlay is ~150 bytes, so it goes the other way.
 *
 * COLOURS ARE BAKED INTO THE SVG. An external SVG loaded through <img> is an
 * independent document: it cannot see `--c-line` or any other custom property
 * from the page, and `var(--c-line)` there resolves to nothing at all — an
 * invisible map, on every browser, with no error anywhere. The values below
 * are §3.1's, copied deliberately.
 */
const C_LINE = '#1E272F';
const C_ASH = '#93A0AC';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.width} ${VIEW.height}" fill="none" role="presentation">
<metadata>Coastline and administrative outlines derived from Natural Earth 1:50m (naturalearthdata.com), public domain. Generated by apps/web/scripts/render-corridor-map.mjs — do not edit by hand.</metadata>
<g stroke="${C_LINE}" stroke-width="1.25">
${context.map((d) => `<path d="${d}"/>`).join('\n')}
</g>
<g stroke="${C_ASH}" stroke-width="1.25" opacity="0.62">
${outlines.flatMap((o) => o.paths).map((d) => `<path d="${d}"/>`).join('\n')}
</g>
</svg>
`;

const out = join(WEB_ROOT, 'public', 'map');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${corridorId}.svg`), svg);

/*
 * The route: a quadratic arc bowed towards the sea between the two nodes.
 *
 * Bowed, not straight, and only slightly — §2.1 rejected the glowing-arc-on-a-
 * globe cliché, so this is a line with just enough curve to read as a path
 * rather than as a measurement.
 */
const [source, destination] = outlines;
const control = [
  (source.marker[0] + destination.marker[0]) / 2,
  Math.min(source.marker[1], destination.marker[1]) -
    Math.hypot(
      destination.marker[0] - source.marker[0],
      destination.marker[1] - source.marker[1],
    ) * 0.22,
];

const overlay = {
  [corridorId]: {
    image: `/map/${corridorId}.svg`,
    viewBox: `0 0 ${VIEW.width} ${VIEW.height}`,
    route:
      `M${source.marker[0]} ${source.marker[1]} ` +
      `Q${Math.round(control[0] * 10) / 10} ${Math.round(control[1] * 10) / 10} ` +
      `${destination.marker[0]} ${destination.marker[1]}`,
    source: source.marker,
    destination: destination.marker,
  },
};

const module_ = `/**
 * GENERATED — do not edit. Run:
 *   node apps/web/scripts/render-corridor-map.mjs ${corridorId} ${COUNTRIES.join(' ')}
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

export const CORRIDOR_MAPS: Record<string, CorridorMap> = ${JSON.stringify(overlay, null, 2)};
`;

writeFileSync(join(WEB_ROOT, 'lib', 'site', 'corridor-map.generated.ts'), module_);

const bytes = Buffer.byteLength(svg);
console.log(
  `${corridorId}.svg: ${(bytes / 1024).toFixed(1)} KB ` +
    `(budget 18 KB) ${bytes <= 18432 ? 'OK' : 'OVER'} · ` +
    `${context.length} context strokes, ${outlines.flatMap((o) => o.paths).length} corridor rings`,
);
console.log(`lib/site/corridor-map.generated.ts written for "${corridorId}"`);
if (bytes > 18432) process.exitCode = 1;
