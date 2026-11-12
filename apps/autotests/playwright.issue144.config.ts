import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: /(?:issue144-attempts|issue146-physiology-intervals)\.spec\.ts/, workers: 1, retries: 0, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4199', headless: true, trace: 'off', screenshot: 'off', video: 'off', permissions: [] },
  webServer: { command: 'python3 scripts/serve-static.py 4199', port: 4199, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
