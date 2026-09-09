'use client';

import { useEffect } from 'react';
import type { UiLocale } from '@mir/contracts';
import { Corridor } from '../../components/corridor/Corridor';
import { useLocale } from '../../lib/i18n/provider';

/**
 * The client half of a locale route.
 *
 * Two jobs, both small:
 *
 * 1. Render the page in the locale the URL asked for, regardless of what this
 *    browser has stored. `/fr` is French for everybody — that is what makes it
 *    a shareable link.
 *
 * 2. Adopt that locale as the user's choice. Navigating to `/fr` IS choosing
 *    French, and §10 asks for the choice to be persisted and always
 *    overridable — the footer's switcher is the override. Without this the
 *    document element keeps the previous language's `lang`/`dir`, so the
 *    scrollbar sits on the wrong edge and native controls read the wrong way
 *    round while the content beside them says otherwise.
 *
 * Calling the provider's own `setLocale` rather than touching
 * `document.documentElement` directly matters: the provider owns that element
 * (D4), and a component writing to it behind the provider's back would be
 * overwritten the next time anything changed the language.
 */
export function CorridorRoute({ locale }: { locale: UiLocale }): React.JSX.Element {
  const { locale: current, setLocale } = useLocale();

  useEffect(() => {
    if (current !== locale) setLocale(locale);
  }, [current, locale, setLocale]);

  return <Corridor locale={locale} hrefFor={(code) => `/${code}`} />;
}
