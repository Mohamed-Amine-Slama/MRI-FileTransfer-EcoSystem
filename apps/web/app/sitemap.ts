import type { MetadataRoute } from 'next';
import { UI_LOCALES } from '@mir/contracts';
import { SITE_ORIGIN } from '../lib/site/entity';

/**
 * The sitemap — Landing-Page-Specs §10.
 *
 * Only the three marketing locales are listed, and each one declares the other
 * two as its alternates. Everything else in this application sits behind a
 * session and has no business in a sitemap: `/cases`, `/upload`, `/viewer/…`
 * are screens for people moving patient data, and asking a crawler to index
 * the shape of them is an information-disclosure question nobody needs to
 * answer.
 *
 * `/` is deliberately absent. It is two pages — the landing page for a
 * visitor, a dashboard for a signed-in user — so it is not a canonical
 * marketing URL, and the three locale routes are.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const alternates = Object.fromEntries(
    UI_LOCALES.map((locale) => [locale, `${SITE_ORIGIN}/${locale}`]),
  );

  return UI_LOCALES.map((locale) => ({
    url: `${SITE_ORIGIN}/${locale}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    // Arabic is the primary market and the platform default, so it is the one
    // a crawler should prefer when it has no better signal.
    priority: locale === 'ar' ? 1 : 0.8,
    alternates: { languages: alternates },
  }));
}
