import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ACCOUNTS, SEED, apiCall, query, signIn, token } from './helpers';

test('doctor: switch on → accept → read → report → submit → PDF', async ({ page }) => {
  test.setTimeout(240_000);
  const s = await SEED();
  await signIn(page, 'doctor');

  // Switch on, in the UI.
  await page.goto('/doctor/availability');
  const toggle = page.getByTestId('toggle-accepting');
  await expect(toggle).toHaveAttribute('aria-pressed', /true|false/);
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // The clinic sends this doctor a paid case.
  const lab = await token(ACCOUNTS.clinic.email, ACCOUNTS.clinic.password);
  const submitted = await apiCall<{ id: string }>(lab, '/cases', {
    method: 'POST',
    body: {
      patientId: s.patientId,
      specialty: 'radiology',
      studyIds: [s.studyId],
      reason: `doctor journey ${Date.now()}`,
    },
  });
  expect(submitted.status).toBeLessThan(300);
  const caseId = submitted.body.id;
  expect(
    (await apiCall(lab, `/cases/${caseId}/quote`, { method: 'POST', body: { doctorId: s.receiverId } })).status,
  ).toBeLessThan(300);
  expect((await apiCall(lab, `/cases/${caseId}/pay`, { method: 'POST', idempotent: true })).status).toBeLessThan(300);

  // Accept on the case page; the workspace opens.
  await page.goto(`/cases/${caseId}`);
  await page.getByTestId('accept-case').click();
  await page.getByTestId('read-and-report').waitFor();

  // Read: full fidelity, the wheel moves the slice, the length tool draws.
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-fidelity', 'full', { timeout: 60_000 });
  const before = (await page.getByTestId('image-position').textContent()) ?? '';
  await page.getByTestId('cornerstone-viewport').hover();
  await page.mouse.wheel(0, 300);
  await expect(page.getByTestId('image-position')).not.toHaveText(before);
  await page.getByTestId('tool-length').click();
  const box = await page.getByTestId('cornerstone-viewport').boundingBox();
  if (box === null) throw new Error('viewport has no box');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-testid=cornerstone-viewport] svg text').first()).toBeVisible();

  // Report: a draft survives a reload; submit waits for what is required.
  await page.getByTestId('report-finding-region').first().fill('Posterior fossa');
  await expect(page.getByTestId('report-save-state')).not.toBeEmpty({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId('report-finding-region').first()).toHaveValue('Posterior fossa');
  await expect(page.getByTestId('report-submit')).toBeDisabled();
  await expect(page.getByTestId('report-missing')).toBeVisible();
  await page.getByTestId('report-exam-type').selectOption('mri_brain');
  await page.getByTestId('report-impression-line').first().fill('No intracranial mass.');
  await page.getByTestId('report-submit').click();
  await page.getByTestId('report-view').waitFor();

  // The PDF, and the money: one $20 payout.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('report-download-pdf').click(),
  ]);
  expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe('%PDF-');
  const [row] = await query<{ status: string; payouts: number }>(
    `SELECT c.status,
            (SELECT count(*)::int FROM billing_ledger_entries e
              WHERE e.case_id = c.id AND e.kind = 'doctor_payout' AND e.amount_minor = 2000) AS payouts
       FROM cases_cases c WHERE c.id = $1`,
    [caseId],
  );
  expect(row).toEqual({ status: 'answered', payouts: 1 });
});
