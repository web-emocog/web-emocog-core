import { defineConfig, devices } from '@playwright/test';

// A separate loopback server cannot reuse a production or manually running app.
export default defineConfig({
  testDir: './tests', testMatch: 'fps-diagnostics.spec.ts', timeout: 45_000,
  workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/fps-diagnostics',
  use: { baseURL: 'http://127.0.0.1:4189', headless: true, trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'python3 -m http.server 4189 --bind 127.0.0.1 --directory ../../',
    port: 4189, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
