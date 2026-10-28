import { test, expect, type Page } from '@playwright/test';

// Ownership/lifecycle tests only: no real sensors, models, face recording or physiological claims.
const origin = process.env.EMOCOG_WEB_ORIGIN || 'http://127.0.0.1:4173';
const engineModule = `
export class RppgEngine { update() { window.__updates++; return window.__output || null; } }
export class SessionReporter {
  constructor(options) { window.__reporterOptions = options; }
  push(value) { window.__reported.push(value); }
  finalize() { window.__finalized++; if (window.__reporterFailure) throw new Error('synthetic private finalize error'); return { samples: [] }; }
}
`;
const visionModule = `
export const FilesetResolver = { forVisionTasks: async path => { window.__wasmPath = path; return {}; } };
export const FaceLandmarker = { createFromOptions: async (resolver, options) => {
  window.__models++;
  window.__modelPath = options.baseOptions.modelAssetPath;
  if (window.__stage === 'gpu-fallback' && options.baseOptions.delegate === 'GPU') throw new Error('synthetic private GPU error');
  const task = { close() { window.__closed++; }, detectForVideo() {
    return { faceLandmarks: window.__landmarks ? [window.__landmarks] : [] };
  } };
  if (window.__stage === 'model') return new Promise((resolve, reject) => {
    window.__finishModel = () => resolve(task); window.__failModel = reject;
  });
  return task;
} };
`;

async function boot(page: Page, stage = 'running', prefix = '') {
  let role = 'developer';
  await page.addInitScript(stage => {
    const w = window as any;
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify({ id: 1, role: 'developer', email: 'synthetic@example.test' }));
    w.__stage = stage; w.__models = 0; w.__closed = 0; w.__cameraCalls = 0;
    w.__updates = 0; w.__finalized = 0; w.__streams = []; w.__reported = [];
    const objects = new WeakMap();
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true, get() { return objects.get(this) || null; }, set(value) { objects.set(this, value); }
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => w.__stage === 'metadata' ? 0 : 2 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => w.__stage === 'metadata' ? 0 : 320 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => w.__stage === 'metadata' ? 0 : 240 });
    HTMLMediaElement.prototype.pause = () => {};
    HTMLMediaElement.prototype.play = () => w.__stage === 'play'
      ? new Promise(resolve => { w.__finishPlay = resolve; }) : Promise.resolve();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: () => {
        w.__cameraCalls++;
        const track = { stops: 0, stop() { this.stops++; } };
        const stream = { getTracks: () => [track], track }; w.__streams.push(stream);
        if (w.__stage === 'camera') return new Promise(resolve => { w.__finishCamera = () => resolve(stream); });
        return Promise.resolve(stream);
      }
    } });
  }, stage);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3000') {
      const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      return route.fulfill({ headers, json: url.pathname === '/auth/me'
        ? { id: 1, role, email: 'synthetic@example.test', csrf_token: 'synthetic-csrf' } : {} });
    }
    if (url.origin !== origin) return route.abort();
    if (stage === 'module-missing' && url.pathname.endsWith('/bpm-test.js')) return route.abort();
    if (url.pathname.includes('/rppg_alg/index.js')) return route.fulfill({ contentType: 'text/javascript', body: engineModule });
    if (stage !== 'real-model' && url.pathname.endsWith('/vision_bundle.mjs')) return route.fulfill({ contentType: 'text/javascript', body: visionModule });
    if (prefix && url.pathname.startsWith(prefix + '/')) {
      const response = await route.fetch({ url: origin + url.pathname.slice(prefix.length) + url.search });
      return route.fulfill({ response });
    }
    return route.continue();
  });
  await page.goto(origin + prefix + '/apps/web/developer/bpm-test.html');
  await expect(page.locator('#btnStart')).toBeVisible();
  return { setRole: (value: string) => { role = value; } };
}

async function start(page: Page) {
  await page.locator('#btnStart').click();
}

test('pagehide during pending camera acquisition cannot resurrect the test and stops late tracks', async ({ page }) => {
  await boot(page, 'camera'); await start(page);
  await expect.poll(() => page.evaluate(() => (window as any).__cameraCalls)).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    (window as any).__finishCamera();
  });
  await expect(page.locator('#screen')).not.toHaveClass(/running/);
  await expect.poll(() => page.evaluate(() => (window as any).__streams[0].track.stops)).toBe(1);
  expect(await page.locator('#video').evaluate((video: HTMLVideoElement) => video.srcObject)).toBeNull();
});

