import { expect, test } from '@playwright/test';

/**
 * `/` used to render a page headed "MIR" for everyone. It now renders the
 * marketing landing page to a visitor and the role dashboard to a signed-in
 * user, so the assertion moved with it: what this test still guarantees is that
 * the front door RESPONDS AND HAS A HEADING — the P1.2 property — rather than
 * which words that heading contains.
 *
 * The wordmark did not disappear; it is in the chrome. Asserting on it there
 * would make this a test of the header component, which `public-surface.spec.ts`
 * already covers more precisely.
 */
test('the front door renders (P1.2)', async ({ page }) => {
  // `/` is the sign-in door while the landing page is hidden (spec 2026-09-21 §1).
  await page.goto('/');
  await page.waitForURL('**/login');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('document direction is RTL by default (DECISION D4)', async ({ page }) => {
  await page.goto('/');
  // RTL is a day-one constraint, not a later i18n task. If this assertion ever
  // starts failing because someone switched the default to LTR "for now",
  // that is the retrofit D4 exists to prevent.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});

test('does not advertise the server technology', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.headers()['x-powered-by']).toBeUndefined();
  expect(res?.headers()['x-content-type-options']).toBe('nosniff');
});
