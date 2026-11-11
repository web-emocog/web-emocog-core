import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'metric-corrections.spec.ts', workers: 1, retries: 0, timeout: 60000,
  reporter: 'list', outputDir: 'test-results/metric-corrections',
  use: { baseURL: 'http://127.0.0.1:4192', headless: true, trace: 'off', screenshot: 'off', video: 'off', permissions: [] },
  webServer: { command: 'python3 -m http.server 4192 --bind 127.0.0.1 --directory ../../', port: 4192, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
