import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'issue177-builder.spec.ts',
  workers: 1, retries: 0, timeout: 30000, reporter: 'list',
  outputDir: 'test-results/issue177-builder',
  use: { baseURL: 'http://127.0.0.1:4217', headless: true, permissions: [],
    trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' },
  webServer: { command: 'python3 scripts/serve-static.py 4217', port: 4217, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});
