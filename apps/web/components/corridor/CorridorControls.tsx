'use client';

import { THEMES, UI_LOCALES, type Theme, type UiLocale } from '@mir/contracts';
import { SITE_COPY } from '../../lib/site/copy';
import { useT } from '../../lib/i18n/provider';
import { useTheme } from '../../lib/theme/theme';
import { useSite } from '../../lib/site/site-provider';

/**
 * The language and appearance controls, in the chrome where people look for
 * them.
 *
 * They belong here rather than only in the footer. On a site whose primary
 * audience reads Arabic, whose second reads French, and whose third reads
 * English, a language control below eleven scenes of scrolling is a control
 * nobody finds — and the reader who most needs it is the one who cannot read
 * the page well enough to know it is there.
 *
 * ---------------------------------------------------------------------------
 * `<details>`, NOT A JAVASCRIPT MENU.
 *
 * The browser already implements a disclosure widget: keyboard-operable,
 * correctly announced, `aria-expanded` kept in sync, and — the reason that
 * matters here — WORKING BEFORE HYDRATION. This page is built to be complete
 * with no JavaScript at all (§12 L1), and a language switcher that needs a
 * bundle to open is the one control that must not.
 *
 * The locale options are real links to the prerendered locale routes, so they
 * work with no script and are what a crawler follows. The theme options need
 * state, so they are buttons and they degrade to doing nothing — which is the
 * correct failure for an appearance preference.
 * ---------------------------------------------------------------------------
 */

/** Each language names itself, in its own script. §9: never a flag. */
function localeName(code: UiLocale): string {
  return SITE_COPY[code].localeName;
}

export function LocaleControl({
  hrefFor,
}: {
  hrefFor: (locale: UiLocale) => string;
}): React.JSX.Element {
  const { locale } = useSite();
  const t = useT();

  return (
    <details className="control">
      <summary className="control-trigger" aria-label={t.navLanguage}>
        <GlobeMark />
        <span className="control-value">{localeName(locale)}</span>
      </summary>

      <div className="control-menu" role="group" aria-label={t.navLanguage}>
        {UI_LOCALES.map((code) => (
          <a
            key={code}
            href={hrefFor(code)}
            hrefLang={code}
            lang={code}
            className="control-option"
            aria-current={code === locale ? 'true' : undefined}
            data-selected={code === locale}
          >
            {localeName(code)}
          </a>
        ))}
      </div>
    </details>
  );
}

export function ThemeControl(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const t = useT();

  const labels: Record<Theme, string> = {
    light: t.themeLight,
    dark: t.themeDark,
    system: t.themeSystem,
  };

  return (
    <details className="control">
      <summary className="control-trigger" data-testid="theme-toggle" aria-label={t.themeLabel}>
        <ContrastMark />
      </summary>

      <div className="control-menu" role="group" aria-label={t.themeLabel}>
        {THEMES.map((option) => (
          <button
            key={option}
            type="button"
            className="control-option"
            data-testid={`theme-option-${option}`}
            data-selected={theme === option}
            aria-pressed={theme === option}
            onClick={() => setTheme(option)}
          >
            {labels[option]}
          </button>
        ))}
      </div>

      {/*
        Said once, plainly, where the choice is made. This page is a darkened
        reading room in either setting — that contrast against the light
        clinical product is the design (§3.1) — so the control governs the rest
        of the site rather than this page, and a reader who flips it and sees
        nothing change deserves to know why rather than to wonder.
      */}
      <p className="control-note">{t.themeAppliesToApp}</p>
    </details>
  );
}

/**
 * Two marks, drawn rather than imported.
 *
 * `lucide-react` is already a dependency, but it is tree-shaken per icon into
 * the application bundle, and this page's whole argument is that it costs
 * almost nothing. These are eleven and nine path commands. They also match the
 * page's own line weight, which an icon set never quite does.
 */
function GlobeMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="control-mark" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8h12.5" />
      <path d="M8 1.75c1.7 1.7 2.6 3.9 2.6 6.25S9.7 12.55 8 14.25C6.3 12.55 5.4 10.35 5.4 8S6.3 3.45 8 1.75Z" />
    </svg>
  );
}

/** A disc half-filled: the same idea as a moon, without the night-time story. */
function ContrastMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" className="control-mark" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 1.75A6.25 6.25 0 0 1 8 14.25Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
