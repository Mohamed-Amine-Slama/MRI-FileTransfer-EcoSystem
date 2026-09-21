import { expect, test } from '@playwright/test';

/**
 * §5.1 onboarding, §4.2 i18n, §4.3 corridor configurability, §4.4 role gating.
 *
 * These run without a signed-in session on purpose. Sign-up and recovery are
 * reachable by definition to someone who has no account, and the gated routes
 * are exercised for what an unauthenticated visitor sees — which §4.4 says
 * must be a stated refusal, not a blank screen or a crash.
 *
 * Both Playwright projects run this file, so every assertion here is also a
 * mobile-viewport assertion (§4.5).
 */

test.describe('provider sign-up (§5.1, §4.3)', () => {
  test('renders the corridor’s own credential fields, not hardcoded ones', async ({ page }) => {
    await page.goto('/signup/provider');
    await expect(page.getByTestId('field-legal-name')).toBeVisible();

    // The referring side is asked for its licence number; switching sides
    // swaps in the receiving side's registration field. If this ever fails
    // because both sides show the same inputs, the form has stopped reading
    // the corridor and §4.3 is broken.
    await expect(page.getByTestId('field-licenceNumber')).toBeVisible();
    await expect(page.getByTestId('field-cnomNumber')).toHaveCount(0);

    await page.getByTestId('field-side').selectOption('destination');
    await expect(page.getByTestId('field-cnomNumber')).toBeVisible();
    await expect(page.getByTestId('field-licenceNumber')).toHaveCount(0);
  });

  test('offers clinics and laboratories in Libya, and only doctors in Tunisia (spec 2026-09-21 §2)', async ({
    page,
  }) => {
    await page.goto('/signup/provider');
    const kinds = page.getByTestId('field-kind').locator('option');
    await expect(kinds).toHaveCount(2);
    await expect(page.getByTestId('field-kind')).toHaveValue('clinic');

    await page.getByTestId('field-side').selectOption('destination');
    await expect(kinds).toHaveCount(1);
    await expect(page.getByTestId('field-kind')).toHaveValue('doctor');
  });

  test('says plainly that platform staff are not created here (§3)', async ({ page }) => {
    await page.goto('/signup/provider');
    await expect(page.getByTestId('admin-notice')).toBeVisible();
    // The side selector must offer the two endpoints and nothing else: an
    // "admin" option would be exactly the merged flow §3 forbids.
    const options = page.getByTestId('field-side').locator('option');
    await expect(options).toHaveCount(2);
  });

  test('refuses to submit with required fields empty (§5.2 validation rule)', async ({ page }) => {
    await page.goto('/signup/provider');
    await page.getByTestId('submit-signup').click();
    await expect(page.getByTestId('signup-success')).toHaveCount(0);
    await expect(page.getByRole('alert').first()).toBeVisible();
  });
});

test.describe('account recovery (§5.1)', () => {
  test('answers identically whether or not the address is registered', async ({ page }) => {
    // The response must not reveal which clinicians have accounts here.
    await page.goto('/reset-password');
    await page.getByTestId('reset-email').fill('nobody@example.invalid');
    await page.getByTestId('reset-submit').click();
    const unknown = await page.getByTestId('reset-sent').textContent();

    await page.goto('/reset-password');
    await page.getByTestId('reset-email').fill('someone@example.invalid');
    await page.getByTestId('reset-submit').click();
    const known = await page.getByTestId('reset-sent').textContent();

    expect(unknown).toBe(known);
  });

  test('is reachable from the sign-in screen, where the failure happens', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('forgot-password').click();
    await expect(page).toHaveURL(/\/reset-password/);
  });
});

test.describe('role gating is stated, not silent (§4.4)', () => {
  for (const path of ['/cases', '/ledger', '/workspace', '/notifications', '/admin/cases']) {
    test(`${path} tells an anonymous visitor to sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByTestId('sign-in-required')).toBeVisible();
    });
  }
});

test.describe('interface language (§4.2)', () => {
  test('offers Arabic, French, and English, and switches direction with them', async ({ page }) => {
    await page.goto('/signup/provider');
    const switcher = page.getByTestId('locale-switcher');
    await expect(switcher.locator('option')).toHaveCount(3);

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await switcher.selectOption('fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    // English exists for admin use (§4.2) and must be selectable, not merely
    // present in the list.
    await switcher.selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});