for (const stage of ['model', 'camera', 'play', 'metadata']) {
  test(`Stop cancels ${stage}, releases resources, and a new run ignores the old result`, async ({ page }) => {
    await boot(page, stage); await start(page);
    await expect.poll(() => page.evaluate(stage => stage === 'model' ? (window as any).__models
      : stage === 'play' ? Number(!!(window as any).__finishPlay) : (window as any).__cameraCalls, stage)).toBe(1);
    await page.locator('#btnStop').click();
    await expect(page.locator('#btnStart')).toBeEnabled();
    await page.evaluate(stage => {
      const w = window as any;
      w.__late = stage === 'model' ? w.__finishModel : stage === 'camera' ? w.__finishCamera : stage === 'play' ? w.__finishPlay : () => document.getElementById('video')!.dispatchEvent(new Event('loadeddata'));
      w.__stage = 'running';
    }, stage);
    await start(page);
    if (stage === 'model' || stage === 'camera') {
      expect(await page.evaluate(stage => stage === 'model' ? (window as any).__models : (window as any).__cameraCalls, stage)).toBe(1);
      await page.evaluate(() => (window as any).__late());
    }
    await expect(page.locator('#screen')).toHaveClass(/running/);
    if (stage === 'play' || stage === 'metadata') await page.evaluate(() => (window as any).__late());
    await page.locator('#btnStop').click();
    await expect.poll(() => page.evaluate(() => (window as any).__closed)).toBe(2);
    expect(await page.evaluate(() => (window as any).__streams.map((stream: any) => stream.track.stops)))
      .toEqual(stage === 'model' ? [1] : [1, 1]);
    await expect(page.locator('#btnStart')).toBeEnabled();
    await expect(page.locator('#screen')).not.toHaveClass(/running/);
  });
}

for (const prefix of ['', '/audit-prefix']) {
  test(`same-origin module assets resolve at ${prefix || 'root'} without probing guessed ancestors`, async ({ page }) => {
    const probes: string[] = [];
    page.on('request', request => { if (request.url().includes('/rppg_alg/index.js')) probes.push(new URL(request.url()).pathname); });
    await boot(page, 'running', prefix); await start(page);
    await expect(page.locator('#screen')).toHaveClass(/running/);
    expect([...new Set(probes)]).toEqual([prefix + '/lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js']);
    const paths = await page.evaluate(() => ({ wasm: (window as any).__wasmPath, model: (window as any).__modelPath }));
    expect(new URL(paths.wasm, origin + prefix + '/apps/web/developer/bpm-test.html').pathname)
      .toBe(prefix + '/apps/participant-web/js/vendor/mediapipe/wasm');
    expect(new URL(paths.model, origin + prefix + '/apps/web/developer/bpm-test.html').pathname)
      .toBe(prefix + '/apps/participant-web/js/vendor/mediapipe/models/face_landmarker.task');
    await page.locator('#btnStop').click();
  });
}

test('100 start/stop cycles retain no stage timers, video listeners or RAF and late frames cannot restart them', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const w = window as any, frames = new Map(), timers = new Map(), listeners = new Set();
    const video = document.getElementById('video')!, nativeTimeout = window.setTimeout, nativeClear = window.clearTimeout;
    const add = video.addEventListener.bind(video), remove = video.removeEventListener.bind(video);
    video.addEventListener = ((type: string, fn: any, options: any) => { listeners.add(fn); add(type, fn, options); }) as any;
    video.removeEventListener = ((type: string, fn: any, options: any) => { listeners.delete(fn); remove(type, fn, options); }) as any;
    let id = 0;
    window.requestAnimationFrame = fn => { frames.set(id, fn); return id++; };
    window.cancelAnimationFrame = handle => { frames.delete(handle); };
    window.setTimeout = ((fn: any, ms: number) => {
      const handle = nativeTimeout(() => { timers.delete(handle); fn(); }, ms); timers.set(handle, ms); return handle;
    }) as any;
    window.clearTimeout = handle => { timers.delete(handle); nativeClear(handle); };
    for (let i = 0; i < 100; i++) {
      document.getElementById('btnStart')!.click();
      let spins = 0;
      while (!frames.size) {
        if (++spins > 1000) throw new Error('Synthetic start did not complete');
        await new Promise(resolve => nativeTimeout(resolve, 2));
      }
      const late = Array.from(frames.values())[0] as FrameRequestCallback;
      if (typeof late !== 'function') throw new Error('A fully started run must own one RAF');
      document.getElementById('btnStop')!.click(); late(0);
      if (frames.size || timers.size || listeners.size) return { clean: false, iteration: i };
    }
    return { clean: true, models: w.__models, closed: w.__closed, finalized: w.__finalized,
      stopped: w.__streams.every((stream: any) => stream.track.stops === 1),
      cap: w.__reporterOptions.maxSamples, frames: frames.size, timers: timers.size, listeners: listeners.size };
  });
  expect(result).toEqual({ clean: true, models: 100, closed: 100, finalized: 100,
    stopped: true, cap: 7200, frames: 0, timers: 0, listeners: 0 });
});

