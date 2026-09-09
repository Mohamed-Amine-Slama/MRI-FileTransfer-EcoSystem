import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '../e2e', fullyParallel: true, workers: 2, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3101', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
