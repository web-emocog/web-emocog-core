import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: /(?:issue143-gaze|gaze-benchmark)\.spec\.ts/, workers: 1, retries: 0, timeout: 45000,
  outputDir: 'test-results/issue143',
  use: { baseURL: 'http://127.0.0.1:4204', headless: true, trace: 'off', screenshot: 'off', video: 'off', permissions: [] },
  webServer: { command: 'python3 scripts/serve-static.py 4204', port: 4204, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
