import { expect, test } from '@playwright/test';

/**
 * The theme toggle, and the thing that makes it usable: no flash.
 *
 * `public/theme-init.js` runs before hydration and stamps `data-theme` onto
 * <html> from localStorage. It is a FILE rather than an inline script because
 * React's raw-HTML escape hatch is banned by lib/security/xss-surface.test.ts —
 * its absence is what justifies the CSP's `script-src 'unsafe-inline'`.
 *
 * These run under both Playwright projects, so every assertion is also a mobile
 * assertion (§4.5).
 */

test.describe('theme (§4.1)', () => {
  test('applies a stored dark theme before the page has painted', async ({ page }) => {
    // Seeded before any navigation, so it is present when theme-init.js runs.
    await page.addInitScript(() => {
      window.localStorage.setItem('mir.theme', 'dark');
    });

    await page.goto('/');

    // The critical assertion. If this only became true after hydration, a
    // dark-mode user would see a white flash on every single page load.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('stores nothing for "system", so the OS preference stays in charge', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mir.theme', 'system');
    });
    await page.goto('/');
    // The attribute's ABSENCE is what hands control to the media query in
    // globals.css. Setting data-theme="system" would match no rule at all.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('degrades to the OS preference when the stored value is corrupt', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('mir.theme', 'chartreuse');
    });
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('the toggle changes the theme and survives a reload', async ({ page }) => {
    /*
     * `/pricing`, not `/`.
     *
     * The landing page is a darkened reading room in BOTH themes — that
     * contrast is a deliberate design device (Landing-Page-Specs §3.1: the
     * product is a bright clinical tool, the marketing site is the dark room
     * around it), so it supplies its own chrome and carries no theme control.
     * Putting one there would be a switch that visibly does nothing.
     *
     * The three tests above still load `/`, because what they assert is that
     * `theme-init.js` stamps <html> before paint — which happens on every
     * route, landing page included.
     */
    await page.goto('/pricing');

    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('theme-option-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // The point of persisting it: a preference that resets on navigation is
    // not a preference.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByTestId('theme-toggle').click();
    await page.getByTestId('theme-option-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('is reachable and labelled on the public surface', async ({ page }) => {
    await page.goto('/pricing');
    // Icon-only controls need an accessible name (§4.1 prefers explicit labels;
    // where an icon is unavoidable the name has to carry the meaning).
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute('aria-label', /.+/);
  });
});
