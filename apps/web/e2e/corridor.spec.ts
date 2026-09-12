import { expect, test, type Page } from '@playwright/test';

/**
 * "The Corridor" — the landing page's gates, asserted.
 *
 * Landing-Page-Specs §12 sets a gate per build stage and §14 a launch
 * checklist. The ones a machine can hold are here. The ones it cannot —
 * a Libyan native speaker reading the Arabic, a doctor on a real 3 Mbit
 * connection, VoiceOver in Arabic, the OG card in an actual WhatsApp thread —
 * are recorded in `docs/landing-page-status.md` and are not pretended away.
 *
 * The most important gate in the document is §12 L1: "the page reads correctly
 * with JS disabled, in all three locales". That is the first block below,
 * because everything else is additive to it.
 */

const SCENES = [
  'hero',
  'problem',
  'corridor',
  'upload',
  'consent',
  'viewer',
  'appointment',
  'security',
  'doors',
  'questions',
  'close',
] as const;

/** The corridor's root carries `lang` and `dir`; the scenes hang off it. */
const ROOT = '.corridor';

async function scenesPresent(page: Page): Promise<void> {
  for (const id of SCENES) {
    await expect(page.locator(`#${id}`), `scene ${id}`).toHaveCount(1);
  }
}

// ---------------------------------------------------------------------------
// §12 L1 — the skeleton, with no JavaScript at all
// ---------------------------------------------------------------------------

test.describe('with JavaScript disabled (§12 L1, §9)', () => {
  test.use({ javaScriptEnabled: false });

  for (const locale of ['ar', 'fr', 'en'] as const) {
    test(`/${locale} renders all eleven scenes and reads correctly`, async ({ page }) => {
      await page.goto(`/${locale}`);

      await scenesPresent(page);

      // The headline is real text, not an image and not a canvas (§9).
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).not.toBeEmpty();

      // Every reveal's resting state is its correct state (§3.5): nothing on
      // the page may depend on a timeline having run.
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('landing-signup')).toBeVisible();

      /*
       * All eight answers are in the DOM at load, for SEO and for this case.
       * Scoped to the FAQ: the language and appearance controls in the chrome
       * are `<details>` too — deliberately, so they open before hydration —
       * and a bare `details` selector counted those as questions.
       */
      await expect(page.locator('.faq details')).toHaveCount(8);
      for (const answer of await page.locator('.faq-answer p').all()) {
        await expect(answer).not.toBeEmpty();
      }
    });
  }

  test('opens the language switcher with no script running', async ({ page }) => {
    /*
     * The reason the chrome controls are `<details>` rather than a JS menu.
     * A reader who cannot read the current page is the one who most needs the
     * language switcher, and asking them to wait for a bundle first is the
     * wrong order.
     */
    await page.goto('/ar');
    const control = page.locator('.control').first();
    await control.locator('summary').click();
    await expect(control).toHaveAttribute('open', '');
    // Real links to the prerendered locale routes, so they work with no script.
    await expect(control.locator('a[hreflang="fr"]')).toHaveAttribute('href', '/fr');
  });

  test('states the reference-only limit with no script running (§1.4)', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.getByTestId('viewer-banner')).toContainText(/مرجعي/);
  });
});

// ---------------------------------------------------------------------------
// §12 L2 — RTL and LTR parity
// ---------------------------------------------------------------------------

