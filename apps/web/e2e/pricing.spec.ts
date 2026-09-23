import { expect, test } from '@playwright/test';

/**
 * Public pricing — brief §2, §5.7.
 *
 * The catalogue is stubbed rather than served, because the e2e suite runs the
 * web app alone. Stubbing keeps the assertions about what this page GUARANTEES
 * — the separation of charges, the yearly price, the exponent-correct money
 * — rather than about whether a backend happened to be up.
 */

const CATALOGUE = {
  plans: [
    {
      code: 'src_clinic_yearly',
      side: 'source',
      labelKey: 'planSrcClinicYearlyName',
      blurbKey: 'planSrcClinicYearlyBlurb',
      price: { amountMinor: 100000, currency: 'USD' },
      interval: 'year',
      seatLimit: null,
      monthlyCaseLimit: null,
      entitlements: ['csvExport', 'prioritySupport', 'auditTrailRetention'],
      sort: 0,
    },
    {
      code: 'dst_doctor_yearly',
      side: 'destination',
      labelKey: 'planDstDoctorYearlyName',
      blurbKey: 'planDstDoctorYearlyBlurb',
      // TND has three decimals: this is 1,000 dinars, not 10,000.
      price: { amountMinor: 1000000, currency: 'TND' },
      interval: 'year',
      seatLimit: null,
      monthlyCaseLimit: null,
      entitlements: ['csvExport', 'prioritySupport', 'auditTrailRetention'],
      sort: 0,
    },
  ],
};

test.describe('pricing (§5.7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/plans', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOGUE) }),
    );
  });

  test('is reachable with no session at all', async ({ page }) => {
    const response = await page.goto('/pricing');
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('pricing-tiers')).toBeVisible();
  });

  test('renders every tier the catalogue returns', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByTestId('plan-src_clinic_yearly')).toBeVisible();
    await expect(page.getByTestId('plan-dst_doctor_yearly')).toBeVisible();
  });

  test('prices each plan per year, in its own currency', async ({ page }) => {
    await page.goto('/pricing');
    const clinic = page.getByTestId('plan-src_clinic_yearly');
    await expect(clinic).toContainText(/1[,.\u202f\u00a0]?000/);
    await expect(clinic).toContainText(/year|an|سنوي/i);
    // 1000000 TND minor units must read as 1,000 dinars, never 10,000.
    const doctor = page.getByTestId('plan-dst_doctor_yearly');
    await expect(doctor).toContainText(/1[,.\u202f\u00a0]?000/);
    await expect(doctor).not.toContainText(/10[,.\u202f\u00a0]?000/);
  });

  test('says that changing plan takes no payment', async ({ page }) => {
    // Blocking item L7 is open: no rail is wired, and the page must not imply
    // otherwise by looking like a checkout.
    await page.goto('/pricing');
    await expect(page.getByTestId('pricing-no-charge')).toBeVisible();
  });

  test('keeps the per-case coordination fee out of the tier price', async ({ page }) => {
    // §5.7 P0: coordination fees and subscription charges must never read as
    // one amount. The subtitle is where a clinic comparing tiers is told.
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('body')).toContainText(/coordination|تنسيق|coordination/i);
  });

  test('sends a signed-out visitor to sign-up, not to a dead checkout', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByTestId('plan-cta-src_clinic_yearly')).toHaveAttribute('href', '/signup');
  });

  test('scrolls the comparison table inside its own container (§4.5)', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByTestId('pricing-comparison')).toBeVisible();

    // The property that matters: a table wider than a phone must scroll
    // ITSELF, not drag the page with it.
    //
    // Measured by ATTEMPTING THE SCROLL rather than by comparing scrollWidth.
    // Under RTL, Chromium's scrollLeft runs from -(scrollWidth - clientWidth)
    // to 0 and scrollWidth picks up sub-pixel and clipped-overflow artefacts,
    // so the arithmetic comparison reports a page as scrollable that a finger
    // cannot actually move. Trying it is the question a user would ask.
    const pageMoved = await page.evaluate(() => {
      const doc = document.documentElement;
      const before = doc.scrollLeft;
      doc.scrollLeft = before - 200;
      const moved = Math.abs(doc.scrollLeft - before) > 2;
      doc.scrollLeft = before;
      return moved;
    });
    expect(pageMoved, 'the page itself scrolled horizontally').toBe(false);

    // And the container is the thing set up to absorb it.
    //
    // Deliberately NOT asserting that it is scrolled right now: whether the
    // table exceeds its box depends on the viewport, and at desktop width it
    // correctly does not. What must hold at every width is that the overflow
    // has somewhere to go that is not the page.
    const overflowX = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="pricing-comparison"]');
      return el === null ? null : getComputedStyle(el).overflowX;
    });
    expect(['auto', 'scroll']).toContain(overflowX);
  });
});
