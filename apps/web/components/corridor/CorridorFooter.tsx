'use client';

import { UI_LOCALES, type UiLocale } from '@mir/contracts';
import { SITE_COPY } from '../../lib/site/copy';
import { ENTITY } from '../../lib/site/entity';
import { useSite } from '../../lib/site/site-provider';

/**
 * The footer — Landing-Page-Specs §Scene 11, §6.8, §9, §14.
 *
 * Five things live here and each is required by name somewhere in the brief:
 *
 *   1. The language switcher — §9: each locale link carries `hreflang` and its
 *      own language name IN ITS OWN SCRIPT. Never a flag. Flags are countries,
 *      not languages, and Arabic is spoken in many.
 *   2. Legal links — §14 requires terms, privacy and a consent policy to exist
 *      and be linked.
 *   3. The registered entity name and address — §Scene 11: "not optional. A
 *      health platform with no verifiable legal entity reads as a scam to
 *      exactly the careful users you most want."
 *   4. The manual reduce-motion switch — §6.8: "Some users have vestibular
 *      sensitivity but have never found the OS setting."
 *   5. The sound toggle — §2.2 channel 5, muted by default, state persisted.
 *
 * Anything unconfigured is OMITTED rather than faked. `lib/site/entity.ts`
 * explains why at length: a convincing placeholder address is worse than a
 * blank one, because a blank is a gate somebody has to open before launch and
 * a fake is a lie that ships because it looked finished.
 */
export function CorridorFooter({
  hrefFor,
}: {
  /** Where a locale link points. Supplied by the route, which knows its shape. */
  hrefFor: (locale: UiLocale) => string;
}): React.JSX.Element {
  const { t, locale, reducedMotion, setReducedMotion, sound, setSound } = useSite();

  const legal = [
    { href: ENTITY.termsUrl, label: t.footerTerms },
    { href: ENTITY.privacyUrl, label: t.footerPrivacy },
    { href: ENTITY.consentPolicyUrl, label: t.footerConsentPolicy },
    { href: ENTITY.dataProtectionContact, label: t.footerDataContact },
    { href: ENTITY.statusUrl, label: t.footerStatus },
  ].filter((link): link is { href: string; label: string } => link.href !== null);

  return (
    <footer className="site-footer">
      <div className="shell site-footer-inner">
        <nav className="footer-locales" aria-label={t.footerLanguage}>
          <span className="mono dim">{t.footerLanguage}</span>
          {UI_LOCALES.map((code) => (
            <a
              key={code}
              href={hrefFor(code)}
              hrefLang={code}
              lang={code}
              className={`footer-locale ${code === locale ? 'is-current' : ''}`}
              aria-current={code === locale ? 'page' : undefined}
            >
              {/*
                Each language names itself, in its own script and from its own
                dictionary — العربية, Français, English. A reader who cannot
                read the current locale can still find their own.
              */}
              {SITE_COPY[code].localeName}
            </a>
          ))}
        </nav>

        {legal.length > 0 && (
          <nav className="footer-legal" aria-label={t.footerLegal}>
            {legal.map((link) => (
              <a key={link.label} href={link.href} className="link t-meta">
                {link.label}
              </a>
            ))}
          </nav>
        )}

        <div className="footer-switches">
          <label className="footer-switch">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(event) => setReducedMotion(event.target.checked)}
              data-testid="footer-reduce-motion"
            />
            <span>{t.footerReduceMotion}</span>
          </label>

          <label className="footer-switch">
            <input
              type="checkbox"
              checked={sound}
              onChange={(event) => setSound(event.target.checked)}
              data-testid="footer-sound"
            />
            <span>{sound ? t.footerSoundOff : t.footerSoundOn}</span>
          </label>
        </div>

        <div className="footer-entity t-meta ash">
          {ENTITY.name === null || ENTITY.address === null ? (
            /*
              The launch gate, made visible rather than silent. §12 L0 requires
              a confirmed legal entity before this page ships, and
              `launchBlockers()` in lib/site/entity.ts lists what is missing.
              Saying so in the footer is uncomfortable, which is the point.
            */
            <p className="dim">{t.footerEntityPending}</p>
          ) : (
            <>
              <p>{ENTITY.name}</p>
              <p className="dim">{ENTITY.address}</p>
            </>
          )}
          {/*
            §7.1's provenance note, carried onto the page itself. It costs one
            line and it is exactly the kind of care §7.1 says a judge and a
            regulator both notice.
          */}
          <p className="dim">{t.footerCredits}</p>
        </div>
      </div>
    </footer>
  );
}