for (const stage of ['model', 'camera', 'play', 'metadata']) {
test(`a pending ${stage} times out and late native results cannot change the error screen`, async ({ page }) => {
  await boot(page, stage);
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.evaluate(() => document.getElementById('btnStart')!.click());
  await expect.poll(() => page.evaluate(stage => stage === 'model' ? (window as any).__models
    : stage === 'play' ? Number(!!(window as any).__finishPlay) : (window as any).__cameraCalls, stage)).toBe(1);
  await page.clock.runFor(31000);
  await expect(page.locator('#btnStart')).toBeEnabled();
  await expect(page.locator('#status')).toContainText('Время ожидания');
  await page.evaluate(stage => {
    const w = window as any;
    if (stage === 'model') w.__finishModel();
    if (stage === 'camera') w.__finishCamera();
    if (stage === 'play') w.__finishPlay();
    if (stage === 'metadata') document.getElementById('video')!.dispatchEvent(new Event('loadeddata'));
  }, stage);
  if (stage !== 'model') await expect.poll(() => page.evaluate(() => (window as any).__streams[0].track.stops)).toBe(1);
  await expect(page.locator('#screen')).not.toHaveClass(/running/);
  await expect.poll(() => page.evaluate(() => (window as any).__closed)).toBe(1);
});
}

test('stopping a held module probe aborts its staff request and never requests the camera', async ({ page }) => {
  let pending = false, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await boot(page);
  await page.route('**/rppg_alg/index.js*', async route => {
    pending = true; await held;
    return route.fulfill({ contentType: 'text/javascript', body: engineModule });
  });
  await start(page); await expect.poll(() => pending).toBe(true);
  await page.locator('#btnStop').click();
  await expect.poll(() => page.evaluate(() => (window as any).WecogHttp.pendingCount())).toBe(0);
  release();
  await expect(page.locator('#btnStart')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__cameraCalls)).toBe(0);
  await expect(page.locator('#status')).toHaveText('Остановлено');
});

test('a stopped model failure does not trigger CPU fallback or expose its raw error', async ({ page }) => {
  await boot(page, 'model'); await start(page);
  await expect.poll(() => page.evaluate(() => (window as any).__models)).toBe(1);
  await page.locator('#btnStop').click();
  await page.evaluate(() => (window as any).__failModel(new Error('private@example.test /private/credential-fixture')));
  await expect(page.locator('#status')).toHaveText('Остановлено');
  expect(await page.evaluate(() => ({ models: (window as any).__models, camera: (window as any).__cameraCalls })))
    .toEqual({ models: 1, camera: 0 });
  await expect(page.locator('#log')).not.toContainText('credential-fixture');
});

test('normal GPU rejection still falls back to CPU; reporter failure cannot retain the camera', async ({ page }) => {
  await boot(page, 'gpu-fallback'); await start(page);
  await expect(page.locator('#screen')).toHaveClass(/running/);
  expect(await page.evaluate(() => (window as any).__models)).toBe(2);
  await page.evaluate(() => { (window as any).__reporterFailure = true; });
  await page.locator('#btnStop').click();
  await expect(page.locator('#btnStart')).toBeEnabled();
  expect(await page.evaluate(() => ({ closed: (window as any).__closed, stops: (window as any).__streams[0].track.stops })))
    .toEqual({ closed: 1, stops: 1 });
  await expect(page.locator('#log')).not.toContainText('synthetic private');
});

