import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixturePath = process.env.LIVE_STIMULUS_FIXTURE;
if (!fixturePath) throw new Error('Seed an isolated database and set LIVE_STIMULUS_FIXTURE');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const api = new URL(fixture.apiBase);
if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || !api.port
    || ['3000', '4173'].includes(api.port)) {
  throw new Error('The live stimulus suite requires a separate loopback API');
}
const web = 'http://127.0.0.1:4237';
process.env.EMOCOG_WEB_ORIGIN = web;

export default defineConfig({
  testDir: './tests', testMatch: 'stimulus-live-workflow.spec.ts',
  timeout: 60_000, workers: 1, retries: 0, forbidOnly: true,
  outputDir: '/tmp/wecog-stimulus-live-results', reporter: 'list',
  use: { baseURL: web, headless: true, screenshot: 'off', video: 'off', trace: 'off' },
  webServer: {
    command: 'python3 -m http.server 4237 --bind 127.0.0.1 --directory ../../',
    port: 4237, reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
