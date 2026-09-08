import { defineConfig, devices } from '@playwright/test';

const PORT = 3001;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  // A test that only passes locally is not a gate. Fail the build if someone
  // commits `test.only`.
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Libyan clinic staff are overwhelmingly on mobile. The upload flow and
    // the doctor picker must be exercised at this viewport, not only at
    // desktop width.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    // Serve only — the build is a separate step (CI runs it before this job).
    // Bundling `pnpm build &&` in here made the whole suite fail with an opaque
    // webServer timeout whenever the build was slow, which says nothing about
    // the tests and sends you looking in the wrong place.
    command: 'pnpm start',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
