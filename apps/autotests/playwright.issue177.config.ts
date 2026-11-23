import { defineConfig, devices } from '@playwright/test';

const port = 4277;
const origin = `http://127.0.0.1:${port}`;
process.env.PAGE_URL = origin + '/apps/participant-web/mvp_with_precheck_1-updated.html';
export default defineConfig({
  testDir: './tests', testMatch: /issue177-.*\.spec\.ts/,
  workers: 1, retries: 0, timeout: 60_000, reporter: 'list',
  outputDir: 'test-results/issue177',
  use: { baseURL: origin, headless: true, permissions: [], trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: `python3 scripts/serve-static.py ${port}`, port, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
