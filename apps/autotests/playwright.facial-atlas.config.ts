import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests', testMatch:'facial-atlas.spec.ts', workers:1, retries:0,
  timeout:30000, reporter:'list',
  use:{baseURL:'http://127.0.0.1:4186',headless:true,
    ...(process.platform==='win32' ? {channel:'msedge'} : {})},
  outputDir:'test-results/facial-atlas',
  webServer:{command:'node ../../local-harness/serve.mjs',port:4186,
    env:{PORT:'4186'},reuseExistingServer:false,timeout:15000},
});
