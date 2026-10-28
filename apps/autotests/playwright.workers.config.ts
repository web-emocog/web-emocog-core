import { defineConfig, devices } from '@playwright/test';

// This configuration is deliberately isolated from any user/production PAGE_URL.
process.env.PAGE_URL = 'http://127.0.0.1:4188/apps/participant-web/mvp_with_precheck_1-updated.html';

export default defineConfig({
  testDir: './tests', testMatch: process.env.RUN_WORKER_REGRESSION === '1'
    ? /(?:vision-workers|session-runtime|security-performance|diagnostics-lifecycle|issue139-face-visibility)\.spec\.ts/
    : /(?:vision-workers|security-performance|diagnostics-lifecycle|issue139-face-visibility)\.spec\.ts/, timeout: 90_000,
  workers: 1, retries: 0, reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: 'http://127.0.0.1:4188', headless: process.env.WECOG_TEST_HEADED !== '1', trace: 'retain-on-failure' },
  webServer: { command: 'python3 -m http.server 4188 --bind 127.0.0.1 --directory ../../',
    port: 4188, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'],
      // The default headless shell may use SwiftShader even without GPU flags.
      ...(process.env.WECOG_NATIVE_GPU === '1' ? { channel: 'chromium' } : {}), launchOptions: {
      args: process.env.WECOG_NATIVE_GPU === '1' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
