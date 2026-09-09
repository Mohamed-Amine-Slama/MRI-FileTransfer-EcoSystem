import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UI_LOCALES, uiLocaleSchema, type UiLocale } from '@mir/contracts';
import { CorridorRoute } from './CorridorRoute';
import { SITE_COPY } from '../../lib/site/copy';
import { SITE_ORIGIN } from '../../lib/site/entity';

/**
 * The canonical marketing routes — Landing-Page-Specs §10.
 *
 * `/ar`, `/fr`, `/en`, each statically prerendered with its own title,
 * description, OG card and `hreflang` set. §6.1: "Static (SSG) for all
 * marketing routes. The landing page has no dynamic data. It should be a file
 * on a CDN edge."
 *
 * ---------------------------------------------------------------------------
 * `dynamicParams = false` IS LOAD-BEARING, NOT A DETAIL.
 *
 * A bare `[locale]` segment at the root would match every unknown one-segment
 * path in the application: `/schedule`, `/appointments`, anything a stale
 * bookmark points at. Those must 404 — `e2e/public-surface.spec.ts` asserts
 * exactly that for the deleted calendar surface, and it is the right answer
 * anyway: "a 404 tells the person holding the old link the truth."
 *
 * With `dynamicParams = false`, a param that `generateStaticParams` did not
 * emit is a 404 at build time, so this route matches three paths and no
 * others. The `safeParse` below is belt to that braces.
 * ---------------------------------------------------------------------------
 *
 * WHY THE APPLICATION'S ROUTES ARE NOT UNDER THIS SEGMENT. §6.2 sketches the
 * whole app as `app/[locale]/…`, but this repository's ~40 signed-in screens
 * already live at unprefixed paths, with a client-side locale switch and an
 * e2e suite and a §4.3 ratchet test that both reference those paths. Moving
 * them would be a routing migration, not a landing page. The marketing surface
 * gets the locale routes it needs for SEO and sharing; the application keeps
 * its own, and `lib/i18n/provider.tsx` remains the single source of the user's
 * chosen language.
 */

export const dynamicParams = false;

export function generateStaticParams(): { locale: UiLocale }[] {
  return UI_LOCALES.map((locale) => ({ locale }));
}

function localeFrom(value: string): UiLocale | null {
  const parsed = uiLocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = localeFrom(raw);
  if (locale === null) return {};

  const copy = SITE_COPY[locale];

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    /*
     * §10: written per language, not translated, and every locale points at
     * every other. `x-default` is Arabic — it is the primary market and the
     * default of the platform, so a reader whose language we do not speak
     * lands on the version most of this corridor reads.
     */
    alternates: {
      canonical: `${SITE_ORIGIN}/${locale}`,
      languages: {
        ...Object.fromEntries(UI_LOCALES.map((code) => [code, `${SITE_ORIGIN}/${code}`])),
        'x-default': `${SITE_ORIGIN}/ar`,
      },
    },
    openGraph: {
      type: 'website',
      locale,
      url: `${SITE_ORIGIN}/${locale}`,
      title: copy.metaTitle,
      description: copy.metaDescription,
      /*
       * One card per locale, with the headline set in the right script and
       * direction — §10, and the reason `scripts/render-og.mjs` renders these
       * in Chromium rather than through `next/og`: Satori does no complex text
       * shaping, so it would ship the Arabic card as unjoined letterforms.
       */
      images: [
        {
          url: `${SITE_ORIGIN}/og/${locale}.png`,
          width: 1200,
          height: 630,
          alt: copy.heroHeadline,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.metaTitle,
      description: copy.metaDescription,
      images: [`${SITE_ORIGIN}/og/${locale}.png`],
    },
    /*
     * §10 forbids `MedicalWebPage` and every `MedicalEntity` type: those
     * signal medical information provision, which is precisely the positioning
     * this product avoids. Nothing here claims to be medical content — it is a
     * page about a transfer service.
     */
    other: { 'format-detection': 'telephone=no' },
  };
}

export default async function LocaleLanding({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale: raw } = await params;
  const locale = localeFrom(raw);
  if (locale === null) notFound();

  return <CorridorRoute locale={locale} />;
}
