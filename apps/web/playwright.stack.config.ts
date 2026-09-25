import { defineConfig, devices } from '@playwright/test';

/**
 * The stack suite — spec 2026-09-21 §10. Runs against an API and a web build
 * that are ALREADY RUNNING (e2e-stack/helpers.ts has the URLs), signs in
 * through the real login form, and writes to the local database. It never
 * starts a server; the default suite (playwright.config.ts) stays hermetic.
 */
export default defineConfig({
  testDir: './e2e-stack',
  testMatch: /.*\.stack\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: process.env['E2E_WEB'] ?? 'http://127.0.0.1:3231',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
