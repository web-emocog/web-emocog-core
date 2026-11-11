import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.OLD_AUDIT_ANALYTICS_PORT || 4215);
const origin = `http://127.0.0.1:${port}`;
process.env.EMOCOG_WEB_URL = origin + '/apps/web';
export default defineConfig({
  testDir: './tests',
  testMatch: /(?:old-audit-analytics-security|analytics-production|connectedness|passive-analytics)\.spec\.ts/,
  // Builder cases in analytics-production.spec.ts run in the general suite.
  grepInvert: /AOI remains block-scoped|analytics plan preserves|existing runtime-shaped protocols/,
  timeout: 45_000, workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/old-audit-analytics',
  use: { baseURL: origin, headless: true, permissions: [],
    trace: 'off', screenshot: 'off', video: 'off', acceptDownloads: true },
  webServer: { command: 'node tests/old-audit-analytics-security-server.mjs',
    port, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