test('staff blocking stops a pending run, and a denied admission never requests camera access', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { (window as any).WecogBpmAccess = Promise.resolve({ ok: false }); });
  await start(page);
  await expect(page.locator('#status')).toContainText('доступ');
  expect(await page.evaluate(() => (window as any).__cameraCalls)).toBe(0);
  await page.evaluate(() => {
    const w = window as any; w.WecogBpmAccess = Promise.resolve({ ok: true, user: { id: 1, role: 'developer' } }); w.__stage = 'camera';
  });
  await start(page);
  await expect.poll(() => page.evaluate(() => (window as any).__cameraCalls)).toBe(1);
  await page.evaluate(() => { window.dispatchEvent(new Event('wecog:staffsessionblocked')); (window as any).__finishCamera(); });
  await expect(page.locator('#btnStart')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as any).__streams[0].track.stops)).toBe(1);
  await expect(page.locator('#screen')).not.toHaveClass(/running/);
});

test('module loading failure has a visible bounded recovery state instead of an active dead Start button', async ({ page }) => {
  await boot(page, 'module-missing');
  await expect(page.locator('#status')).toContainText('Не удалось загрузить модуль');
  await expect(page.locator('#btnStart')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__cameraCalls)).toBe(0);
});

test('fresh server role revocation prevents camera access despite cached developer admission', async ({ page }) => {
  const auth = await boot(page); auth.setRole('researcher');
  await start(page);
  await expect(page.locator('#status')).toContainText('доступ');
  expect(await page.evaluate(() => ({ models: (window as any).__models, camera: (window as any).__cameraCalls })))
    .toEqual({ models: 0, camera: 0 });
});

test('server camera policy is reported accurately without weakening it or requesting a device', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => Object.defineProperty(document, 'permissionsPolicy', {
    configurable: true, value: { allowsFeature: () => false }
  }));
  await start(page);
  await expect(page.locator('#status')).toContainText('политикой этого сервера');
  expect(await page.evaluate(() => ({ models: (window as any).__models, camera: (window as any).__cameraCalls })))
    .toEqual({ models: 0, camera: 0 });
});

test('real self-hosted MediaPipe can initialize and close without accessing a physical camera', async ({ page }) => {
  test.setTimeout(60000);
  await boot(page, 'real-model');
  await page.evaluate(async () => {
    const w = window as any;
    // @ts-expect-error browser-only dynamic module
    const vision = await import('/apps/participant-web/js/vendor/mediapipe/vision_bundle.mjs');
    const create = vision.FaceLandmarker.createFromOptions.bind(vision.FaceLandmarker);
    w.__nativeTasks = 0;
    vision.FaceLandmarker.createFromOptions = async (...args: any[]) => {
      const task = await create(...args), close = task.close.bind(task); w.__nativeTasks++;
      task.close = () => { w.__closed++; close(); };
      return task;
    };
    // Initialize/close a real task; do not pretend a mock video is a real frame benchmark.
    window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {};
    document.getElementById('btnStart')!.click();
  });
  await expect(page.locator('#screen')).toHaveClass(/running/, { timeout: 35000 });
  await page.evaluate(() => document.getElementById('btnStop')!.click());
  expect(await page.evaluate(() => ({ tasks: (window as any).__nativeTasks,
    closed: (window as any).__closed, stops: (window as any).__streams[0].track.stops })))
    .toEqual({ tasks: 1, closed: 1, stops: 1 });
});

test('developer summaries never promote raw/held respiration or a held BPM to fresh measurements', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__landmarks = [{ x: .3, y: .25 }, { x: .7, y: .75 }];
    let time = 0;
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: () => (time += 1 / 30) });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args: any[]) {
      if (args[0] instanceof HTMLVideoElement) return;
      return (draw as any).apply(this, args);
    };
    w.__output = { published: false, bpmPublished: 70, publishReason: 'hold_last', confidence: .9,
      features: { respRateRaw: 18, respRate: 18, respConf: .9, respHeld: true } };
  });
  await start(page);
  await expect.poll(() => page.evaluate(() => (window as any).__reported.length)).toBeGreaterThan(0);
  await expect(page.locator('#status')).not.toContainText('дыхание');
  expect(await page.evaluate(() => (window as any).__reported.every((row: any) => !row.published && row.features.respRate === null))).toBe(true);
  await page.evaluate(() => {
    const w = window as any; w.__reported = [];
    w.__output = { published: true, bpmPublished: 70, publishReason: 'ok', confidence: .9,
      features: { respRate: 16, respConf: .9, respHeld: false, respPublished: true } };
  });
  await expect(page.locator('#status')).toContainText('дыхание ~16');
  expect(await page.evaluate(() => (window as any).__reported.every((row: any) => row.published && row.features.respRate === 16))).toBe(true);
  await page.locator('#btnStop').click();
});