test.describe('direction (§3.6, §12 L2)', () => {
  test('declares its own language and direction per locale route', async ({ page }) => {
    /*
     * On the corridor root rather than on <html>: the application's root
     * layout serves one prerendered document with the platform default, and a
     * crawler, a link preview and a screen reader all read the HTML as served.
     * A nested lang/dir is what those attributes are for.
     */
    await page.goto('/ar');
    await expect(page.locator(ROOT)).toHaveAttribute('dir', 'rtl');
    await expect(page.locator(ROOT)).toHaveAttribute('lang', 'ar');

    await page.goto('/fr');
    await expect(page.locator(ROOT)).toHaveAttribute('dir', 'ltr');
    await expect(page.locator(ROOT)).toHaveAttribute('lang', 'fr');
  });

  test('never scrolls horizontally, in either direction, at any width (§14)', async ({ page }) => {
    // §14's four breakpoints. A horizontal scrollbar is invisible to anyone
    // looking for it — nothing appears cut off, the page just moves.
    for (const width of [360, 768, 1440, 2560]) {
      for (const locale of ['ar', 'en']) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/${locale}`);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const overflows = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        expect(overflows, `/${locale} at ${width}px scrolls horizontally`).toBe(false);
      }
    }
  });

  test('does not reverse the slice counter under RTL (§3.6)', async ({ page }) => {
    // A CT stack is not directional: scrolling down goes deeper in every
    // language, and "001 / 180" is a fraction, not a sentence. Bidi will
    // reorder the two digit runs unless the counter isolates them.
    await page.goto('/ar');
    await expect(page.locator('.slice-counter').first()).toHaveText(/^0*1\s*\/\s*180$/);
  });
});

// ---------------------------------------------------------------------------
// §12 L3 — the tier system
// ---------------------------------------------------------------------------

test.describe('tiering (§6.3, §12 L3)', () => {
  for (const tier of ['A', 'B', 'C'] as const) {
    test(`tier ${tier} renders a correct, complete layout`, async ({ page }) => {
      await page.goto(`/ar?tier=${tier}`);
      await scenesPresent(page);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('landing-signup')).toBeVisible();
    });
  }

  test('Tier C loads no slice sequence at all', async ({ page }) => {
    /*
     * The whole tier architecture rests on this. Tier C is where a
     * reduced-motion preference and a save-data header land, and it must cost
     * them nothing beyond the poster — §6.3: "poster only", not "fewer frames".
     */
    const frames: string[] = [];
    page.on('request', (r) => {
      if (/\/seq\/hero\/[ab]\/\d+\.avif$/.test(r.url())) frames.push(r.url());
    });

    await page.goto('/ar?tier=C');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    expect(frames, 'Tier C requested sequence frames').toEqual([]);
  });

  test('keeps the hero identical across tiers, so demotion is invisible', async ({ page }) => {
    // §6.3: "If a demotion causes a visible jump, the layout was
    // tier-dependent, which is a bug." The headline and the helix box are the
    // hero's two anchors; neither may move between the best tier and the worst.
    const boxes = async (tier: string) => {
      await page.goto(`/ar?tier=${tier}`);
      await page.waitForTimeout(400);
      return {
        h1: await page.locator('h1').boundingBox(),
        helix: await page.locator('#hero .helix').boundingBox(),
      };
    };

    const a = await boxes('A');
    const c = await boxes('C');
    for (const key of ['h1', 'helix'] as const) {
      expect(a[key], key).not.toBeNull();
      expect(c[key], key).not.toBeNull();
      expect(Math.abs((a[key]?.y ?? 0) - (c[key]?.y ?? 0)), key).toBeLessThan(2);
      expect(Math.abs((a[key]?.height ?? 0) - (c[key]?.height ?? 0)), key).toBeLessThan(2);
    }
  });

  test('puts the helix on the side away from the copy, in both directions (§3.6)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the side-by-side layout starts at 1000px');
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [locale, helixToTheRight] of [
      ['fr', true],
      ['ar', false],
    ] as const) {
      await page.goto(`/${locale}?tier=C`);
      const h1 = await page.locator('h1').boundingBox();
      const helix = await page.locator('#hero .helix').boundingBox();
      const h1Centre = (h1?.x ?? 0) + (h1?.width ?? 0) / 2;
      const helixCentre = (helix?.x ?? 0) + (helix?.width ?? 0) / 2;
      expect(helixCentre > h1Centre, locale).toBe(helixToTheRight);
    }
  });
});

// ---------------------------------------------------------------------------
// §12 L5 — the choreography must actually finish
// ---------------------------------------------------------------------------

test.describe('focal reveals (§3.5, §6.6, §12 L5)', () => {
  test('every reveal on the page resolves to full opacity and zero blur', async ({ page }) => {
    /*
     * The guard this page needed and did not have.
     *
     * `FocalReveal` animates FROM `autoAlpha: 0` and a blur, so a trigger that
     * never fires leaves its content permanently invisible — and nothing else
     * catches it. Tier C runs no timelines, so the no-JS and Tier C tests pass
     * while the page is broken; the scene ids are all present, so the
     * structural tests pass too. Scene 09 shipped as an empty black band
     * exactly once, because `content-visibility: auto` had collapsed the
     * sections above it and every trigger below the fold was positioned
     * against a page height that was never real.
     *
     * Each PLANE is scrolled to, not each scene. A scene can be taller than
     * the viewport — the corridor's map plate alone is most of one — so
     * bringing a section into view says nothing about the planes still below
     * its fold, whose reveals are correctly still waiting.
     */
    await page.goto('/ar?tier=A');
    await page.waitForTimeout(800);

    const planes = page.locator('[data-plane], [data-reveal]');
    const total = await planes.count();
    // If this ever finds nothing, the selector changed and the test is vacuous.
    expect(total).toBeGreaterThan(15);

    for (let i = 0; i < total; i++) {
      const plane = planes.nth(i);
      await plane.scrollIntoViewIfNeeded();

      /*
       * Polled, not slept on. The reveal is 620 ms, but this suite runs many
       * pages at once and a fixed wait measures the machine rather than the
       * page — the difference between "the trigger never fired" and "the
       * trigger fired late" is the whole point of the test, and a sleep
       * conflates them.
       */
      await expect
        .poll(
          () =>
            plane.evaluate((el) => {
              const cs = getComputedStyle(el);
              return {
                opacity: Number(cs.opacity),
                blurred: /blur\((?!0px)/.test(cs.filter),
                hidden: cs.visibility === 'hidden',
              };
            }),
          { message: `plane ${i} never resolved`, timeout: 10_000 },
        )
        .toEqual({ opacity: 1, blurred: false, hidden: false });
    }
  });

  test('an in-page anchor arrives at its scene and takes focus with it', async ({ page }) => {
    /*
     * The chrome nav and the hero's second CTA are in-page anchors, and a
     * native jump would move the document without telling Lenis, which then
     * animates back to the position it still believes is current. The click
     * handler in lib/site/scroll.ts routes them through Lenis instead, and
     * moves focus so the next Tab does not start again from the top.
     */
    await page.goto('/ar?tier=A');

    /*
     * Wait for the scroll system rather than for a stopwatch. It is started
     * from an idle callback so the animation runtime is fetched after LCP
     * (§8.2), and under load "idle" can be a second or more away — a fixed
     * delay here measures the machine, not the page.
     */
    await expect(page.locator('h1 [data-unit]').first()).toBeVisible({ timeout: 15_000 });

    await page.locator('.chrome-link[href="#security"]').first().click();

    const security = page.locator('#security');
    // Lenis animates over ~1.1 s; the assertion polls rather than guessing.
    await expect(security).toBeInViewport({ ratio: 0.1, timeout: 10_000 });
    await expect(security).toBeFocused();

    /*
     * And it stays there. A Lenis snap-back — the failure this handler exists
     * to prevent — would drag the section out and never bring it back.
     *
     * Polled rather than asserted once, because there is one legitimate shift
     * to tolerate: `ScrollTrigger.refresh()` runs when `document.fonts.ready`
     * settles (§6.4 requires it, since Arabic and Latin have different content
     * heights), and refreshing recomputes the pinned Scene 02 spacer, which
     * moves everything below it by a few pixels. That is a one-time settle and
     * it resolves; a snap-back does not.
     */
    await page.waitForTimeout(1500);
    await expect(security).toBeInViewport({ ratio: 0.1, timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// §12 L6 — the upload demo
// ---------------------------------------------------------------------------

test.describe('the upload demo (§Scene 04, §12 L6)', () => {
  test('is operable with the keyboard alone and announces its state', async ({ page }) => {
    await page.goto('/ar?tier=B');

    /*
     * Wait for the element to exist before reaching for it.
     *
     * The server renders Tier C — the safe tier, whose upload scene is three
     * static states — and detection promotes to A or B after mount, which
     * swaps that subtree for the interactive demo. Grabbing `upload-cut` and
     * scrolling to it in the same breath caught the swap in progress and
     * failed with "element is not attached to the DOM", reproducibly against
     * the container and intermittently everywhere else.
     */
    const cut = page.getByTestId('upload-cut');
    await expect(cut).toBeAttached({ timeout: 15_000 });
    await cut.scrollIntoViewIfNeeded();
    /*
     * The simulation starts when the scene is seen, and the button is disabled
     * until then — the demo is meant to be watched, not found already
     * finished. The generous timeout is for hydration under parallel workers,
     * not for the observer: the component checks its own rectangle at mount
     * precisely so that "already on screen" does not depend on a notification.
     */
    await expect(cut).toBeEnabled({ timeout: 15_000 });

    // Focused and pressed by keyboard, never by a click.
    await cut.focus();
    await expect(cut).toBeFocused();
    await page.keyboard.press('Enter');

    const live = page.locator('[role="status"][aria-live="polite"]').first();
    await expect(live).toContainText(/انقطع|توقف/, { timeout: 3000 });

    // It resumes on its own, and says so — the argument of the whole scene.
    await expect(live).toContainText(/استؤنف|عاد/, { timeout: 12_000 });
  });

  test('makes no network request while it runs (§Scene 04)', async ({ page }) => {
    // "The simulation is fake and local — no network calls, no real upload."
    // A demo that quietly talked to an API would be a very different claim.
    const uploads: string[] = [];
    page.on('request', (r) => {
      if (/upload|chunk|\/api\//.test(r.url()) && r.method() !== 'GET') uploads.push(r.url());
    });

    await page.goto('/ar?tier=B');
    // Same reason as above: the demo replaces Tier C's static states on
    // promotion, so it has to exist before it can be scrolled to.
    const demo = page.getByTestId('upload-cut');
    await expect(demo).toBeAttached({ timeout: 15_000 });
    await demo.scrollIntoViewIfNeeded();
    await page.waitForTimeout(3000);

    expect(uploads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §Scene 05 — consent, and the revoke toggle that is the scene's argument
// ---------------------------------------------------------------------------

test.describe('consent (§Scene 05)', () => {
  test('revoking darkens the studies and appends the withdrawal to the record', async ({
    page,
  }) => {
    await page.goto('/ar?tier=B');

    const revoke = page.getByTestId('consent-revoke');
    await revoke.scrollIntoViewIfNeeded();

    /*
     * Wait for hydration before pressing anything. The toggle is a CONTROLLED
     * checkbox, so until React has attached its handler the browser's own
     * toggle is immediately reverted by the next render and the keystroke
     * appears to do nothing. The thumbnails are resolved in an effect, so
     * their presence is proof the component has mounted and its effects ran.
     */
    await expect(page.locator('.consent-thumb-row img').first()).toBeAttached({
      timeout: 15_000,
    });

    /*
     * And wait for the focal reveal to have run, which matters more than it
     * looks. `FocalReveal` animates from `autoAlpha: 0`, and GSAP's autoAlpha
     * sets `visibility: hidden` — an element inside a hidden subtree cannot
     * hold focus, so `focus()` before the reveal silently does nothing and the
     * Space keystroke goes to the document and scrolls the page instead of
     * toggling anything. The input itself is 1px and transparent by design, so
     * the switch's track is what "revealed" is asserted on.
     */
    await expect(page.locator('.consent-switch-track')).toBeVisible({ timeout: 15_000 });

    const thumbs = page.locator('.consent-thumbs');
    await expect(thumbs).toHaveAttribute('data-revoked', 'false');
    await expect(page.locator('.evidence')).not.toContainText('revoked_at');

    // Keyboard, again: this is a real checkbox and has to behave like one.
    await revoke.focus();
    await expect(revoke).toBeFocused();
    await page.keyboard.press('Space');

    /*
     * The control's own state is settled before the second press. Firing two
     * Space keystrokes back to back raced React's commit under parallel
     * workers and the second one landed on a stale checkbox — a flake in the
     * test, not in the page, but one that would be read as the page's fault.
     */
    await expect(revoke).toBeChecked();
    await expect(thumbs).toHaveAttribute('data-revoked', 'true');
    await expect(page.locator('.evidence')).toContainText('revoked_at');

    // And back, because §Scene 05's point is that the effect is immediate in
    // both directions.
    await page.keyboard.press('Space');
    await expect(revoke).not.toBeChecked();
    await expect(thumbs).toHaveAttribute('data-revoked', 'false');
  });

  test('names no doctor (§1.4)', async ({ page }) => {
    // No named clinician without written permission, and no invented one. The
    // record shows a redaction and a country, which is what a real evidence
    // block shows to anyone but the patient.
    await page.goto('/ar');
    await page.locator('.evidence').scrollIntoViewIfNeeded();
    await expect(page.locator('.evidence')).toContainText('———');
  });
});

// ---------------------------------------------------------------------------
// §9 — accessibility affordances the page is required to carry
// ---------------------------------------------------------------------------

test.describe('accessibility (§9)', () => {
  test('offers a skip link as the first focusable element', async ({ page }) => {
    await page.goto('/ar');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(focused).toContain('skip-link');
  });

  test('has exactly one main landmark and one marketing scope', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('.marketing')).toHaveCount(1);
  });

  test('names each language in its own script, never with a flag (§9)', async ({ page }) => {
    await page.goto('/en');
    const switcher = page.locator('.footer-locales');
    await switcher.scrollIntoViewIfNeeded();
    await expect(switcher).toContainText('العربية');
    await expect(switcher).toContainText('Français');
    await expect(switcher).toContainText('English');
    // Each alternate carries hreflang, so the switcher is also the SEO signal.
    await expect(switcher.locator('a[hreflang="ar"]')).toHaveCount(1);
  });

  test('offers a manual reduce-motion switch that persists (§6.8)', async ({ page }) => {
    await page.goto('/ar?tier=A');

    const toggle = page.getByTestId('footer-reduce-motion');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.check();

    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('mir.site.reduced-motion')))
      .toBe('on');

    // Survives a reload, which is the whole point of a preference.
    await page.reload();
    const after = page.getByTestId('footer-reduce-motion');
    await after.scrollIntoViewIfNeeded();
    await expect(after).toBeChecked();
  });

  test('leaves sound off until it is asked for (§2.2, §16)', async ({ page }) => {
    // Autoplaying sound is instant abandonment, and on a shared clinic desktop
    // it is genuinely embarrassing for the user.
    await page.goto('/ar?tier=A');
    const sound = page.getByTestId('footer-sound');
    await sound.scrollIntoViewIfNeeded();
    await expect(sound).not.toBeChecked();
    expect(
      await page.evaluate(() => window.localStorage.getItem('mir.site.sound')),
    ).not.toBe('on');
  });
});

// ---------------------------------------------------------------------------
// §10 — the routes themselves
// ---------------------------------------------------------------------------

test.describe('locale routes (§10)', () => {
  test('serves a prerendered page per locale with its own metadata', async ({ page }) => {
    for (const [locale, fragment] of [
      ['ar', /الصورة تصل/],
      ['fr', /avant le patient/],
      ['en', /before they do/],
    ] as const) {
      const response = await page.goto(`/${locale}`);
      expect(response?.status(), `/${locale}`).toBe(200);
      await expect(page).toHaveTitle(fragment);
      await expect(page.locator('h1')).toHaveText(fragment);
    }
  });

  test('declares every alternate, including x-default', async ({ page }) => {
    await page.goto('/fr');
    for (const lang of ['ar', 'fr', 'en', 'x-default']) {
      await expect(
        page.locator(`link[rel="alternate"][hreflang="${lang}"]`),
        lang,
      ).toHaveCount(1);
    }
  });

  test('does not swallow unknown paths (dynamicParams: false)', async ({ page }) => {
    // A bare [locale] segment at the root would match every one-segment path in
    // the application. These must stay 404s.
    for (const path of ['/schedule', '/appointments', '/zz']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// The particle helix — spec 2026-09-10 §5
// ---------------------------------------------------------------------------

test.describe('the helix (spec §5)', () => {
  test('runs on Tier A and keeps drawing', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Tier A is a desktop tier');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');

    const helix = page.locator('#hero .helix');
    await expect(helix).toHaveAttribute('data-helix-state', 'running', { timeout: 20_000 });

    // Two frames apart must differ: a stalled loop or a blank canvas would not.
    const first = await helix.screenshot();
    await page.waitForTimeout(600);
    const second = await helix.screenshot();
    expect(first.equals(second), 'the helix did not move in 600 ms').toBe(false);
  });

  test('builds its particle buffers inside the frame budget (spec §10)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Tier A is a desktop tier');
    await page.goto('/fr?tier=A');
    await expect(page.locator('#hero .helix')).toHaveAttribute('data-helix-state', 'running', {
      timeout: 20_000,
    });
    const ms = await page.evaluate(
      () => performance.getEntriesByName('helix:geometry')[0]?.duration ?? Number.POSITIVE_INFINITY,
    );
    // The spec's target is <= 10 ms on a real device. Measured here — WSL2 +
    // SwiftShader software WebGL2 + Docker, ~8 GB RAM, machine otherwise idle
    // (load average ~2 over 5 runs) — the range was 21.1-32.3 ms, median
    // 29.4 ms. 40 ms is a regression tripwire for THIS environment, not the
    // spec budget; a real-device measurement is still owed.
    expect(ms).toBeLessThan(40);
  });

  test('is only its poster on Tier C — no canvas at all', async ({ page }) => {
    await page.goto('/fr?tier=C');
    const helix = page.locator('#hero .helix');
    await expect(helix).toHaveAttribute('data-helix-state', 'poster');
    await expect(helix.locator('canvas')).toHaveCount(0);
    await expect(helix.locator('.helix-poster')).toBeVisible();
  });

  test('is only its poster for a reader who asked for reduced motion (§6.8)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/fr');
    const helix = page.locator('#hero .helix');
    await page.waitForTimeout(2500);
    await expect(helix).toHaveAttribute('data-helix-state', 'poster');
    await expect(helix.locator('canvas')).toHaveCount(0);
  });

  test('falls back to its poster when the browser has no WebGL2', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2') return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await page.goto('/fr?tier=A');

    // Wait until the renderer was actually attempted, or this proves nothing.
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName('helix:build').length), {
        timeout: 15_000,
      })
      .toBe(1);
    const helix = page.locator('#hero .helix');
    await expect(helix).toHaveAttribute('data-helix-state', 'poster');
    await expect(helix.locator('.helix-poster')).toHaveCSS('opacity', '1');
  });

  test('ships a poster per direction', async ({ request }) => {
    for (const dir of ['ltr', 'rtl']) {
      const response = await request.get(`/helix/poster-${dir}.avif`);
      expect(response.status(), dir).toBe(200);
      expect(response.headers()['content-type'], dir).toContain('image/avif');
    }
  });
});
