import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'staff-http.spec.ts', timeout: 30000,
  workers: 1, retries: 0, reporter: 'list', outputDir: 'test-results/staff-http',
  use: { baseURL: 'http://127.0.0.1:4194', headless: true,
    trace: 'off', screenshot: 'off', video: 'off', permissions: [] },
  webServer: { command: (process.platform === 'win32' ? 'python' : 'python3') + ' scripts/serve-static.py 4194',
    port: 4194, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
