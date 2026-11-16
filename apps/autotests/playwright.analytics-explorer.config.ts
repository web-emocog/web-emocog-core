import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.ANALYTICS_EXPLORER_PORT || 4248);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a non-privileged local test port');
export default defineConfig({
  testDir: './tests', testMatch: 'analytics-explorer.spec.ts', workers: 1, timeout: 45_000,
  retries: 0, reporter: 'list', outputDir: '/tmp/wecog-analytics-explorer-browser',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, trace: 'retain-on-failure' },
  webServer: { command: `python3 scripts/serve-static.py ${port}`, port, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
