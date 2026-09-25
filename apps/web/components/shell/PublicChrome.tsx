'use client';

import Link from '../ui/link';
import { useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { useT } from '../../lib/i18n/provider';
import { useSession } from '../../lib/session/session';
import { cn } from '../../lib/utils';
import { buttonVariants } from '../ui';
import { BrandMark } from './BrandMark';
import { LocaleSelect } from './LocaleSelect';
import { ThemeToggle } from './ThemeToggle';

/**
 * Chrome for the public surface — landing, pricing, and the sign-in and
 * sign-up screens.
 *
 * THIS IS THE ONLY PLACE `.marketing` IS SET, and that scope is load-bearing.
 * §4.1 requires the signed-in product to read as calm and precise because it is
 * used by clinic staff moving real patient data; a landing page has the
 * opposite job. Both are true, so the expressive treatment is contained rather
 * than global — the gradient utilities in globals.css only resolve beneath this
 * element. If a gradient ever appears on a case, file, or money screen, this
 * boundary has been broken.
 *
 * No sidebar and no session timeout banner: there is no session to time out,
 * and a visitor deciding whether to sign up does not need a navigation rail.
 */
export function PublicChrome({ children }: { children: ReactNode }): React.JSX.Element {
  const t = useT();
  const { status } = useSession();
  const [open, setOpen] = useState(false);

  const links = [
    { href: '/pricing', label: t.navPricing },
  ];

  return (
    <div className="marketing flex min-h-screen flex-col">
      <a
        href="#main-content"
        /*
         * `start-0 top-0` pins the hidden state. Tailwind's `sr-only` is
         * absolutely positioned with `margin: -1px`, and with no inset it sits
         * at its STATIC position — which under RTL is one pixel past the right
         * edge of the viewport. One pixel is enough to make the document
         * horizontally scrollable, which §4.5 forbids and which is invisible to
         * anyone looking for it: nothing appears cut off, the page just moves.
         */
        className="sr-only m-0 start-0 top-0 focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        {t.skipToContent}
      </a>

      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 rounded-md text-lg font-bold tracking-tight">
            <BrandMark />
            {t.appName}
          </Link>

          <nav aria-label={t.navMenuPrimary} className="hidden flex-1 items-center gap-1 sm:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-1.5 sm:ms-0">
            <div className="hidden sm:contents">
              <LocaleSelect />
            </div>
            <ThemeToggle />

            {status === 'authenticated' ? (
              <Link href="/" className={buttonVariants({ size: 'sm' })} data-testid="public-open-app">
                {t.publicOpenApp}
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}
                  data-testid="public-sign-in"
                >
                  {t.navSignIn}
                </Link>
                <Link
                  href="/signup"
                  className={buttonVariants({ size: 'sm' })}
                  data-testid="public-sign-up"
                >
                  {t.navSignUp}
                </Link>
              </>
            )}

            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? t.menuClose : t.menuOpen}
              onClick={() => setOpen((v) => !v)}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {/* Disclosed inline rather than in a drawer: there are two or three
            links, and a full-screen overlay for that is theatre. */}
        {open && (
          <div className="border-t bg-card px-4 py-3 sm:hidden">
            <nav aria-label={t.navMenuPrimary} className="flex flex-col gap-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
              {status !== 'authenticated' && (
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t.navSignIn}
                </Link>
              )}
              <div className="pt-2">
                <LocaleSelect />
              </div>
            </nav>
          </div>
        )}
      </header>

      {/*
        A DIV, not a <main>. Pages supply their own landmark — prose-shaped
        screens through the `Main` component, full-bleed ones (landing,
        pricing) directly — and nesting one inside another is invalid HTML that
        gives a screen reader two "main" landmarks to choose between. AppChrome
        makes the same choice for the same reason.
      */}
      <div id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        {children}
      </div>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 sm:px-6">
          <span className="flex items-center gap-2 font-semibold">
            <BrandMark />
            {t.appName}
          </span>
          <p className="max-w-prose text-sm text-muted-foreground">{t.appTagline}</p>
          {/* The reference-only disclaimer is not marketing copy and does not
              get a softer voice here than it has in the viewer. */}
          <p className="text-xs text-muted-foreground">{t.footerDisclaimer}</p>
        </div>
      </footer>
    </div>
  );
}
