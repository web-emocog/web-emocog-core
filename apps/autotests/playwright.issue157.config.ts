import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'issue157-calibration-ui.spec.ts', workers: 1, retries: 0,
  timeout: 30000, reporter: 'list', outputDir: 'test-results/issue157',
  use: { baseURL: 'http://127.0.0.1:4228', headless: true, permissions: [], trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'python3 scripts/serve-static.py 4228', port: 4228, reuseExistingServer: false },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] }, { name: 'webkit', use: devices['Desktop Safari'] }],
});
