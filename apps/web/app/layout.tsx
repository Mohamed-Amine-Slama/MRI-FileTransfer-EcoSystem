import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import Script from 'next/script';
import { LOCALE_DIRECTION, type Locale } from '@mir/contracts';
import { AppShell } from '../components/AppShell';
import { LocaleProvider } from '../lib/i18n/provider';
import { SessionProvider } from '../lib/session/session';
import { ThemeProvider } from '../lib/theme/theme';
import './globals.css';

export const metadata = {
  title: 'MIR — Medical Imaging Referral',
  description: 'Cross-border medical imaging transfer and scheduling',
};

// One family for both scripts (D4): IBM Plex Sans Arabic ships full Arabic
// coverage plus Latin, so Arabic and French render with the same voice.
//
// VENDORED, not fetched from Google Fonts. next/font/google downloads at
// build time, and when that fetch fails — as it does inside a Docker build
// on a flaky or restricted network — Next silently falls back to system
// fonts and still exits 0, so the deployment image ships without its
// typeface and nothing fails. The files live in app/fonts/ (OFL 1.1,
// LICENSE.txt beside them), which makes the image build hermetic.
//
// `display: swap` keeps first paint on the system stack, which is what keeps
// the viewer's 5-second budget (P9.1) out of the font's hands.
//
// ---------------------------------------------------------------------------
// `preload: false` — Landing-Page-Specs §8.2 technique 6.
//
// These four files are 72–76 KB each because one family carries both scripts
// (D4). Preloading them puts ~296 KB in front of everything else on the first
// paint of EVERY route, and the landing page's whole Tier C budget is 450 KB
// with an LCP target of 2.0 s measured on a 2 Mbit connection. On that link
// the preloads alone are over a second before the hero image is even
// requested.
//
// `preload` is per-DECLARATION in next/font, not per-file, so "preload the two
// critical files and nothing else" is not expressible while all four weights
// share one family — and they must, or a `font-weight: 500` heading falls back
// to a synthesised bold. Nothing is the honest half of that choice: with
// `display: swap` the page paints immediately on the system stack and swaps
// when the real face arrives, which is the behaviour the comment above already
// relies on.
//
// The real fix is §7.2's: per-script subsets with `unicode-range`, so an
// Arabic reader never downloads the Latin glyphs and vice versa. That needs
// hand-written @font-face rules rather than next/font, so it is recorded as an
// open item in docs/landing-page-status.md rather than done halfway here.
// ---------------------------------------------------------------------------
const plex = localFont({
  src: [
    { path: './fonts/IBMPlexSansArabic-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: './fonts/IBMPlexSansArabic-Bold.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  preload: false,
  variable: '--font-plex',
});

// DECISION D4: Arabic and French, RTL from day one. Arabic is the default
// because the referring side (Libya) and most patients are Arabic-speaking.
// Direction is driven off the locale table in @mir/contracts rather than
// hardcoded, so a locale can never ship with the wrong direction.
//
// These attributes are the SERVER's guess. LocaleProvider replaces them after
// mount once the user's stored preference is known; rendering the default here
// is what keeps the first paint free of a hydration mismatch.
const DEFAULT_LOCALE: Locale = 'ar';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} dir={LOCALE_DIRECTION[DEFAULT_LOCALE]} className={plex.variable}>
      <body>
        {/*
          Applies the stored theme before the first paint.

          `beforeInteractive` runs this ahead of any Next code or hydration, so
          a user who chose dark never sees a white flash. It has to be a FILE
          rather than an inline script: React's raw-HTML escape hatch is banned
          outright by lib/security/xss-surface.test.ts, because its absence is
          what justifies the `script-src 'unsafe-inline'` exception in
          next.config.mjs. Same origin, so `script-src 'self'` already permits
          this, and the routes stay statically prerendered.

          (That test is a literal text scan, so naming the banned API here —
          even inside a comment — trips it. Hence the circumlocution.)
        */}
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <LocaleProvider>
          <ThemeProvider>
            <SessionProvider>
              <AppShell>{children}</AppShell>
            </SessionProvider>
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
