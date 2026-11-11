import { defineConfig, devices } from '@playwright/test';

process.env.EMOCOG_WEB_ORIGIN = 'http://127.0.0.1:4213';
export default defineConfig({
  testDir: './tests',
  testMatch: /(?:old-audit-stimuli-security|stimulus-sharing-preview|stimulus-lifecycle|stimulus-mutation-scope)\.spec\.ts/,
  timeout: 30_000, workers: 1, retries: 0, reporter: 'list',
  outputDir: '/tmp/emocog-old-audit-stimuli-security-results',
  use: { baseURL: process.env.EMOCOG_WEB_ORIGIN, headless: true,
    trace: 'off', screenshot: 'off', video: 'off', permissions: [] },
  webServer: { command: 'node tests/old-audit-stimuli-security-server.mjs',
    port: 4213, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
