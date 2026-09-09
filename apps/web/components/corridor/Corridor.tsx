'use client';

import type { UiLocale } from '@mir/contracts';
import { SITE_COPY } from '../../lib/site/copy';
import { directionOf } from '../../lib/site/dir';
import { SiteProvider } from '../../lib/site/site-provider';
import { CorridorChrome } from './CorridorChrome';
import { CorridorFooter } from './CorridorFooter';
import { CORRIDOR_FONT_CLASS } from './fonts';
import { CursorLight } from './motion/CursorLight';
import { WebGLHandoff } from './motion/WebGLHandoff';
import { S00Load } from './scenes/S00Load';
import { S01Hero } from './scenes/S01Hero';
import { S02Problem } from './scenes/S02Problem';
import { S03Corridor } from './scenes/S03Corridor';
import { S04UploadDemo } from './scenes/S04UploadDemo';
import { S05Consent } from './scenes/S05Consent';
import { S06Viewer } from './scenes/S06Viewer';
import { S07Appointment } from './scenes/S07Appointment';
import { S08Security } from './scenes/S08Security';
import { S09Doors } from './scenes/S09Doors';
import { S10Questions } from './scenes/S10Questions';
import { S11Close } from './scenes/S11Close';

/**
 * "The Corridor" — the public landing page.
 *
 * §6.2: "`page.tsx` contains no styling and no animation logic. It composes
 * eleven scene components in order. If it grows past 60 lines, something is in
 * the wrong place." This file is that composition, one level down so the route
 * files stay thinner still.
 *
 * ---------------------------------------------------------------------------
 * `lang` AND `dir` ARE ON THIS ELEMENT, NOT ON <html>.
 *
 * The root layout renders `<html lang="ar" dir="rtl">` — the application's
 * default — and the locale provider corrects it after mount from the user's
 * stored preference. That is right for the app and wrong for a statically
 * prerendered marketing route, where a crawler, a WhatsApp preview and a
 * screen reader all read the HTML as served and never see the correction.
 *
 * Nested `lang`/`dir` is not a workaround for that; it is what the attributes
 * are for. A French page inside an Arabic-default document declares itself,
 * `:lang()` and CSS logical properties resolve from the nearest declaration,
 * and assistive technology switches voice at this boundary. The direction it
 * carries also feeds `--dir` (§3.6), so every horizontal motion inside is
 * correct in the prerendered HTML rather than after hydration.
 * ---------------------------------------------------------------------------
 */
export function Corridor({
  locale,
  hrefFor,
}: {
  locale: UiLocale;
  /** Where each locale link points — the route owns URL shape, not this file. */
  hrefFor: (locale: UiLocale) => string;
}): React.JSX.Element {
  const t = SITE_COPY[locale];

  return (
    <SiteProvider locale={locale}>
      {/*
        `marketing` is the platform's existing scope for the expressive
        register (§4.1) and `corridor` is this page's palette on top of it.
        Exactly one element carries `marketing` per page — asserted by
        e2e/public-surface.spec.ts — and nothing in the signed-in application
        ever sets it.
      */}
      <div
        className={`marketing corridor ${CORRIDOR_FONT_CLASS}`}
        lang={locale}
        dir={directionOf(locale)}
      >
        <a href="#main" className="skip-link">
          {t.skipToContent}
        </a>

        <span className="grain" aria-hidden="true" />
        <CursorLight />
        <WebGLHandoff />
        <S00Load />

        <CorridorChrome />

        {/*
          The page's one `main` landmark. PublicChrome supplies a landmark for
          the rest of the public surface; this route bypasses that chrome
          entirely, so the landmark is here and there is exactly one.
        */}
        <main id="main" tabIndex={-1}>
          <S01Hero />
          <S02Problem />
          <S03Corridor />
          <S04UploadDemo />
          <S05Consent />
          <S06Viewer />
          <S07Appointment />
          <S08Security />
          <S09Doors />
          <S10Questions />
          <S11Close />
        </main>

        <CorridorFooter hrefFor={hrefFor} />
      </div>
    </SiteProvider>
  );
}
