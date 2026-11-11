import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'identity-onboarding.spec.ts', timeout: 30000,
  workers: 1, retries: 0, reporter: 'list', outputDir: 'test-results/identity',
  use: { baseURL: 'http://127.0.0.1:4197', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'python3 scripts/serve-static.py 4197', port: 4197, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
  ],
});
