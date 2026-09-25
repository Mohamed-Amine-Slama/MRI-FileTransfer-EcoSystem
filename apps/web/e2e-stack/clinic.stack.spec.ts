import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { SEED, query, signIn } from './helpers';

const SERIES = join(process.cwd(), '../../test-data/dicom/03-mr-series');

test('clinic: upload the MRI → new case → pick a doctor → sees $100 / $30 / $70 → pays', async ({ page }) => {
  test.setTimeout(300_000);
  const s = await SEED();
  const [receiver] = await query<{ full_name: string }>('SELECT full_name FROM identity_users WHERE id = $1', [
    s.receiverId,
  ]);
  if (receiver === undefined) throw new Error('dev-receiver missing: run scripts/dev-bootstrap.mjs');
  await signIn(page, 'clinic');

  // 1. Upload the series (a folder picker) for the seeded patient: every file
  //    reaches `done`, and the patient has a ready study.
  await page.goto('/upload');
  await page.getByTestId('patient-select').selectOption(s.patientId);
  await page.getByTestId('folder-input').setInputFiles(SERIES);
  const rows = page.getByTestId('file-row');
  await expect(rows).toHaveCount(readdirSync(SERIES).length);
  await expect(page.locator('[data-testid=file-row]:not([data-status=done])')).toHaveCount(0, {
    timeout: 240_000,
  });
  await expect
    .poll(async () => (await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM imaging_studies WHERE patient_id = $1 AND status = 'ready'`,
      [s.patientId],
    ))[0]?.n ?? 0, { timeout: 240_000, intervals: [2000] })
    .toBeGreaterThan(0);

  // 2. New radiology case for that patient, with a ready study; it opens the doctor picker.
  await page.goto('/cases/new');
  await page.getByTestId('field-patient').selectOption(s.patientId);
  await page.getByTestId('field-specialty').selectOption('radiology');
  await page.getByTestId('field-study').first().check();
  await page.getByTestId('field-referralReason').fill(`Headaches for six weeks (stack ${Date.now()})`);
  await page.getByTestId('field-urgency').selectOption('routine');
  await page.getByTestId('submit-case').click();
  await page.waitForURL(/\/cases\/[0-9a-f-]{36}\/pick-doctor$/);
  const caseId = page.url().split('/').at(-2) ?? '';
  const [linked] = await query<{ n: number }>('SELECT count(*)::int AS n FROM cases_case_studies WHERE case_id = $1', [
    caseId,
  ]);
  expect(linked?.n).toBeGreaterThan(0);

  // 3. Pick dev-receiver: the quote is the flat price and the split.
  await page
    .getByTestId('directory-row')
    .filter({ hasText: receiver.full_name })
    .getByTestId('choose-doctor')
    .click();
  await expect(page.getByTestId('quoted-price')).toContainText('100');
  await expect(page.getByTestId('quoted-clinic-share')).toContainText('30');
  await expect(page.getByTestId('quoted-remittance')).toContainText('70');

  // 4. Pay: the case is paid and the $70 fee is on the ledger exactly once.
  await page.getByTestId('pay-case').click();
  await expect
    .poll(async () =>
      (
        await query<{ status: string; fees: number }>(
          `SELECT c.status,
                  (SELECT count(*)::int FROM billing_ledger_entries e
                    WHERE e.case_id = c.id AND e.kind = 'coordination_fee' AND e.amount_minor = 7000) AS fees
             FROM cases_cases c WHERE c.id = $1`,
          [caseId],
        )
      )[0],
    )
    .toEqual({ status: 'paid', fees: 1 });
});
