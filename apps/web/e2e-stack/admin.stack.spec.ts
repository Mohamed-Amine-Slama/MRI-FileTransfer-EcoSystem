import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, SEED, apiCall, freshApplicant, query, signIn, token } from './helpers';

async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

test('signed out, / lands on /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('ops approves a doctor → the doctor switches on → the clinic can pick them; the ledger shows the split', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const applicant = await freshApplicant();
  const legalName = `Cabinet ${applicant.fullName}`;

  // The applicant applies as a Tunisian radiology doctor.
  const a = await (await browser.newContext()).newPage();
  await signInAs(a, applicant.email, applicant.password);
  await a.goto('/signup/provider');
  await a.getByTestId('field-side').selectOption('destination');
  await a.getByTestId('field-kind').selectOption('doctor');
  await a.getByTestId('field-legal-name').fill(legalName);
  await a.getByTestId('field-seats').fill('1');
  await a.getByTestId('field-cnomNumber').fill(`CNOM-${Date.now()}`);
  await a.getByTestId('field-specialty').selectOption('radiology');
  // A `file` credential renders as a text box: document upload is not built
  // (plan 4 Findings). The applicant types the permit's reference.
  await a.getByTestId('field-facilityPermit').fill(`PERMIT-${Date.now()}`);
  await a.getByTestId('submit-signup').click();
  await expect(a.getByTestId('signup-success')).toBeVisible();
  const [org] = await query<{ id: string }>('SELECT id FROM identity_organisations WHERE legal_name = $1', [legalName]);
  if (org === undefined) throw new Error('the application created no organisation');

  // Ops approves it.
  const ops = await (await browser.newContext()).newPage();
  await signIn(ops, 'ops');
  await ops.goto('/admin/providers');
  await ops.getByTestId(`approve-${org.id}`).click();
  await expect
    .poll(async () =>
      (
        await query<{ s: string }>('SELECT verification_status AS s FROM identity_organisations WHERE id = $1', [
          org.id,
        ])
      )[0]?.s,
    )
    .toBe('approved');

  // The new doctor signs in again (the role is new) and switches on.
  const d = await (await browser.newContext()).newPage();
  await signInAs(d, applicant.email, applicant.password);
  await d.goto('/doctor/availability');
  const toggle = d.getByTestId('toggle-accepting');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // The clinic finds them when picking a doctor for a fresh radiology case
  // (Review Focus 4: never a seeded row another run may have moved).
  const s = await SEED();
  const lab = await token(ACCOUNTS.clinic.email, ACCOUNTS.clinic.password);
  const fresh = await apiCall<{ id: string }>(lab, '/cases', {
    method: 'POST',
    body: { patientId: s.patientId, specialty: 'radiology', reason: `admin journey ${Date.now()}` },
  });
  expect(fresh.status).toBeLessThan(300);
  const clinic = await (await browser.newContext()).newPage();
  await signIn(clinic, 'clinic');
  await clinic.goto(`/cases/${fresh.body.id}/pick-doctor`);
  await expect(clinic.getByTestId('directory-row').filter({ hasText: applicant.fullName })).toBeVisible();

  // Ops' ledger shows the platform's side of the split.
  await ops.goto('/admin/ledger');
  await expect(ops.getByTestId('platform-in')).toContainText(/\d/);
  await expect(ops.getByTestId('platform-margin')).toContainText(/\d/);
});
