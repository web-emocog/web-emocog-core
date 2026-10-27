import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'html-data-boundaries.spec.ts', timeout: 30000,
  workers: 1, retries: 0, reporter: 'list', outputDir: 'test-results/html-data-boundaries',
  use: { baseURL: 'http://127.0.0.1:4197', headless: true,
    trace: 'off', screenshot: 'off', video: 'off', permissions: [] },
  webServer: { command: 'python3 -m http.server 4197 --bind 127.0.0.1 --directory ../../',
    port: 4197, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
