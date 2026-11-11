import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'issue157-calibration-ui.spec.ts', workers: 1, retries: 0,
  timeout: 30000, reporter: 'list', outputDir: '/tmp/wecog-issue157-results',
  use: { baseURL: 'http://127.0.0.1:4228', headless: true, permissions: [], trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: 'python3 -m http.server 4228 --bind 127.0.0.1 --directory ../../', port: 4228, reuseExistingServer: false },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] }, { name: 'webkit', use: devices['Desktop Safari'] }],
});
