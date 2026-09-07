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
    await expect(page.getByTestId('landing-signup')).toBeVisible();
    await expect(page.getByTestId('landing-pricing')).toBeVisible();
  });

  test('states the reference-only limit before anyone signs up', async ({ page }) => {
    // Not a footnote. The distinction between a transfer service and a
    // diagnostic one is what keeps this product outside medical-device
    // regulation, and a prospective customer has to understand it up front.
    await page.goto('/');
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
