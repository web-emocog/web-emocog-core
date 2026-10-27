import { defineConfig, devices } from '@playwright/test';

process.env.EMOCOG_WEB_ORIGIN = 'http://127.0.0.1:4195';
export default defineConfig({
  testDir: './tests',
  testMatch: /(?:researcher-password|account-publication-regression|stimulus-mutation-scope|stimulus-sharing-preview|protocol-persistence-pdf)\.spec\.ts/,
  timeout: 30000, workers: 1, retries: 0, reporter: 'list', outputDir: 'test-results/staff-regression',
  use: { baseURL: process.env.EMOCOG_WEB_ORIGIN, headless: true, trace: 'off', screenshot: 'off', video: 'off', permissions: [] },
  webServer: { command: 'python3 -m http.server 4195 --bind 127.0.0.1 --directory ../../',
    port: 4195, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
