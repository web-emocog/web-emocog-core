import { defineConfig, devices } from '@playwright/test';

const database = process.env.RESILIENCE_TEST_DATABASE_URL;
if (!database || process.env.NODE_ENV === 'production') {
  throw new Error('Set RESILIENCE_TEST_DATABASE_URL to the disposable local protocol_fixes_test database');
}
const url = new URL(database);
if (!['postgres:', 'postgresql:'].includes(url.protocol)
  || url.hostname !== '127.0.0.1' || url.pathname !== '/protocol_fixes_test') {
  throw new Error('Only the disposable local protocol_fixes_test database is supported');
}
const port = 4229;
const origin = `http://127.0.0.1:${port}`;
// The per-worker Express fixture must only allow this disposable UI origin.
process.env.CORS_ORIGINS = origin;

export default defineConfig({
  testDir: './tests', testMatch: 'resilience-live.spec.ts',
  workers: 1, retries: 0, timeout: 60_000, reporter: 'list',
  outputDir: 'test-results/session-live',
  use: { baseURL: origin, headless: true, permissions: [],
    trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: `python3 scripts/serve-static.py ${port}`,
    port, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
