import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: /(?:old-audit-network|old-audit-entrypoints|old-audit-researcher-list|integrated-audit-boundaries)\.spec\.ts/,
  workers: 1, retries: 0, timeout: 30000, reporter: 'list',
  outputDir: '/tmp/wecog-old-audit-network-results',
  use: { baseURL: 'http://127.0.0.1:4217', headless: true,
    permissions: [], trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'python3 -m http.server 4217 --bind 127.0.0.1 --directory ../../',
    port: 4217, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});
