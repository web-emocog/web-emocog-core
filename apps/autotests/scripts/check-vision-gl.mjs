import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

const engines = { chromium, firefox, webkit };
const selected = (process.env.WECOG_TEST_ENGINES || 'chromium,firefox,webkit').split(',');
assert.ok(selected.length > 0 && selected.every(name => Object.hasOwn(engines, name))
  && new Set(selected).size === selected.length, 'invalid CI engine selection');

const workerSource = `
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    self.postMessage({ available: !!gl, renderer: gl ? String(gl.getParameter(gl.RENDERER)).slice(0, 200) : null });
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (_) { self.postMessage({ available: false, renderer: null }); }
  self.close();
`;
const server = http.createServer((request, response) => {
  if (request.headers.host !== `127.0.0.1:${server.address().port}` || request.method !== 'GET'
      || request.headers['sec-fetch-site'] === 'cross-site') { response.writeHead(403).end(); return; }
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; worker-src 'self'; frame-ancestors 'none'");
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Local GL probe</title>'); }
  else if (request.url === '/probe.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(workerSource); }
  else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// Functional CI requires a real WebGL implementation, including in Workers.
// Software rendering is valid here, but cannot establish hardware FPS acceptance.
try {
for (const name of selected) {
  const engine = engines[name];
  const browser = await engine.launch({
    headless: process.env.WECOG_TEST_HEADED !== '1',
    ...(name === 'chromium' ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}),
  });
  try {
    const context = await browser.newContext({ permissions: [] });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const windowGl = { available: !!gl, renderer: gl ? String(gl.getParameter(gl.RENDERER)).slice(0, 200) : null };
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      let worker, timer;
      try {
        const workerGl = await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('worker_webgl_probe_timeout')), 10000);
          worker = new Worker('/probe.js');
          worker.onmessage = event => resolve(event.data);
          worker.onerror = () => reject(new Error('worker_webgl_probe_failed'));
        });
        return { windowGl, workerGl };
      } finally {
        clearTimeout(timer); worker?.terminate();
      }
    });
    console.log(JSON.stringify({ engine: name, version: browser.version(), ...result }));
    assert.equal(result.windowGl.available, true, `${name}: window WebGL2 unavailable; verify CI display/Mesa setup`);
    assert.equal(result.workerGl.available, true, `${name}: Worker WebGL2 unavailable; verify CI display/Mesa setup`);
  } finally { await browser.close(); }
}
} finally { await new Promise(resolve => server.close(resolve)); }
