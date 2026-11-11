import { defineConfig, devices } from '@playwright/test';

process.env.PAGE_URL = 'http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html';
export default defineConfig({
  testDir: './tests',
  testMatch: /(?:stimulus-formats-regression|stimulus-live-workflow|stimulus-lifecycle|stimulus-resilience-audit|analytics-production|session-export-recovery|participant-persistence-recovery|invitation-media|stimulus-isolation-input|signal-quality-profiles|issue146-physiology-intervals|issue157-calibration-ui|design-system)\.spec\.ts/,
  timeout: 60_000, workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/production-audit',
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory ../../',
    port: 4173, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
