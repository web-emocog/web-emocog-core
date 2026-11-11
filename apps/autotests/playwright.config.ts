import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests',
  // These run with their own loopback servers in the required matrix job.
  testIgnore: ['**/vision-workers.spec.ts', '**/developer-native-models.spec.ts', '**/fps-diagnostics.spec.ts',
    '**/security-performance.spec.ts', '**/diagnostics-lifecycle.spec.ts', '**/issue139-face-visibility.spec.ts',
    '**/staff-http.spec.ts', '**/html-data-boundaries.spec.ts', '**/metric-corrections.spec.ts', '**/old-audit-*.spec.ts',
    '**/api-contract.spec.ts', '**/resilience-live.spec.ts'],
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Последовательно для стабильности E2E

  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000, // Увеличен таймаут для file://
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  outputDir: 'test-results/browser-regression',
  webServer: {
    command: 'python3 scripts/serve-static.py 4173',
    port: 4173,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ['json', { outputFile: 'test-results/browser-regression/results.json' }],
  ],

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
