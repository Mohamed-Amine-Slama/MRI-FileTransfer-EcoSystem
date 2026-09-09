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

      // All eight answers are in the DOM at load, for SEO and for this case.
      await expect(page.locator('details')).toHaveCount(8);
      for (const answer of await page.locator('.faq-answer p').all()) {
        await expect(answer).not.toBeEmpty();
      }
    });
  }

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
    // tier-dependent, which is a bug." The cheapest proof is that the hero's
    // own geometry does not move between the best tier and the worst.
    const box = async (tier: string) => {
      await page.goto(`/ar?tier=${tier}`);
      await page.waitForTimeout(400);
      return page.locator('h1').boundingBox();
    };

    const a = await box('A');
    const c = await box('C');
    expect(a).not.toBeNull();
    expect(c).not.toBeNull();
    expect(Math.abs((a?.y ?? 0) - (c?.y ?? 0))).toBeLessThan(2);
    expect(Math.abs((a?.height ?? 0) - (c?.height ?? 0))).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// §12 L5 — the choreography must actually finish
// ---------------------------------------------------------------------------

test.describe('focal reveals (§3.5, §6.6, §12 L5)', () => {
  test('every scene resolves to full opacity and zero blur once reached', async ({ page }) => {
    /*
     * The guard this page needed and did not have.
     *
     * `FocalReveal` animates FROM `autoAlpha: 0` and a blur, so a trigger that
     * never fires leaves its scene permanently invisible — and nothing else
     * catches it. Tier C runs no timelines, so the no-JS and Tier C tests pass
     * while the page is broken; the scene ids are all present, so the
     * structural tests pass too. Scene 09 shipped as an empty black band
     * exactly once, because `content-visibility: auto` had collapsed the
     * sections above it and every trigger below the fold was positioned
     * against the wrong page height.
     *
     * This asserts the thing that actually matters: after you have scrolled to
     * a scene, you can see it.
     */
    await page.goto('/ar?tier=A');

    for (const id of SCENES) {
      const scene = page.locator(`#${id}`);
      await scene.scrollIntoViewIfNeeded();
      // The reveal is 620 ms; give it room on a loaded machine.
      await page.waitForTimeout(1200);

      const state = await scene.evaluate((el) => {
        const planes = [...el.querySelectorAll<HTMLElement>('[data-plane]')];
        return planes.map((p) => {
          const cs = getComputedStyle(p);
          return { opacity: Number(cs.opacity), filter: cs.filter, visibility: cs.visibility };
        });
      });

      for (const [index, plane] of state.entries()) {
        expect(plane.opacity, `#${id} plane ${index} opacity`).toBeGreaterThan(0.95);
        expect(plane.visibility, `#${id} plane ${index} visibility`).not.toBe('hidden');
        expect(plane.filter, `#${id} plane ${index} still blurred`).not.toMatch(/blur\((?!0px)/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §12 L6 — the upload demo
// ---------------------------------------------------------------------------

test.describe('the upload demo (§Scene 04, §12 L6)', () => {
  test('is operable with the keyboard alone and announces its state', async ({ page }) => {
    await page.goto('/ar?tier=B');

    const cut = page.getByTestId('upload-cut');
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
    await page.getByTestId('upload-cut').scrollIntoViewIfNeeded();
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

    const thumbs = page.locator('.consent-thumbs');
    await expect(thumbs).toHaveAttribute('data-revoked', 'false');
    await expect(page.locator('.evidence')).not.toContainText('revoked_at');

    // Keyboard, again: this is a real checkbox and has to behave like one.
    await revoke.focus();
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
