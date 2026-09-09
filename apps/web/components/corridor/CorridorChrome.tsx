'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSite } from '../../lib/site/site-provider';

/**
 * The navigation chrome — Landing-Page-Specs §Scene 01 and §2.2.
 *
 * "The reticle and windowing HUD from a radiology workstation become the
 * navigation chrome." So this is not a website header with a logo and five
 * links: it is the corner overlay of a reading station — a mono wordmark, four
 * section jumps, and the language control, on a rule that only appears once
 * you have left the hero.
 *
 * It is `position: fixed` and transparent over the hero, gaining its
 * background and hairline once the page has scrolled past the first viewport.
 * That transition is a class toggle driven by one IntersectionObserver rather
 * than a scroll handler, so it costs nothing per frame.
 */
export function CorridorChrome(): React.JSX.Element {
  const { t } = useSite();
  const [detached, setDetached] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const hero = document.getElementById('hero');
    if (hero === null) return;

    const observer = new IntersectionObserver(
      ([entry]) => setDetached(entry?.isIntersecting !== true),
      // Fires when the hero's last 15% leaves — the point at which a
      // transparent header would start sitting on body copy.
      { threshold: 0.15 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  const links = [
    { href: '#upload', label: t.navDoctors },
    { href: '#consent', label: t.navPatients },
    { href: '#security', label: t.navSecurity },
    { href: '#questions', label: t.navQuestions },
  ];

  return (
    <header className="chrome" data-detached={detached}>
      <div className="chrome-inner">
        <Link href="/" className="chrome-mark mono">
          {/* The reticle — a workstation's crosshair, standing in for a logo. */}
          <span className="chrome-reticle" aria-hidden="true" />
          MIR
        </Link>

        <nav className="chrome-nav" aria-label={t.navQuestions}>
          {links.map((link) => (
            <a key={link.href} href={link.href} className="chrome-link mono">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="chrome-actions">
          <Link href="/login" className="chrome-link mono chrome-signin">
            {t.navSignIn}
          </Link>

          <button
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

      {/*
        Disclosed inline, not in a full-screen overlay. Four links and a
        sign-in do not justify taking over the viewport, and an overlay on a
        page with a pinned scroll section is a way to trap someone.

        `hidden` rather than conditional rendering so the links stay in the DOM
        for a crawler and the toggle's `aria-controls` always points at
        something real.
      */}
      <div id="chrome-menu" className="chrome-menu" hidden={!menuOpen}>
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="chrome-link mono"
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </a>
        ))}
        <Link href="/login" className="chrome-link mono" onClick={() => setMenuOpen(false)}>
          {t.navSignIn}
        </Link>
      </div>
    </header>
  );
}
