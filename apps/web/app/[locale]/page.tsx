import { redirect } from 'next/navigation';
import { UI_LOCALES, type UiLocale } from '@mir/contracts';

/**
 * The landing page is hidden for now (spec 2026-09-21 §1): `/ar`, `/fr` and
 * `/en` redirect to sign-in.
 *
 * The previous version of this file — per-locale metadata, hreflang, OG cards,
 * and <CorridorRoute> — is in git history (commit 50d72e5 and earlier).
 * Restoring the landing is restoring that file; CorridorRoute.tsx and
 * everything it renders are kept.
 *
 * `dynamicParams = false` STAYS. Without it this bare segment would match
 * every unknown one-segment path and turn a 404 (`/schedule`, a stale
 * bookmark) into a redirect — e2e/public-surface.spec.ts asserts those 404.
 */
export const dynamicParams = false;

export function generateStaticParams(): { locale: UiLocale }[] {
  return UI_LOCALES.map((locale) => ({ locale }));
}

export default function LocaleLanding(): never {
  redirect('/login');
}
