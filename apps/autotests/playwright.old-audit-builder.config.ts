import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'old-audit-builder-security.spec.ts',
  workers: 1, retries: 0, timeout: 30000, reporter: 'list',
  outputDir: 'test-results/old-audit-builder',
  use: { baseURL: 'http://127.0.0.1:4211', headless: true, permissions: [],
    trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' },
  webServer: { command: 'python3 -m http.server 4211 --bind 127.0.0.1 --directory ../../',
    port: 4211, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});
