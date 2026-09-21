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
  /*
   * The landing page is hidden for now (spec 2026-09-21 §1): `/` and the
   * locale routes send a visitor to sign-in. Its files are kept, and the
   * landing's own suite (corridor.spec.ts) is skipped rather than deleted.
   */
  test('an anonymous visitor at / is sent to sign-in', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the locale landing routes also go to sign-in', async ({ page }) => {
    for (const locale of ['ar', 'fr', 'en']) {
      await page.goto(`/${locale}`);
      await page.waitForURL('**/login');
    }
  });

  test('scopes the marketing treatment to the public surface only', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.marketing')).toHaveCount(1);

    // A gated application route renders the application chrome, which never
    // sets `.marketing`. If this ever finds one, a gradient has reached a
    // case, file, or money screen and §4.1 is broken.
    await page.goto('/cases');
    await expect(page.locator('.marketing')).toHaveCount(0);
  });

  test('has exactly one main landmark on every public page', async ({ page }) => {
    for (const path of ['/pricing', '/login', '/signup']) {
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
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('never scrolls the body horizontally at any width (§4.5)', async ({ page }) => {
    for (const path of ['/login', '/pricing', '/signup']) {
      await page.goto(path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${path} scrolls horizontally`).toBe(false);
    }
  });
});
