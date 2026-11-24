import { defineConfig, devices } from '@playwright/test';
const port = 4286;
process.env.PAGE_URL = `http://127.0.0.1:${port}/apps/participant-web/mvp_with_precheck_1-updated.html`;
export default defineConfig({
  testDir: './tests', testMatch: 'issue186-recovery.spec.ts', workers: 1, retries: 0, timeout: 90000,
  reporter: 'list', outputDir: 'test-results/issue186',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, permissions: [], trace: 'off', video: 'off', screenshot: 'off' },
  webServer: { command: `python3 scripts/serve-static.py ${port}`, port, reuseExistingServer: false },
  projects: ['chromium', 'firefox', 'webkit'].map(name => ({ name, use: { ...devices[name === 'chromium'
    ? 'Desktop Chrome' : name === 'firefox' ? 'Desktop Firefox' : 'Desktop Safari'] } }))
});
