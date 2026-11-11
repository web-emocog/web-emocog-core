import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: /(?:issue144-attempts|issue146-physiology-intervals|fps-diagnostics|duplicate-work)\.spec\.ts/,
  workers: 1, retries: 0, timeout: 45000, reporter: 'list', outputDir: 'test-results/physiology-recovery',
  use: { baseURL: 'http://127.0.0.1:4201', headless: true, trace: 'off', video: 'off', screenshot: 'off', permissions: [] },
  webServer: { command: 'python3 scripts/serve-static.py 4201', port: 4201, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
