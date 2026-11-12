import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: process.env.MEDIA_TEST_MATCH || 'block-media-preparation.spec.ts',
  timeout: 45000, workers: 1, retries: 0,
  outputDir: 'test-results/block-media', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4187', headless: true, screenshot: 'off', video: 'off', trace: 'off' },
  webServer: { command: 'python3 scripts/serve-static.py 4187', port: 4187, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});
