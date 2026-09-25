'use client';

import Link from '../ui/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import type { Role } from '@mir/contracts';
import { useT } from '../../lib/i18n/provider';
import type { Dictionary } from '../../lib/i18n/dictionary';
import { cn } from '../../lib/utils';
import { AccountPreferencesSync } from '../../lib/account/preferences';
import { SessionTimeoutNotice } from '../SessionTimeoutNotice';
import { Sheet, SheetContent, SheetTrigger } from '../ui';
import { BrandMark } from './BrandMark';
import { LocaleSelect } from './LocaleSelect';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { sectionsForRole, type NavSection } from './nav';

/**
 * Chrome for the signed-in product.
 *
 * WHY A SIDEBAR REPLACED THE HEADER ROW. There are fourteen destinations. As a
 * single row of links they overflowed the header at ordinary desktop widths and
 * read as an undifferentiated wall in the mobile drawer, so the first thing a
 * user did on every screen was re-read the whole list. A grouped vertical rail
 * keeps the current section visible and gives each group a heading, which is
 * what "obvious what to do next" (§4.1) actually needs.
 *
 * The visual upgrade stops at layout and rhythm. No gradient, no glass, no
 * motion beyond a colour transition — those live under `.marketing` and never
 * reach a case, file, or money screen.
 *
 * The drawer is unchanged: `Sheet` is anchored to the start edge, so it opens
 * from the right under Arabic with no per-locale code (D4).
 */
export function AppChrome({
  children,
  role,
}: {
  children: ReactNode;
  role: Role | null;
}): React.JSX.Element {
  const t = useT();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const sections = sectionsForRole(role);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Prefix match so /patients/new keeps /patients highlighted. The exception is
  // a destination that is a prefix of another (/doctor and /doctor/availability),
  // which would otherwise light up two rows at once.
  const isCurrent = (href: string): boolean => {
    if (pathname === href) return true;
    if (!pathname.startsWith(`${href}/`)) return false;
    return !sections.some((s) => s.items.some((i) => i.href !== href && i.href === pathname));
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Renders nothing. Applies account-level appearance to a device that has
          expressed no choice of its own — see the note on the component. */}
      <AccountPreferencesSync />

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

      <div className="flex flex-1">
        {sections.length > 0 && (
          <aside className="hidden shrink-0 border-e bg-sidebar md:block md:w-64">
            <div className="sticky top-0 flex h-screen flex-col gap-4 overflow-y-auto px-3 py-4">
              <Link
                href="/"
                className="flex items-center gap-2 rounded-md px-2 py-1 text-lg font-bold tracking-tight text-sidebar-foreground"
              >
                <BrandMark />
                {t.appName}
              </Link>
              <SidebarNav sections={sections} isCurrent={isCurrent} t={t} />
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* The institutional band: a 3px primary rule above a calm surface. */}
          <header className="sticky top-0 z-30 border-b border-t-[3px] border-t-primary bg-card/95 backdrop-blur">
            <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
              {sections.length > 0 && (
                <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                  <SheetTrigger
                    className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
                    aria-label={t.menuOpen}
                  >
                    <Menu className="size-5" />
                  </SheetTrigger>
                  <SheetContent title={t.menuTitle} closeLabel={t.menuClose}>
                    <p className="flex items-center gap-2 text-lg font-bold">
                      <BrandMark />
                      {t.appName}
                    </p>
                    <div className="overflow-y-auto">
                      <SidebarNav sections={sections} isCurrent={isCurrent} t={t} />
                    </div>
                  </SheetContent>
                </Sheet>
              )}

              {/* The wordmark lives in the sidebar on desktop; on a phone, and
                  for anyone with no navigation at all, it belongs here. */}
              <Link
                href="/"
                className={cn(
                  'flex items-center gap-2 rounded-md text-lg font-bold tracking-tight',
                  sections.length > 0 && 'md:hidden',
                )}
              >
                <BrandMark />
                {t.appName}
              </Link>

              <div className="ms-auto flex items-center gap-1.5">
                <LocaleSelect />
                <ThemeToggle />
                <UserMenu />
              </div>
            </div>
          </header>

          {/* Above the content, not over it: §4.4 asks for the timeout to be
              visible, and a banner that pushes the page down is noticed without
              covering the study someone is reading. */}
          <SessionTimeoutNotice />

          <div id="main-content" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </div>

          <footer className="border-t bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
              <span className="flex items-center gap-1.5 font-medium">
                <BrandMark className="size-4" />
                {t.appName} — {t.appTagline}
              </span>
              <span>{t.footerDisclaimer}</span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

function SidebarNav({
  sections,
  isCurrent,
  t,
}: {
  sections: NavSection[];
  isCurrent: (href: string) => boolean;
  t: Dictionary;
}): React.JSX.Element {
  return (
    <nav aria-label={t.navMenuPrimary} className="flex flex-col gap-5">
      {sections.map((section, index) => (
        <div key={section.headingKey ?? `primary-${index}`} className="flex flex-col gap-0.5">
          {section.headingKey !== undefined && (
            <h2 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t[section.headingKey]}
            </h2>
          )}
          {section.items.map(({ href, labelKey, Icon }) => {
            const current = isCurrent(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  // min-h-11 keeps every row at the 44px touch target the
                  // drawer needs, and the desktop rail inherits it harmlessly.
                  'flex min-h-11 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors',
                  current
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden="true" />
                {t[labelKey]}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
