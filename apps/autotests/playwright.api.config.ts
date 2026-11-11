import { defineConfig } from '@playwright/test';

// The request fixture is HTTP-only; no browser or static server is needed.
export default defineConfig({
  testDir: './tests',
  testMatch: 'api-contract.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/api-contract',
});
