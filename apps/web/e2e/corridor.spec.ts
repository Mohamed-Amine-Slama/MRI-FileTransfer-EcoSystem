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
     * `BlurIn` animates FROM `opacity: 0` and a blur, and `WordReveal`'s word
     * spans animate FROM `opacity: 0` too, so a trigger that never fires
     * leaves its content permanently invisible — and nothing else catches it.
     * Tier C runs no timelines, so the no-JS and Tier C tests pass while the
     * page is broken; the scene ids are all present, so the structural tests
     * pass too. Scene 09 shipped as an empty black band exactly once, because
     * `content-visibility: auto` had collapsed the sections above it and
     * every trigger below the fold was positioned against a page height that
     * was never real.
     *
     * Each reveal is scrolled to, not each scene. A scene can be taller than
     * the viewport — the corridor's map plate alone is most of one — so
     * bringing a section into view says nothing about the reveals still below
     * its fold, which are correctly still waiting.
     */
    await page.goto('/ar?tier=A');
    await page.waitForTimeout(800);

    /*
     * `[data-unit]` covers `WordReveal`'s word spans (components/corridor/
     * motion/WordReveal.tsx), which animate from `opacity: 0` under a tween
     * that only plays once the load curtain lifts — exactly the failure mode
     * this guard exists to catch, on the page's most important element (the
     * hero's own headline), and previously uncovered by this selector.
     */
    const reveals = page.locator('[data-reveal], [data-unit]');
    const total = await reveals.count();
    // If this ever finds nothing, the selector changed and the test is vacuous.
    expect(total).toBeGreaterThan(15);

    for (let i = 0; i < total; i++) {
      const reveal = reveals.nth(i);

      /*
       * Scrolled to the viewport's CENTER, not `scrollIntoViewIfNeeded()`.
       * That API stops at the nearest edge — the least scroll that makes an
       * element technically visible — which on a narrow mobile viewport can
       * land a few pixels short of the reveal's own `top 85%` trigger and
       * then never move again: `once: true` does not get a second chance,
       * and nothing else scrolls the page for the rest of the poll below.
       * Desktop's wide layout happened to overshoot that threshold by
       * hundreds of pixels on every jump and so never exposed this; a narrow
       * viewport's closely-packed reveals do not get the same margin.
       * Centering clears `top 85%` on any viewport this page supports.
       */
      await reveal.evaluate((el) => el.scrollIntoView({ block: 'center' }));

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
            reveal.evaluate((el) => {
              const cs = getComputedStyle(el);
              return {
                opacity: Number(cs.opacity),
                blurred: /blur\((?!0px)/.test(cs.filter),
                hidden: cs.visibility === 'hidden',
              };
            }),
          { message: `reveal ${i} never resolved`, timeout: 10_000 },
        )
        .toEqual({ opacity: 1, blurred: false, hidden: false });
    }
  });

  test('an in-page anchor arrives at its scene and takes focus with it', async ({ page, isMobile }) => {
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

    /*
     * `.chrome-link[href="#security"]` matches two elements: the desktop
     * nav's copy (`.chrome-nav`, `display: none` below 900px) and the
     * toggle sheet's copy (`#chrome-menu`, hidden until opened). `.first()`
     * always resolves to the desktop one regardless of viewport — on a
     * narrow one it stays permanently invisible and the click never lands,
     * which is exactly what CorridorChrome.tsx intends (§7.3: the sheet is
     * the mobile equivalent, not a fallback), so a mobile run has to open
     * the toggle and click the sheet's own link instead.
     */
    if (isMobile) {
      await page.locator('.chrome-toggle').click();
      await page.locator('#chrome-menu .chrome-link[href="#security"]').click();
      // The link's own onClick closes the sheet; it must not linger over
      // the scene it just navigated to.
      await expect(page.locator('#chrome-menu')).toBeHidden();
    } else {
      await page.locator('.chrome-link[href="#security"]').first().click();
    }

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
     * heights), and refreshing recomputes the pinned Scene 09 spacer, which
     * moves everything below it by a few pixels. That is a one-time settle and
     * it resolves; a snap-back does not.
     */
    await page.waitForTimeout(1500);
    await expect(security).toBeInViewport({ ratio: 0.1, timeout: 8000 });
  });

  test('an anchor to a stacked panel arrives even while that panel is stuck (spec §3.3)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the chrome nav is a desktop control');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');
    const upload = page.locator('#upload');
    await expect(upload).toHaveClass(/is-stacking/, { timeout: 15_000 });

    // Park the reader inside the consent panel, with the upload panel stuck behind it.
    await page.evaluate(() => {
      const consent = document.getElementById('consent');
      if (consent === null) return;
      // `static`, not `relative` — see the comment on `flowTop` in
      // lib/site/scroll.ts. `relative` still honours the sticky rule's own
      // `inset-block-start`, which understates a tall panel's flow top by
      // (panel height − viewport height).
      consent.style.position = 'static';
      const top = consent.getBoundingClientRect().top + window.scrollY;
      consent.style.position = '';
      window.scrollTo(0, top + 200);
    });
    await page.waitForTimeout(800);

    await page.locator('.chrome-link[href="#upload"]').first().click();

    /*
     * A STUCK panel reads rect.top === 0 for its WHOLE sticky range, not only
     * at the moment it arrives: #upload is "stuck" for roughly its own
     * height's worth of scroll before it (correctly, per §3.3's release
     * mechanic) lets go of the next panel underneath. Polling its bounding
     * box alone resolves as soon as that range is entered — while Lenis's
     * ~1.1 s scroll is still hundreds of pixels short of its target — so it
     * is not a safe arrival signal here the way it is for a non-sticky scene.
     * Focus only moves in `onComplete`, once the scroll has actually settled
     * (the same signal the in-page-anchor test above waits on), so it is.
     */
    await expect(upload).toBeFocused({ timeout: 10_000 });
    await expect
      .poll(async () => Math.abs((await upload.boundingBox())?.y ?? 999), { timeout: 2000 })
      .toBeLessThan(4);
    // …and it is the upload panel on screen, not the consent panel over it.
    await expect
      .poll(async () => (await page.locator('#consent').boundingBox())?.y ?? 0, { timeout: 2000 })
      .toBeGreaterThan(400);
  });

  test('a mobile chrome-menu anchor to a stacked panel also arrives at its flow top (spec §3.3, §15.8)', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the chrome toggle sheet is the mobile equivalent of the desktop nav');
    await page.goto('/fr?tier=A');

    const consent = page.locator('#consent');
    await expect(consent).toHaveClass(/is-stacking/, { timeout: 15_000 });

    await page.locator('.chrome-toggle').click();
    await page.locator('#chrome-menu .chrome-link[href="#consent"]').click();

    // Same arrival signal as the desktop stacked-anchor test above: focus
    // only moves once Lenis's scroll has actually settled.
    await expect(consent).toBeFocused({ timeout: 10_000 });
    await expect
      .poll(async () => Math.abs((await consent.boundingBox())?.y ?? 999), { timeout: 2000 })
      .toBeLessThan(4);
    // The link's own onClick closes the sheet; it should not still be
    // covering the panel it just navigated to.
    await expect(page.locator('#chrome-menu')).toBeHidden();
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
     * looks. Reveals used to animate from `autoAlpha: 0`, which sets
     * `visibility: hidden`; `BlurIn` uses opacity, but the wait is kept as
     * proof the scene has hydrated — an element inside a hidden subtree cannot
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

  test('un-dims scroll-lit text once the reduce-motion switch drops the page to Tier C (§8, §12 L5)', async ({
    page,
  }) => {
    /*
     * ScrollLitText's words start `data-lit="off"` (`--c-ink-muted`) and
     * light up as the reader scrolls through S03. Checking the switch forces
     * Tier C immediately (site-provider.tsx), which kills the ScrollTrigger
     * that lights them — and a one-way "have I ever animated" latch used to
     * leave every word frozen at whatever `data-lit` it last had, muted,
     * because the split words never went back to being the plain text §8's
     * Tier C row promises is already lit.
     */
    await page.goto('/ar?tier=A');

    const toggle = page.getByTestId('footer-reduce-motion');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.check();

    const title = page.locator('#corridor-title');
    await title.scrollIntoViewIfNeeded();

    // Tier C renders plain text, not a lit/muted split, at all.
    await expect(page.locator('#corridor [data-lit]')).toHaveCount(0);
    await expect
      .poll(async () => title.evaluate((el) => getComputedStyle(el).color))
      .toBe('rgb(0, 0, 0)');
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

  test('the mobile header menu closes on Escape and returns focus to its toggle', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the chrome toggle only exists below the desktop breakpoint');
    await page.goto('/fr');

    const toggle = page.locator('.chrome-toggle');
    const menu = page.locator('#chrome-menu');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
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

    /*
     * `data-helix-state` flips to `running` the instant the render loop
     * starts, but `.helix-poster` still has 400ms left on its crossfade
     * (app/corridor.css) at that moment. Screenshotting immediately compares
     * a frame with the poster still fading over the canvas against one
     * without it — the two frames would differ because the poster faded, not
     * because the canvas drew anything. Waiting for the crossfade to finish
     * isolates the comparison to the canvas alone.
     */
    await expect(helix.locator('.helix-poster')).toHaveCSS('opacity', '0');

    /*
     * A direct "is the canvas blank" readback was tried here and removed.
     * `canvas.getContext('webgl2')` cannot be reused for it — a second
     * context request on the same canvas returns the first context rather
     * than a fresh one for reading — and drawing the live canvas into a 2D
     * canvas via `drawImage` is not reliable either: `preserveDrawingBuffer`
     * is false for the live renderer (only the `?helix-still` capture sets it
     * true), so the drawing buffer's content outside the exact task that
     * rendered it is undefined by spec, and `page.evaluate` never runs in
     * that task — it round-trips over CDP. This was not theoretical: with
     * that check in place, this test failed with "painted no visible
     * pixels" on a run whose own failure screenshot (Playwright's
     * `helix.screenshot()`, which captures the actually-composited page)
     * plainly showed the helix's green particles on screen. So the
     * before/after diff below, on a wait anchored to the poster's crossfade
     * actually finishing, is the reliable version of this assertion.
     */

    // Two frames apart must differ: a stalled loop or a blank canvas would not.
    const first = await helix.screenshot();
    await page.waitForTimeout(600);
    const second = await helix.screenshot();
    expect(first.equals(second), 'the helix did not move in 600 ms').toBe(false);
  });

  test('records its geometry build time (the 40 ms tripwire is opt-in)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Tier A is a desktop tier');
    await page.goto('/fr?tier=A');
    await expect(page.locator('#hero .helix')).toHaveAttribute('data-helix-state', 'running', {
      timeout: 20_000,
    });
    // Namespaced per host (spec fix §2): the hero is `#hero`, so its mark is
    // `helix:geometry:hero`. A second HelixCanvas (Plan 3's close scene) gets
    // its own `helix:geometry:close` and cannot collide with this one.
    const ms = await page.evaluate(
      () => performance.getEntriesByName('helix:geometry:hero')[0]?.duration ?? Number.NaN,
    );
    expect(Number.isFinite(ms), 'the hero published its helix:geometry:hero measure').toBe(true);
    test.info().annotations.push({ type: 'helix:geometry:hero', description: `${ms.toFixed(1)} ms` });

    /*
     * The spec's target is <= 10 ms on a real device, still unmeasured. 40 ms
     * was a regression tripwire for the WSL2 + SwiftShader development
     * machine, set when it measured 21.1-32.3 ms idle. That machine later
     * measured 42, 55, 76 and 84 ms — alongside passes — on identical
     * geometry code, on a quiet machine as well as a loaded one, so as a
     * default assertion it failed on noise. It asserts only where someone
     * has opted in on hardware whose timings hold still.
     */
    if (process.env['MIR_PERF_TRIPWIRE'] === '1') {
      expect(ms, 'helix:geometry:hero build time in ms').toBeLessThan(40);
    }
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

  test('falls back to its poster when the browser has no WebGL2, and never fetches the renderer chunk', async ({
    page,
  }) => {
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

    /*
     * Fix §1 makes `HelixCanvas` probe WebGL2 on a throwaway canvas (which
     * this stub also defeats) and skip `import('./helix-renderer')` entirely
     * when it is absent — so the old assertion here, polling `helix:build` to
     * length 1, can now never resolve and would hang for its full 15s
     * timeout. What actually matters is provable over the network instead:
     * the renderer chunk must never even be requested.
     *
     * Matched by content, not URL — webpack assigns the chunk a hashed
     * filename, not a stable one. `uPointerStrength` is a uniform name used
     * unconditionally in every frame's draw call (helix-renderer.ts), so it
     * survives production minification (unlike the dev-only `warn(...)`
     * strings in the same file), and it appears nowhere outside the
     * `import('./helix-renderer')` boundary: helix-shaders.ts and
     * helix-geometry.ts are only ever reached through helix-renderer.ts,
     * and helix-config.ts — which HelixCanvas.tsx does import eagerly — does
     * not declare it.
     */
    let rendererChunkFetched = false;
    page.on('response', (response) => {
      if (!/_next\/static\/.*\.js(?:\?|$)/.test(response.url())) return;
      response
        .text()
        .then((body) => {
          if (body.includes('uPointerStrength')) rendererChunkFetched = true;
        })
        .catch(() => {
          // Aborted or redirected response — irrelevant to this check.
        });
    });

    await page.goto('/fr?tier=A');

    const helix = page.locator('#hero .helix');
    await expect(helix).toHaveAttribute('data-helix-state', 'poster');
    /*
     * Long enough to cover the idle callback's own timeout and the entrance's
     * assemble window this scene would otherwise use — if the gate leaked,
     * this is the window where `poster` would flip to `loading` or `running`.
     */
    await page.waitForTimeout(3000);
    await expect(helix).toHaveAttribute('data-helix-state', 'poster');
    await expect(helix.locator('.helix-poster')).toHaveCSS('opacity', '1');

    expect(rendererChunkFetched, 'the helix-renderer chunk was requested despite no WebGL2').toBe(false);
  });

  test('ships a poster per direction', async ({ request }) => {
    for (const dir of ['ltr', 'rtl']) {
      const response = await request.get(`/helix/poster-${dir}.avif`);
      expect(response.status(), dir).toBe(200);
      expect(response.headers()['content-type'], dir).toContain('image/avif');
    }
  });

  test('returns at the close, already assembled, and only one helix animates at a time', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Tier A is a desktop tier');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');
    await expect(page.locator('#hero .helix')).toHaveAttribute('data-helix-state', 'running', {
      timeout: 20_000,
    });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const close = page.locator('#close .helix');
    await expect(close).toHaveAttribute('data-helix-state', 'running', { timeout: 20_000 });
    await expect(page.locator('#hero .helix')).toHaveAttribute('data-helix-state', 'paused');
    await expect(page.getByTestId('landing-close-signup')).toBeVisible();

    // `HelixCanvas`'s `hostRef` inside S11Close points at an unlabelled inner
    // `<div>`, not the `#close` section itself — the label must resolve
    // through the nearest id'd ancestor, not fall back to the generic
    // `helix` label the way an unlabelled instance would.
    const [closeMeasures, genericMeasures] = await page.evaluate(() => [
      performance.getEntriesByName('helix:build:close').length,
      performance.getEntriesByName('helix:build:helix').length,
    ]);
    expect(closeMeasures).toBeGreaterThanOrEqual(1);
    expect(genericMeasures).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scene 09 — the door track, the page's one pin (§6.4)
// ---------------------------------------------------------------------------

test.describe('the door track (spec §7.2)', () => {
  test('pins while its cards travel toward the reader, then lets go', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the pinned track needs a fine pointer and 900px');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');
    await expect(page.locator('#doors .track-viewport')).toHaveClass(/is-pinned/, { timeout: 15_000 });

    const top = await page.evaluate(
      () => (document.getElementById('doors')?.getBoundingClientRect().top ?? 0) + window.scrollY,
    );
    await page.evaluate((y) => window.scrollTo(0, y - 10), top);
    await page.waitForTimeout(800);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1500);

    const pinned = await page.locator('#doors').boundingBox();
    expect(Math.abs(pinned?.y ?? 99), 'the section is held at the top').toBeLessThan(2);
    const x = await page
      .locator('#doors .track')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    expect(x, 'the cards moved toward the reader\'s forward (leftward in fr)').toBeLessThan(-50);

    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1500);
    const released = await page.locator('#doors').boundingBox();
    expect(released?.y ?? 0, 'released after its travel').toBeLessThan(-100);
  });

  test('keyboard focus brings the pinned door fully into view (§7.2, §9)', async ({
    page,
    isMobile,
    browserName,
  }) => {
    test.skip(isMobile, 'the pinned track needs a fine pointer and 900px');
    test.skip(browserName !== 'chromium', 'one browser is enough for a layout assertion');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');
    await expect(page.locator('#doors .track-viewport')).toHaveClass(/is-pinned/, { timeout: 15_000 });
    /*
     * Let the post-load settle finish before tabbing: `lib/site/scroll.ts`
     * refreshes ScrollTrigger once `document.fonts.ready` resolves (Arabic
     * and Latin have different content heights), and this pin's
     * `start`/`end` — which the fix below reads live — are only their final
     * values after that refresh. Racing it landed the second Tab's computed
     * scroll target against a still-provisional geometry.
     */
    await page.waitForTimeout(1500);

    /*
     * A temporary focusable element right before the track — the shortest
     * real Tab sequence that reaches it, independent of how many focusable
     * elements the rest of the page happens to carry.
     */
    await page.evaluate(() => {
      const probe = document.createElement('button');
      probe.id = 'e2e-probe-before-doors';
      probe.textContent = 'probe';
      document.querySelector('#security .shell')?.appendChild(probe);
      probe.focus();
    });

    await page.keyboard.press('Tab'); // the doctors' door
    // A settling beat between the two tabs: the first one triggers a scroll
    // (this fix), and firing the second before it has caught up raced the
    // browser's own focus bookkeeping under load.
    await page.waitForTimeout(400);
    await page.keyboard.press('Tab'); // the patients' door — mostly off-screen before this fix

    const patients = page.getByTestId('door-patients');
    await expect(patients).toBeFocused({ timeout: 10_000 });
    // The scroll this fix triggers is "immediate", not animated, but give it
    // one settling beat before reading geometry.
    await page.waitForTimeout(200);

    const box = await patients.boundingBox();
    expect(box).not.toBeNull();
    const viewportWidth = page.viewportSize()?.width ?? 1440;
    const visible =
      Math.max(0, Math.min((box?.x ?? 0) + (box?.width ?? 0), viewportWidth) - Math.max(box?.x ?? 0, 0)) /
      (box?.width ?? 1);
    expect(visible, 'the focused door is ≥90% within the viewport').toBeGreaterThanOrEqual(0.9);
  });

  test('a mouse press on a partly hidden door leaves the page where it is (§7.2)', async ({
    page,
    isMobile,
    browserName,
  }) => {
    test.skip(isMobile, 'the pinned track needs a fine pointer and 900px');
    test.skip(browserName !== 'chromium', 'Chromium focuses a link on mousedown, which is the path under test');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fr?tier=A');
    await expect(page.locator('#doors .track-viewport')).toHaveClass(/is-pinned/, { timeout: 15_000 });
    // The post-load ScrollTrigger refresh, as in the keyboard test above.
    await page.waitForTimeout(1500);

    // Hold the pin at its start, where the patients' door is cut by the
    // viewport's edge — the card the keyboard fix would scroll to center.
    const start = await page.evaluate(
      () => (document.getElementById('doors')?.getBoundingClientRect().top ?? 0) + window.scrollY,
    );
    await page.evaluate((y) => window.scrollTo(0, y + 1), start);
    await page.waitForTimeout(1500);

    const patients = page.getByTestId('door-patients');
    const box = await patients.boundingBox();
    expect(box).not.toBeNull();
    const viewportWidth = page.viewportSize()?.width ?? 1440;
    const left = Math.max(box?.x ?? 0, 0);
    const right = Math.min((box?.x ?? 0) + (box?.width ?? 0), viewportWidth);
    const visible = Math.max(0, right - left) / (box?.width ?? 1);
    expect(visible, 'precondition: the door is only partly on screen').toBeGreaterThan(0.05);
    expect(visible, 'precondition: the door is only partly on screen').toBeLessThan(0.9);

    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move((left + right) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await page.mouse.down();
    // A deliberate press, not a tap: the jump this guards against landed
    // well inside 150 ms, before the button came back up.
    await page.waitForTimeout(150);
    await expect(patients, 'precondition: the press focused the door').toBeFocused();
    const during = await page.evaluate(() => window.scrollY);
    await page.mouse.up();

    expect(Math.abs(during - before), 'the press scrolled the page').toBeLessThan(2);
  });

  test('is a native swipe row when motion is reduced', async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/fr');
    const viewport = page.locator('#doors .track-viewport');
    await expect(viewport).not.toHaveClass(/is-pinned/);
    await expect(viewport).toHaveCSS('overflow-x', 'auto');
    // Snapping is the thumb's affordance, so it is gated on a coarse pointer —
    // see the wheel test below for why it cannot be on for a mouse.
    await expect(viewport).toHaveCSS('scroll-snap-type', isMobile ? 'x mandatory' : 'none');
    await expect(page.getByTestId('door-doctors')).toBeVisible();
  });

  /*
   * Below 900px the track is not pinned, so the doors are only reachable by
   * scrolling the strip itself. With `scroll-snap-type: x mandatory` a mouse
   * could not do it: snap points sit one card (~356px) apart, a wheel notch is
   * ~120px, and each notch is its own gesture — so the strip snapped back to
   * where it started every time and the two doors, which are the page's two
   * primary calls to action, were simply unreachable at that width.
   *
   * A thumb never hit this because one drag travels far enough to cross the
   * halfway threshold in a single gesture.
   */
  test('a wheel can reach the doors on the unpinned strip (§7.2)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a wheel needs a fine pointer; a thumb drags the strip instead');
    await page.setViewportSize({ width: 412, height: 900 });
    await page.goto('/fr');

    const viewport = page.locator('#doors .track-viewport');
    await expect(viewport).not.toHaveClass(/is-pinned/);

    // The strip has to genuinely overflow, or the rest of this proves nothing.
    const travel = await viewport.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(travel, 'the strip does not overflow, so there is nothing to scroll').toBeGreaterThan(200);

    await page.evaluate(() => {
      const doors = document.getElementById('doors');
      if (doors !== null) window.scrollTo(0, doors.getBoundingClientRect().top + window.scrollY - 120);
    });
    await page.waitForTimeout(1000);

    const box = await viewport.boundingBox();
    if (box === null) throw new Error('the track viewport has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const before = await viewport.evaluate((el) => el.scrollLeft);
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(120, 0);
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(600);
    const after = await viewport.evaluate((el) => el.scrollLeft);

    expect(after - before, 'a wheel over the strip did not move it').toBeGreaterThan(200);
    await expect(page.getByTestId('door-patients')).toBeInViewport();
  });
});
