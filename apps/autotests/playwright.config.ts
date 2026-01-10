import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Последовательно для стабильности E2E

  use: {
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000, // Увеличен таймаут для file://
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  outputDir: 'test-results',

  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
