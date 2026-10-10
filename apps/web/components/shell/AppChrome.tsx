'use client';

import Link from '../ui/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Role } from '@mir/contracts';
import { useT } from '../../lib/i18n/provider';
import type { Dictionary } from '../../lib/i18n/dictionary';
import { cn } from '../../lib/utils';
import { AccountPreferencesSync } from '../../lib/account/preferences';
import { SessionTimeoutNotice } from '../SessionTimeoutNotice';
import { useSession } from '../../lib/session/session';
import { useCurrentProvider } from '../../lib/provider/current-provider';
import { Avatar, Sheet, SheetContent, SheetTrigger } from '../ui';
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
 * THE RAIL COLLAPSES WHEN NOT IN USE. At rest it is a 64px column of icons;
 * pointing at it, tabbing into it, or opening one of its menus widens it to
 * 256px, and the page narrows beside it — the content follows the rail rather
 * than sitting under it. The pin keeps it open when the pointer leaves —
 * remembered per device, like the theme. The widths and the reveal live in
 * globals.css (`.app-rail`) because the "open" state is a selector list that
 * utility classes would have to repeat on every element.
 *
 * The visual upgrade stops at layout and rhythm. No gradient, no glass, no
 * motion beyond a width and colour transition — those live under `.marketing`
 * and never reach a case, file, or money screen.
 *
 * The drawer is unchanged: `Sheet` is anchored to the start edge, so it opens
 * from the right under Arabic with no per-locale code (D4).
 */

const PIN_KEY = 'mir.sidebar.pinned';

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
  const [pinned, setPinned] = useState(false);

  const sections = sectionsForRole(role);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Read after mount: the server has no localStorage, and rendering the pinned
  // width on the first pass would mismatch hydration.
  useEffect(() => {
    try {
      setPinned(localStorage.getItem(PIN_KEY) === '1');
    } catch {
      // Storage blocked: the rail simply starts collapsed.
    }
  }, []);

  const togglePin = (): void => {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, next ? '1' : '0');
    } catch {
      // Not persisted; the choice still holds for this page view.
    }
  };

  // Prefix match so /patients/new keeps /patients highlighted. The exception is
  // a destination that is a prefix of another (/doctor and /doctor/availability),
  // which would otherwise light up two rows at once.
  const isCurrent = (href: string): boolean => {
    if (pathname === href) return true;
    if (!pathname.startsWith(`${href}/`)) return false;
    return !sections.some((s) => s.items.some((i) => i.href !== href && i.href === pathname));
  };

  const pinLabel = pinned ? t.sidebarUnpin : t.sidebarPin;

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
          // The aside IS the rail's width, so the content column beside it
          // shrinks and grows with it rather than being covered.
          <aside className="app-rail hidden shrink-0 md:block" data-pinned={pinned ? '' : undefined}>
            <div className="sticky top-0 flex h-screen flex-col overflow-hidden border-e border-t-[3px] border-t-primary bg-sidebar text-sidebar-foreground">
              {/* h-14 under the same 3px rule as the header, so the two bands
                  line up across the whole top edge. */}
              <div className="flex h-14 shrink-0 items-center border-b px-3">
                <Link
                  href="/"
                  className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1 text-lg font-bold tracking-tight"
                >
                  <BrandMark />
                  <span className="rail-reveal truncate">{t.appName}</span>
                </Link>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
                <SidebarNav sections={sections} isCurrent={isCurrent} t={t} reveal="rail-reveal" />
              </div>
              <SidebarIdentity
                localeId="locale-select"
                reveal="rail-reveal"
                pin={
                  <button
                    type="button"
                    onClick={togglePin}
                    aria-pressed={pinned}
                    aria-label={pinLabel}
                    title={pinLabel}
                    data-testid="sidebar-pin"
                    className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {pinned ? (
                      <PanelLeftClose className="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
                    ) : (
                      <PanelLeftOpen className="size-4.5 rtl:-scale-x-100" aria-hidden="true" />
                    )}
                  </button>
                }
              />
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
                    <SidebarIdentity localeId="locale-select-drawer" />
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
                {/* With a sidebar, the appearance controls live at its foot. A
                    role with no navigation has no sidebar, so they stay here. */}
                {sections.length === 0 && (
                  <>
                    <LocaleSelect />
                    <ThemeToggle />
                  </>
                )}
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

          {/* Here for every account rather than in the rail: a collapsed rail
              would hide it, and it must stay readable on every screen. */}
          <p className="border-t px-4 py-4 text-xs text-muted-foreground sm:px-6">
            {t.footerDisclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}

function SidebarNav({
  sections,
  isCurrent,
  t,
  reveal,
}: {
  sections: NavSection[];
  isCurrent: (href: string) => boolean;
  t: Dictionary;
  /** Class for text that fades out while the rail is collapsed. */
  reveal?: string;
}): React.JSX.Element {
  return (
    <nav aria-label={t.navMenuPrimary} className="flex flex-col gap-4">
      {sections.map((section, index) => (
        <div
          key={section.headingKey ?? `primary-${index}`}
          // The rule between groups is what still separates them once the
          // collapsed rail has hidden their headings.
          className={cn('flex flex-col gap-0.5', index > 0 && 'border-t pt-4')}
        >
          {section.headingKey !== undefined && (
            <h2
              className={cn(
                'mb-1 truncate px-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground',
                reveal,
              )}
            >
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
                  // min-h-11 is the 44px touch target the drawer needs; the
                  // drawer never shows at md+, so the rail can be denser.
                  'relative flex min-h-11 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors md:min-h-10',
                  current
                    ? // The start-edge bar marks the page even when only the
                      // icons are showing.
                      'bg-accent text-accent-foreground before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden="true" />
                <span className={cn('truncate', reveal)}>{t[labelKey]}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * Who is working, for which organisation, and the appearance controls.
 *
 * Pinned to the bottom of the rail so the header carries only navigation and
 * the account menu. The controls cannot move INTO the account menu: the theme
 * control is itself a menu and the language control a native select, and a
 * menu captures the keys both need. `pin` sits first in its row so it lands in
 * the icon column and stays visible while the rail is collapsed.
 */
function SidebarIdentity({
  localeId,
  reveal,
  pin,
}: {
  localeId: string;
  reveal?: string;
  pin?: ReactNode;
}): React.JSX.Element {
  const { user } = useSession();
  const { provider } = useCurrentProvider();

  return (
    <div className="mt-auto shrink-0 space-y-2 border-t px-3 py-3" data-testid="sidebar-identity">
      {user !== null && (
        <div className="flex items-center gap-3 px-1.5">
          <Avatar name={user.displayName} size="sm" />
          <div className={cn('min-w-0', reveal)}>
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            {provider !== null && (
              <p className="truncate text-xs text-muted-foreground">{provider.legalName}</p>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        {pin}
        <div className={cn('flex items-center gap-1.5', reveal)}>
          <LocaleSelect id={localeId} />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
