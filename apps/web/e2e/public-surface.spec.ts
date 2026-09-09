import { expect, test } from '@playwright/test';

/**
 * The two registers — brief §4.1.
 *
 * The product deliberately looks different signed-out and signed-in: an
 * expressive public surface, and a calm application. The boundary is enforced
 * by scoping every marketing style under `.marketing`, which only PublicChrome
 * sets. These tests are that boundary, asserted.
 */

test.describe('public surface (§4.1)', () => {
  test('an anonymous visitor lands on the marketing page, not a sign-in card', async ({ page }) => {
    await page.goto('/');
    // The hero's two actions: register, and see how it works.
    await expect(page.getByTestId('landing-signup')).toBeVisible();
    await expect(page.getByTestId('landing-how')).toBeVisible();
  });

  test('carries the pricing route through to the closing plate', async ({ page }) => {
    /*
     * Pricing moved off the hero and onto Scene 11, where the page makes its
     * one remaining ask. It is below the fold inside a `content-visibility:
     * auto` section, so it has to be scrolled to before it has a box at all —
     * asserting visibility without the scroll would fail for a reason that has
     * nothing to do with the link being there.
     */
    await page.goto('/');
    const pricing = page.getByTestId('landing-pricing');
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing).toBeVisible();
    await expect(pricing).toHaveAttribute('href', '/pricing');
  });

  test('states the reference-only limit before anyone signs up', async ({ page }) => {
    // Not a footnote. The distinction between a transfer service and a
    // diagnostic one is what keeps this product outside medical-device
    // regulation, and a prospective customer has to understand it up front.
    await page.goto('/');
    // Scene 06 is below the fold and skipped by `content-visibility` until it
    // is approached, so the text has to be reached before it can be read.
    await page.getByTestId('viewer-banner').scrollIntoViewIfNeeded();
    await expect(page.locator('main')).toContainText(
      /diagnostic|تشخيص|diagnostique/i,
    );
  });

  test('scopes the marketing treatment to the public surface only', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.marketing')).toHaveCount(1);

    // A gated application route renders the application chrome, which never
    // sets `.marketing`. If this ever finds one, a gradient has reached a
    // case, file, or money screen and §4.1 is broken.
    await page.goto('/cases');
    await expect(page.locator('.marketing')).toHaveCount(0);
  });

  test('has exactly one main landmark on every public page', async ({ page }) => {
    for (const path of ['/', '/pricing', '/login', '/signup']) {
      await page.goto(path);
      await expect(page.locator('main')).toHaveCount(1);
    }
  });

  /**
   * The calendar surface is gone, and gone means 404.
   *
   * Not a redirect. There is nowhere honest to send a bookmark that asked for a
   * week view or a slot picker — the consult model has neither — and a 308 to
   * the case list would answer a question nobody asked. A 404 tells the person
   * holding the old link the truth.
   */
  test('the calendar surface is gone', async ({ page }) => {
    for (const path of [
      '/schedule',
      '/schedule/calendar',
      '/schedule/availability',
      '/appointments',
      '/appointments/new',
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });

  test('keeps the document RTL on the public surface too (D4)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('never scrolls the body horizontally at any width (§4.5)', async ({ page }) => {
    for (const path of ['/', '/pricing', '/signup']) {
      await page.goto(path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${path} scrolls horizontally`).toBe(false);
    }
  });
});
