import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PRODUCTION_AUDIT_PORT || 4173);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Use a non-privileged loopback port');
const origin = `http://127.0.0.1:${port}`;
process.env.PAGE_URL = `${origin}/apps/participant-web/mvp_with_precheck_1-updated.html`;
process.env.EMOCOG_WEB_ORIGIN = origin;
process.env.EMOCOG_WEB_URL = `${origin}/apps/web`;
export default defineConfig({
  testDir: './tests',
  testMatch: /(?:stimulus-formats-regression|stimulus-live-workflow|stimulus-lifecycle|stimulus-resilience-audit|analytics-production|session-export-recovery|participant-persistence-recovery|invitation-media|stimulus-isolation-input|signal-quality-profiles|issue146-physiology-intervals|issue157-calibration-ui|design-system)\.spec\.ts/,
  timeout: 60_000, workers: 1, retries: 0, reporter: 'list',
  outputDir: 'test-results/production-audit',
  use: { baseURL: origin, headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: `python3 scripts/serve-static.py ${port}`,
    port, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
