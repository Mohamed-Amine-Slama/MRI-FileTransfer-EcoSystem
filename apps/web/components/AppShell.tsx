'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DirectionProvider } from '@radix-ui/react-direction';
import { UI_LOCALES, UI_LOCALE_DIRECTION } from '@mir/contracts';
import { useLocale } from '../lib/i18n/provider';
import { useSession } from '../lib/session/session';
import { AppChrome } from './shell/AppChrome';
import { PublicChrome } from './shell/PublicChrome';

/**
 * Picks which chrome a route gets.
 *
 * The product has two registers (§4.1): a calm, dense, sidebar-shaped
 * application for people moving patient data, and an expressive public surface
 * for people deciding whether to sign up. This is the seam between them.
 *
 * WHY PATHNAME AND NOT ROUTE GROUPS. Moving the existing screens into an
 * `(app)/` group would rewrite the path of every file in the ratcheting
 * allowlist in `lib/corridor/no-hardcoded-corridor.test.ts` and in the e2e
 * suite, for no behavioural gain. One list, read here, does the same job.
 *
 * `/` is the exception that needs both: a visitor sees the landing page, and a
 * signed-in user sees their dashboard. It is resolved on session status rather
 * than on the path.
 *
 * Radix components read direction from DirectionProvider, so menus and the
 * mobile drawer align and animate correctly under Arabic (D4). It wraps BOTH
 * chromes — the public surface has a dropdown too.
 */

/**
 * Routes that belong to the public surface.
 *
 * `/signup/provider` and `/verification` are deliberately ABSENT even though
 * they are part of onboarding: both require a session, both are the point at
 * which someone becomes a user of the product rather than a visitor to the
 * site, and both need the account menu that only the application chrome has.
 */
const PUBLIC_PREFIXES = ['/pricing', '/login', '/signup', '/reset-password', '/invite'] as const;

const APPLICATION_EXCEPTIONS = ['/signup/provider'] as const;

export function isPublicPath(pathname: string): boolean {
  if (APPLICATION_EXCEPTIONS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false;
  }
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The landing page, which supplies ITS OWN chrome.
 *
 * A third case, and it needs to be one. PublicChrome is a sticky card-coloured
 * header with a skip link, a footer, and the marketing scope — correct for
 * /pricing and /login, and wrong for a page whose header is a radiology
 * workstation's corner overlay and whose footer carries a language switcher, a
 * reduce-motion switch and a legal entity. Wrapping the landing page in it
 * would put two headers, two footers and two skip links on the document.
 *
 * So this route renders bare and `components/corridor/Corridor.tsx` owns the
 * whole surface: one `.marketing` element, one `main` landmark, one skip link
 * — the invariants `e2e/public-surface.spec.ts` asserts, met by a different
 * component.
 *
 * The locale routes are matched against the shared locale table rather than a
 * literal list, so adding a UI locale cannot leave `/xx` rendering the landing
 * page inside the application's chrome.
 */
export function isCorridorPath(pathname: string, authenticated: boolean): boolean {
  if (UI_LOCALES.some((locale) => pathname === `/${locale}`)) return true;
  return pathname === '/' && !authenticated;
}

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const { locale } = useLocale();
  const { status, role } = useSession();
  const pathname = usePathname();

  // While the session is still resolving, the landing page is the safe guess
  // for `/`: it renders for everyone, whereas the dashboard would flash a
  // signed-out state at a signed-in user before correcting itself.
  const authenticated = status === 'authenticated';
  const corridor = isCorridorPath(pathname, authenticated);
  const publicSurface = isPublicPath(pathname);

  return (
    <DirectionProvider dir={UI_LOCALE_DIRECTION[locale]}>
      {corridor ? (
        children
      ) : publicSurface ? (
        <PublicChrome>{children}</PublicChrome>
      ) : (
        <AppChrome role={role}>{children}</AppChrome>
      )}
    </DirectionProvider>
  );
}
