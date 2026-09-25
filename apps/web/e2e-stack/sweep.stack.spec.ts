import { expect, test, type Page } from '@playwright/test';
import { navItemsForRole } from '../components/shell/nav';
import { ACCOUNTS, acceptedCase, signIn } from './helpers';

/**
 * Every route each role can reach — spec 2026-09-21 §8 and §10 ("every
 * dashboard and route clicked through as each role, with the console and
 * network panels open"). Per route it fails on: a console error, an API 5xx,
 * the same API GET twice, a main-thread task over 200 ms, settling later than
 * 1 s, and (Arabic, 390 px) a horizontal page scroll. A screenshot of each
 * route lands in test-results/sweep/ for the UI pass.
 */

async function watch(page: Page) {
  const gets: string[] = [];
  const errors: string[] = [];
  let pending = 0;
  let last = Date.now();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().includes('/api/')) return;
    pending++;
    last = Date.now();
    if (r.method() === 'GET') gets.push(new URL(r.url()).pathname + new URL(r.url()).search);
  });
  const finished = (status: number | null, url: string): void => {
    pending = Math.max(0, pending - 1);
    last = Date.now();
    if (status !== null && status >= 500) errors.push(`${status} ${url}`);
  };
  page.on('requestfinished', (r) => {
    if (r.url().includes('/api/')) void r.response().then((res) => finished(res?.status() ?? null, r.url()));
  });
  page.on('requestfailed', (r) => {
    if (r.url().includes('/api/')) finished(null, r.url());
  });
  const settled = async (t0: number): Promise<number> => {
    while (Date.now() - t0 < 10_000) {
      if (pending === 0 && Date.now() - last > 300) return last - t0;
      await page.waitForTimeout(50);
    }
    return Number.POSITIVE_INFINITY;
  };
  const reset = (): void => {
    gets.length = 0;
    errors.length = 0;
  };
  return { gets, errors, settled, reset };
}

const drainLongTasks = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as unknown as { __long: number[] }).__long.splice(0));

const push = (page: Page, path: string): Promise<void> =>
  page.evaluate(
    (p) => (window as unknown as { next: { router: { push(p: string): void } } }).next.router.push(p),
    path,
  );

/** Switch the UI to Arabic the way a user does: the header's language select. */
async function setArabic(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: /language|langue|اللغة/i }).first().selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

let caseId = '';
test.beforeAll(async () => {
  caseId = (await acceptedCase({ reason: `sweep ${Date.now()}` })).id;
});

for (const who of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
  const routes = (): string[] => [
    ...new Set([
      ...navItemsForRole(ACCOUNTS[who].role).map((i) => i.href),
      '/profile',
      '/settings',
      ...(who === 'clinic' || who === 'doctor' ? [`/cases/${caseId}`] : []),
    ]),
  ];

  test.describe(`${who}: every route`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __long: number[] };
        w.__long = [];
        new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({
          type: 'longtask',
          buffered: true,
        });
      });
    });

    test('English, desktop: fast, quiet, each call once', async ({ page }) => {
      const w = await watch(page);
      await signIn(page, who);
      await w.settled(Date.now());
      for (const path of routes()) {
        await test.step(path, async () => {
          w.reset();
          await drainLongTasks(page);
          const t0 = Date.now();
          await push(page, path);
          const ms = await w.settled(t0);
          await page.screenshot({
            path: `test-results/sweep/${who}-en${path.replaceAll('/', '_')}.png`,
            fullPage: true,
          });
          const dupes = w.gets.filter((g, i) => w.gets.indexOf(g) !== i);
          expect.soft(w.errors, `${path}: console errors / 5xx`).toEqual([]);
          expect.soft(dupes, `${path}: duplicate GETs`).toEqual([]);
          expect
            .soft(Math.max(0, ...(await drainLongTasks(page))), `${path}: longest task (ms)`)
            .toBeLessThanOrEqual(200);
          expect.soft(ms, `${path}: settle (ms)`).toBeLessThanOrEqual(1000);
        });
      }
    });

    test('Arabic, 390 px: no horizontal scroll', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await signIn(page, who);
      await setArabic(page);
      for (const path of routes()) {
        await test.step(path, async () => {
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
          await page.screenshot({
            path: `test-results/sweep/${who}-ar390${path.replaceAll('/', '_')}.png`,
            fullPage: true,
          });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect.soft(overflow, `${path}: horizontal overflow (px)`).toBeLessThanOrEqual(0);
        });
      }
    });
  });
}
