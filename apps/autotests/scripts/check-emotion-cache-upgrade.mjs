import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Standalone: Playwright request routing disables the browser's HTTP cache.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const previous = git('rev-parse', '--verify', '--end-of-options', (process.argv[2] || 'origin/main') + '^{commit}').toString().trim();
const published = new Set(JSON.parse(await readFile(join(root, 'docker/web/public-files.json'), 'utf8')).files);
const participant = 'apps/participant-web/mvp_with_precheck_1-updated.html';
const developer = 'apps/web/developer/emotion-test.html';
const emotion = 'apps/participant-web/js/emotion/';
const analyzer = emotion + 'emotion-analyzer.js';
const pipeline = 'apps/participant-web/js/session-runtime/frame-pipeline.js';
const files = new Map();
const oldFile = path => {
  if (!files.has(path)) files.set(path, git('show', previous + ':' + path));
  return files.get(path);
};
function linked(source, basename) {
  const text = oldFile(source).toString();
  const relative = [...text.matchAll(/["']([^"'\s]+)["']/g)].map(match => match[1])
    .find(url => url.split('?')[0].split('/').at(-1) === basename);
  assert.ok(relative, `No previous URL for ${basename} in ${source}`);
  const url = new URL(relative, 'http://localhost/' + source);
  assert.equal(url.origin, 'http://localhost');
  return url.pathname + url.search;
}
const extractorUrl = linked(analyzer, 'au-extractor.js');
const oldDependencies = [
  extractorUrl,
  linked('apps/participant-web/js/emotion-stub-new.js', 'public-api.js'),
  linked(pipeline, 'neutral-calibration.mjs'),
];
const entries = [
  { page: developer, name: 'emotion-test.js', button: '#startBtn', video: '#video' },
  { page: participant, name: 'app-updated.js', button: '#startPrecheckBtn', video: '#precheckVideo' },
];
const vision = `
  export const FilesetResolver = { forVisionTasks: async () => ({}) };
  export const FaceLandmarker = { createFromOptions: async () => ({
    close() {}, detectForVideo() { return { faceLandmarks: [] }; }
  }) };
  export const ImageSegmenter = { createFromOptions: async () => ({
    close() {}, segmentForVideo(_frame, _time, callback) { callback({}); }
  }) };
  export const PoseLandmarker = { createFromOptions: async () => ({
    close() {}, detectForVideo() { return { landmarks: [] }; }
  }) };
`;
const types = { js: 'text/javascript', mjs: 'text/javascript', html: 'text/html; charset=utf-8',
  css: 'text/css', json: 'application/json' };
let upgraded = false;
const newRequests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.slice(1);
  if (path === '__cache_upgrade') {
    res.writeHead(200, { 'Content-Type': types.html, 'Cache-Control': 'no-store' });
    return res.end('<!doctype html><title>Cache upgrade smoke</title>');
  }
  if (path === 'api/auth/me') {
    res.writeHead(200, { 'Content-Type': types.json, 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ id: 1, role: 'developer', email: 'synthetic@example.test', csrf_token: 'synthetic' }));
  }
  if (!published.has(path)) { res.writeHead(404); return res.end(); }
  const next = upgraded;
  const extension = path.split('.').at(-1);
  try {
    const body = path.endsWith('/vision_bundle.mjs') ? vision
      : next ? await readFile(join(root, path)) : oldFile(path);
    if (next) newRequests.push(url.pathname + url.search);
    res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream',
      'Cache-Control': ['js', 'mjs'].includes(extension) ? 'public, max-age=3600' : 'no-store' });
    return res.end(body);
  } catch (error) {
    console.error(`Cannot serve ${path}: ${error.message}`);
    res.writeHead(404);
    return res.end();
  }
});

let browser;
try {
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--no-proxy-server',
  ] });
  for (const warmEntries of [false, true]) {
    upgraded = false;
    newRequests.length = 0;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await context.addInitScript(() => {
        window.WECOG_API_BASE = location.origin + '/api';
        localStorage.setItem('emocog_workspace_owner_v1', '1');
        localStorage.setItem('emocog_api_user', JSON.stringify({ id: 1, role: 'developer', email: 'synthetic@example.test' }));
        // The fixtures check wiring, not inference. Do not start native model Workers.
        Object.defineProperty(window, 'Worker', { configurable: true, value: undefined });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/__cache_upgrade?before');
      await page.evaluate(async urls => {
        for (const url of urls) await import(url);
      }, oldDependencies);
      if (warmEntries) {
        for (const entry of entries) {
          const url = linked(entry.page, entry.name);
          await page.evaluate(async path => {
            const response = await fetch(path);
            if (!response.ok) throw new Error('Could not warm previous entry: ' + path);
            await response.arrayBuffer();
          }, url);
        }
      }

      upgraded = true;
      await page.goto(origin + '/__cache_upgrade?after');
      const cached = await page.evaluate(async url => (await fetch(url, { cache: 'only-if-cached', mode: 'same-origin' })).text(), extractorUrl);
      assert.equal(cached, oldFile(new URL(extractorUrl, origin).pathname.slice(1)).toString(),
        'Expected Chromium to retain the previous extractor without another HTTP request');
      assert.ok(!newRequests.includes(extractorUrl));
      for (const entry of entries) {
        const before = newRequests.length;
        const url = origin + '/' + entry.page + (entry.page === participant ? '?developer_module=precheck' : '');
        errors.length = 0;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const scripts = newRequests.slice(before);
        const previousPath = new URL(linked(entry.page, entry.name), origin).pathname.slice(1);
        if (!oldFile(previousPath).equals(await readFile(join(root, previousPath)))) {
          assert.ok(scripts.some(path => path.split('?')[0] === '/' + previousPath),
            `Changed entry was not served by the new release: ${entry.name}`);
        }
        try {
          await expect(page.locator(entry.button)).toBeVisible({ timeout: 8000 });
          await page.locator(entry.button).click({ timeout: 8000 });
          await page.waitForFunction(selector => {
            const stream = document.querySelector(selector)?.srcObject;
            return stream instanceof MediaStream && stream.getVideoTracks().some(track => track.readyState === 'live');
          }, entry.video, { timeout: 8000 });
        } catch (error) {
          throw new Error(`${entry.page} did not start a test camera after upgrading: ${errors.join('; ') || error.message}`, { cause: error });
        }
        assert.deepEqual(errors, [], `JavaScript errors after starting ${entry.page}`);
        console.log(`PASS ${entry.name} (${warmEntries ? 'warm entries and dependencies' : 'warm dependencies'})`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
