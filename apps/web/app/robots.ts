import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '../lib/site/entity';

/**
 * Landing-Page-Specs §10, and BUILD_SPEC's privacy posture.
 *
 * The marketing locales are open. Everything that requires a session is
 * disallowed — not as a security control (robots.txt is a request, not a
 * boundary; the real control is row-level security and the session gate), but
 * because a crawler indexing `/cases/<ref>` or `/viewer/<uid>` puts study
 * identifiers into search results and caches, and those identifiers are the
 * kind of thing that should never leave the corridor.
 *
 * `/` is disallowed for the same reason it is absent from the sitemap: it
 * serves a dashboard to anyone signed in, and the three locale routes are the
 * canonical public page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/ar', '/fr', '/en', '/pricing'],
        disallow: [
          '/cases',
          '/patients',
          '/upload',
          '/viewer',
          '/workspace',
          '/ledger',
          '/doctor',
          '/admin',
          '/settings',
          '/profile',
          '/notifications',
          '/verification',
          '/invite',
          '/auth',
          '/api',
        ],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
