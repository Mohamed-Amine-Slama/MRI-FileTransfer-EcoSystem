'use client';

import { uiLocaleSchema } from '@mir/contracts';
import { LOCALE_NAMES } from '../../lib/i18n/dictionary';
import { useLocale, useT } from '../../lib/i18n/provider';
import { Select } from '../ui';

/**
 * The language switcher.
 *
 * The value is PARSED rather than compared. An earlier ternary silently fell
 * back to Arabic for any locale it did not name, which would have made English
 * unselectable the moment it existed.
 */
export function LocaleSelect({ id = 'locale-select' }: { id?: string } = {}): React.JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {t.navLanguage}
      </label>
      <Select
        id={id}
        data-testid="locale-switcher"
        className="h-9 w-auto"
        value={locale}
        onChange={(e) => {
          const parsed = uiLocaleSchema.safeParse(e.target.value);
          if (parsed.success) setLocale(parsed.data);
        }}
      >
        {Object.entries(LOCALE_NAMES).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </Select>
    </>
  );
}
