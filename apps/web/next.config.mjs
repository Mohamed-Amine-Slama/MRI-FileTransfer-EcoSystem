import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Emit a self-contained server (apps/web/Dockerfile runs it directly) with
  // only the traced production dependencies, instead of requiring the full
  // workspace node_modules in the runtime image.
  output: 'standalone',

  // Pin the trace root to the monorepo. Without this, Next walks up and can
  // pick an unrelated lockfile outside the repo as the workspace root.
  // `output: 'standalone'` depends on this too: it decides the directory layout
  // of the emitted bundle, and an unrelated root would omit packages/*.
  outputFileTracingRoot: resolve(here, '../..'),

  // BUILD_SPEC §6 / P14.3: no internal detail in response headers.
  poweredByHeader: false,

  // Transpile workspace packages rather than requiring them to be prebuilt.
  transpilePackages: ['@mir/contracts'],

  /**
   * Cornerstone's DICOM image loader reaches for Node built-ins.
   *
   * `@cornerstonejs/dicom-image-loader` ships an HTJ2K decoder whose module
   * graph imports `fs`, which cannot resolve in a browser bundle. The import
   * is not reachable at runtime in the browser — it belongs to a code path
   * that only executes under Node — but webpack resolves the whole graph
   * statically and fails the build.
   *
   * Stubbing these to `false` for the CLIENT bundle only is the documented
   * fix. The server bundle keeps the real modules, so nothing server-side
   * loses filesystem access.
   */
  /*
   * THIS BLOCK IS WHY apps/web IS PINNED TO NEXT 15.
   *
   * Next 16 enables Turbopack by default, and Turbopack refuses to start when a
   * `webpack` config is present with no `turbopack` config — the build fails
   * outright ("This build is using Turbopack, with a `webpack` config"). Worse
   * than the failure would be silencing it: passing `turbopack: {}` makes the
   * build pass while IGNORING the fallbacks below, so `@cornerstonejs/dicom-image-loader`
   * pulls `fs` into the browser bundle and the DICOM viewer breaks — the one
   * screen with a hard 5-second performance gate (P9.1).
   *
   * Moving to Next 16 therefore means porting these fallbacks to Turbopack's
   * `resolveAlias` and re-running the viewer e2e suite, not merging a version
   * bump. `.github/dependabot.yml` already excludes `next` majors for this
   * reason; the 15 -> 16 bump predates that rule.
   */
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },

  /**
   * Route `/api/*` to the API when this build is told where the API is.
   *
   * lib/api/client.ts calls the API at the same origin under `/api`, and the
   * viewer builds `wadors:` ids against the same prefix (P8.2). In a deployed
   * environment Cloudflare owns that routing at the edge (P14.3) and Next never
   * sees the request, so API_ORIGIN is unset there and NO rewrite is emitted —
   * this block must not become a second, divergent copy of the edge's routing
   * table.
   *
   * It exists for the container stack, where compose sets API_ORIGIN to
   * http://api:3000. Same-origin is not a convenience: apiFetch sends
   * `credentials: 'include'`, and splitting the browser across two origins is
   * how those requests start arriving unauthenticated.
   *
   * The prefix is stripped because the API mounts its routes at the root — it
   * declares no global prefix, so /api/health must reach the API as /health.
   *
   * Read at BUILD time, not at container start: `next build` serialises the
   * resolved config into the standalone output. Repointing this means a
   * rebuild, not a restart.
   */
  async redirects() {
    // Empty, and deliberately so. This held one 308 from /doctor/availability
    // to /schedule/availability, back when the calendar absorbed the receiving
    // doctor's screen. Both ends of that redirect have since changed sides:
    // /schedule is gone, and /doctor/availability is a real page again — the
    // one switch that replaced the calendar. A redirect pointing at a deleted
    // route sends a bookmark to a 404 by a longer path than no redirect does.
    return [];
  },

  async rewrites() {
    const apiOrigin = process.env['API_ORIGIN'];
    if (apiOrigin === undefined || apiOrigin === '') return [];

    return [{ source: '/api/:path*', destination: `${apiOrigin}/:path*` }];
  },

  async headers() {
    // Baseline security headers. The authoritative set is enforced at the edge
    // by Cloudflare (P14.3); these exist so a local or misconfigured-edge
    // deployment is not bare. Duplication here is intentional defence in depth.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },

          /**
           * Content Security Policy.
           *
           * Built against what this app actually loads, not copied from a
           * template. Three directives are load-bearing and must not be
           * tightened without re-running the viewer e2e suite:
           *
           * - `'wasm-unsafe-eval'` — Cornerstone's HTJ2K/JPEG decoders are
           *   WebAssembly. This token permits WASM compilation and NOTHING
           *   else; it is specifically not `'unsafe-eval'`, which would also
           *   permit evaluating JavaScript from a string.
           * - `worker-src blob:` — the DICOM image loader decodes frames in
           *   workers created from blob URLs.
           * - `img-src blob:` — decoded frames reach the canvas the same way.
           *
           * `script-src 'unsafe-inline'` — THE KNOWN WEAKNESS, stated plainly.
           *
           * Next's App Router streams RSC payloads through inline
           * `<script>self.__next_f.push(...)</script>` tags. Without
           * `'unsafe-inline'` they are blocked and the application does not
           * hydrate at all — verified, not assumed: the full e2e suite fails
           * 44 of 52 with the tightened policy.
           *
           * The correct fix is a per-request nonce, and it was attempted. It
           * does not work here: Next stamps nonces only onto DYNAMICALLY
           * rendered pages, and these routes are statically prerendered, so
           * their HTML predates any nonce. Adopting it means forcing dynamic
           * rendering app-wide — a real architecture and performance decision,
           * not a config tweak, and one for a human to take deliberately.
           *
           * What limits the exposure meanwhile: this app contains no
           * `dangerouslySetInnerHTML`, no `innerHTML` assignment, no `eval`
           * and no `new Function` (asserted by the e2e suite). React escapes
           * every interpolation, so there is no known path by which attacker
           * markup reaches the document. `'unsafe-inline'` therefore removes a
           * layer of defence rather than opening a hole — but it is a removed
           * layer, and P14.3 stays PARTIAL because of it, alongside the
           * unconfigured Cloudflare edge.
           */
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },

          // No feature this app uses needs any of these. A compromised script
          // that cannot reach the camera or geolocation is a smaller problem.
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
              'magnetometer=(), gyroscope=(), accelerometer=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
