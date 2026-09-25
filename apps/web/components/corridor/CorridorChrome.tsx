'use client';

import Link from '../ui/link';
import { useEffect, useRef, useState } from 'react';
import type { UiLocale } from '@mir/contracts';
import { useSite } from '../../lib/site/site-provider';
import { LocaleControl, ThemeControl } from './CorridorControls';
import { ArrowCircle } from './primitives/Card';
import { MirMark } from './primitives/MirMark';

/**
 * The landing page's own header — spec 2026-09-10 §7.3.
 *
 * Floating 16px from the top: a white tile with the teal logo square, a glass
 * pill of in-page links, and at the inline-end the language and appearance
 * controls, sign-in, and a teal "register" pill with a lime arrow. The bar
 * itself lets clicks through (`pointer-events: none`); only its pieces catch
 * them, so the hero's helix still answers the cursor between them.
 *
 * The language control stays first among `.control`s and stays a <details>:
 * a reader who cannot read this page is the one who most needs to switch it,
 * before any script has arrived.
 */
export function CorridorChrome({
  hrefFor,
}: {
  hrefFor: (locale: UiLocale) => string;
}): React.JSX.Element {
  const { t } = useSite();
  const [detached, setDetached] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // "Detached" once the hero is mostly off screen: the pieces gain a shadow.
  useEffect(() => {
    const hero = document.getElementById('hero');
    if (hero === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => setDetached(entry?.isIntersecting !== true),
      { threshold: 0.15 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  // Escape dismisses the sheet, same as any other disclosure, and hands
  // focus back to the control that opened it rather than dropping it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [menuOpen]);

  const links = [
    { href: '#upload', label: t.navDoctors },
    { href: '#consent', label: t.navPatients },
    { href: '#security', label: t.navSecurity },
    { href: '#questions', label: t.navQuestions },
  ];

  return (
    <header className="chrome" data-detached={detached}>
      <div className="chrome-inner">
        <div className="chrome-brand">
          <Link href="/" className="chrome-mark">
            <span className="logo-tile" aria-hidden="true">
              <MirMark />
            </span>
            <span className="chrome-name">MIR</span>
          </Link>
          <nav className="chrome-nav" aria-label={t.navQuestions}>
            {links.map((link) => (
              <a key={link.href} href={link.href} className="chrome-link">
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="chrome-actions">
          <LocaleControl hrefFor={hrefFor} />
          <ThemeControl />
          <Link href="/login" className="chrome-link chrome-signin">
            {t.navSignIn}
          </Link>
          <Link href="/signup" className="chrome-cta">
            <span>{t.heroCtaPrimary}</span>
            <ArrowCircle className="chrome-cta-arrow" />
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="chrome-toggle"
            aria-expanded={menuOpen}
            aria-controls="chrome-menu"
            aria-label={menuOpen ? t.menuClose : t.menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="chrome-toggle-bar" aria-hidden="true" />
            <span className="chrome-toggle-bar" aria-hidden="true" />
          </button>
        </div>
      </div>

      <nav id="chrome-menu" className="chrome-menu" aria-label={t.navQuestions} hidden={!menuOpen}>
        {links.map((link) => (
          <a key={link.href} href={link.href} className="chrome-link" onClick={() => setMenuOpen(false)}>
            {link.label}
          </a>
        ))}
        <Link href="/login" className="chrome-link" onClick={() => setMenuOpen(false)}>
          {t.navSignIn}
        </Link>
      </nav>
    </header>
  );
}
