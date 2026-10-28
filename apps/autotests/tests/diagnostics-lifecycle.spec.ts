import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Synthetic fixtures only. Never request sensors or retain a recording of keyboard inputs.
test.use({ permissions: [], trace: 'off', screenshot: 'off', video: 'off' });

async function boot(page: Page, { allowed = true, enabled = true, hud = true } = {}) {
  await page.route('**/__diagnostics_audit__', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html><head><meta charset="utf-8"><title>Synthetic audit</title></head><body><main id="host"></main></body></html>' }));
  await page.goto('/__diagnostics_audit__');
  // Initialize Playwright's own injected event handlers before counting application handlers.
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(({ allowed, enabled }) => {
    const w = window as any;
    w.WECOG_ALLOW_DEBUG = allowed;
    if (enabled) localStorage.setItem('wecog_debug', '1'); else localStorage.removeItem('wecog_debug');
    w.__WECOG_STATE__ = { runtime: { currentPhase: 'cognitive_stimulus' }, sessionData: {} };
    w.__auditListeners = [];
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const capture = (options: any) => typeof options === 'boolean' ? options : !!options?.capture;
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      if ((this === window || this === document) && callback && !w.__auditListeners.some((item: any) =>
        item.target === this && item.type === type && item.callback === callback && item.capture === capture(options))) {
        w.__auditListeners.push({ target: this, type, callback, capture: capture(options) });
      }
      return add.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (type, callback, options) {
      w.__auditListeners = w.__auditListeners.filter((item: any) => !(item.target === this && item.type === type
        && item.callback === callback && item.capture === capture(options)));
      return remove.call(this, type, callback, options);
    };
    let id = 0;
    w.__auditFrames = new Map(); w.__auditIntervals = new Map();
    window.requestAnimationFrame = callback => { w.__auditFrames.set(++id, callback); return id; };
    window.cancelAnimationFrame = key => { w.__auditFrames.delete(key); };
    window.setInterval = ((callback: any) => { w.__auditIntervals.set(++id, callback); return id; }) as any;
    window.clearInterval = key => { w.__auditIntervals.delete(key); };
  }, { allowed, enabled });
  await page.addScriptTag({ url: '/apps/participant-web/js/web-page/debug-runtime.js' });
  if (hud) await page.addScriptTag({ url: '/apps/participant-web/js/web-page/debug-hud.js' });
}

async function runner(page: Page) {
  await boot(page, { hud: false, enabled: false });
  await page.addScriptTag({ url: '/apps/participant-web/js/protocol-runner-new.js' });
}

test('debug records task key codes but never input/password/textarea/contenteditable or shadow inputs', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const w = window as any, debug = w.WECOG_DEBUG;
    document.body.insertAdjacentHTML('beforeend', '<input id="email" type="email"><input id="password" type="password">'
      + '<textarea id="notes"></textarea><div id="editable" contenteditable="true"><span>fixture</span></div>'
      + '<div id="role" role="textbox" tabindex="0"></div><div id="shadow"></div><div id="closed"></div><button id="answer">Answer</button>');
    const shadow = document.getElementById('shadow')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input type="text">';
    const controls = ['email', 'password', 'notes', 'editable', 'role'].map(id => document.getElementById(id)!);
    controls.push(shadow.querySelector('input')!);
    const closed = document.getElementById('closed')!.attachShadow({ mode: 'closed' });
    closed.innerHTML = '<input type="password">'; controls.push(closed.querySelector('input')!);
    const emit = (target: Element, options: KeyboardEventInit = {}) => {
      for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, {
        key: 'sensitive-letter', code: 'KeyS', bubbles: true, composed: true, ...options }));
    };
    for (const element of controls) {
      element.focus(); debug.clear(); emit(element);
      if (debug.exportDebugBundle().timelines.keys.some((row: any) => row.type !== 'focusin')) return { safe: false };
    }
    const button = document.getElementById('answer')!;
    button.focus(); debug.clear();
    emit(button, { isComposing: true }); emit(button, { ctrlKey: true }); emit(button, { metaKey: true }); emit(button, { altKey: true });
    const modified = debug.exportDebugBundle().timelines.keys.length;
    let calls = 0, prevented = false;
    button.addEventListener('keydown', event => { calls++; prevented ||= event.defaultPrevented; });
    emit(button, { key: 'я', code: 'KeyZ' }); emit(button, { key: '`', code: 'Backquote' });
    const keys = debug.exportDebugBundle().timelines.keys;
    const taskCalls = calls;
    w.__WECOG_STATE__.runtime.currentPhase = 'registration'; emit(button);
    return { safe: true, modified, calls: taskCalls, prevented, countAfterRegistration: debug.exportDebugBundle().timelines.keys.length,
      keys: keys.map((row: any) => ({ type: row.type, physicalCode: row.physicalCode, hasKey: Object.prototype.hasOwnProperty.call(row, 'key') })) };
  });
  expect(result).toEqual({ safe: true, modified: 0, calls: 2, prevented: false, countAfterRegistration: 4, keys: [
    { type: 'keydown', physicalCode: 'KeyZ', hasKey: false }, { type: 'keyup', physicalCode: 'KeyZ', hasKey: false },
    { type: 'keydown', physicalCode: 'Backquote', hasKey: false }, { type: 'keyup', physicalCode: 'Backquote', hasKey: false }
  ] });
});

test('real focus events expose only coarse control type, not IDs/classes/values', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'private-id-fixture'; input.className = 'private-class-fixture';
    input.value = 'private-value-fixture'; document.body.append(input); input.focus();
  });
  const bundle = await page.evaluate(() => (window as any).WECOG_DEBUG.exportDebugBundle());
  for (const marker of ['private-id-fixture', 'private-class-fixture', 'private-value-fixture']) expect(JSON.stringify(bundle)).not.toContain(marker);
  expect(bundle.timelines.keys.at(-1)).toMatchObject({ type: 'focusin', tag: 'input' });
});

test('browser-generated typing in a password field stays private and response keys still reach the page', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<input type="password" id="typed"><button id="task">Respond</button>');
  });
  await page.locator('#typed').focus();
  await page.evaluate(() => (window as any).WECOG_DEBUG.clear());
  await page.keyboard.type('SyntheticPrivateFixture42');
  expect(await page.evaluate(() => (window as any).WECOG_DEBUG.exportDebugBundle().timelines.keys)).toEqual([]);
  await page.locator('#task').focus();
  await page.evaluate(() => {
    const w = window as any; w.WECOG_DEBUG.clear(); w.__responses = [];
    document.getElementById('task')!.addEventListener('keydown', event => w.__responses.push({ code: event.code, prevented: event.defaultPrevented }));
  });
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => (window as any).__responses)).toEqual([{ code: 'Space', prevented: false }]);
  expect(await page.evaluate(() => (window as any).WECOG_DEBUG.exportDebugBundle().timelines.keys.map((row: any) => row.physicalCode)))
    .toEqual(['Space', 'Space']);
});

test('actual downloaded debug bundle contains technical data, not raw answers or error text', async ({ page }) => {
  await boot(page);
  const downloaded = page.waitForEvent('download');
  await page.evaluate(() => {
    const w = window as any;
    w.__WECOG_STATE__.sessionData.events = [{ type: 'rt', rtMs: 321, answer: 'private-answer-fixture' }];
    w.WECOG_DEBUG.error('fixture', 'failure', new Error('private-error-fixture'));
    w.WECOG_DEBUG.downloadDebugBundle('synthetic-diagnostics.json');
  });
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('synthetic-diagnostics.json');
  const bundle = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(bundle.privacyVersion).toBe('technical_only.v2');
  expect(bundle.sessionEvents).toEqual([{ type: 'rt', rtMs: 321 }]);
  expect(JSON.stringify(bundle)).not.toContain('private-answer-fixture');
  expect(JSON.stringify(bundle)).not.toContain('private-error-fixture');
});

test('100 HUD cycles leave no owned keyboard/focus listeners or RAF; stale frames/buttons cannot restart them', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const w = window as any, hud = w.WECOG_DEBUG_HUD;
    hud.setExpanded(true);
    const staleFrame = [...w.__auditFrames.values()][0];
    const staleButton = document.getElementById('wecog-debug-toggle-btn')!;
    let peak = 0;
    for (let i = 0; i < 100; i++) {
      hud.start(); peak = Math.max(peak, w.__auditListeners.length);
      hud.stop();
      if (w.__auditFrames.size || w.__auditListeners.some((item: any) => item.target === document)) return { clean: false };
      hud.start();
      const before = w.__auditFrames.size; staleFrame(0); staleButton.dispatchEvent(new Event('click'));
      if (w.__auditFrames.size !== before || document.getElementById('wecog-debug-toggle-btn')!.getAttribute('aria-expanded') !== 'true') return { clean: false };
      hud.stop();
    }
    const stopped = { frames: w.__auditFrames.size, listeners: w.__auditListeners.length };
    hud.dispose(); w.WECOG_DEBUG.dispose();
    return { clean: true, peak, stopped, remaining: w.__auditListeners.length,
      roots: document.querySelectorAll('#wecog-debug-hud,#wecog-debug-toggle-btn').length };
  });
  expect(result).toEqual({ clean: true, peak: 9, stopped: { frames: 0, listeners: 5 }, remaining: 0, roots: 0 });
});

test('reloading diagnostic scripts replaces their handlers and old API objects stay inert', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { const w = window as any; w.__oldHud = w.WECOG_DEBUG_HUD; w.__oldDebug = w.WECOG_DEBUG; });
  await page.addScriptTag({ url: '/apps/participant-web/js/web-page/debug-runtime.js' });
  await page.addScriptTag({ url: '/apps/participant-web/js/web-page/debug-hud.js' });
  const result = await page.evaluate(() => {
    const w = window as any;
    w.__oldHud.start(); w.__oldDebug.log('stale', 'event', { value: 'not-retained' });
    return { listeners: w.__auditListeners.length, frames: w.__auditFrames.size, oldRunning: w.__oldHud.isRunning(),
      oldEnabled: w.__oldDebug.isEnabled(), roots: document.querySelectorAll('#wecog-debug-hud').length };
  });
  expect(result).toEqual({ listeners: 9, frames: 1, oldRunning: false, oldEnabled: false, roots: 1 });
});

test('pagehide stops HUD; BFCache-style pageshow and storage opt-in restore only one loop', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const w = window as any, hud = w.WECOG_DEBUG_HUD;
    window.dispatchEvent(new Event('pagehide'));
    const stopped = !hud.isRunning() && w.__auditFrames.size === 0;
    window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('pageshow'));
    const restored = hud.isRunning() && w.__auditFrames.size === 1;
    localStorage.removeItem('wecog_debug'); window.dispatchEvent(new StorageEvent('storage', { key: 'wecog_debug' }));
    const disabled = !hud.isRunning() && w.__auditFrames.size === 0 && w.WECOG_DEBUG.exportJson().count === 0;
    localStorage.setItem('wecog_debug', '1'); window.dispatchEvent(new StorageEvent('storage', { key: 'wecog_debug' }));
    return { stopped, restored, disabled, running: hud.isRunning(), listeners: w.__auditListeners.length, frames: w.__auditFrames.size };
  });
  expect(result).toEqual({ stopped: true, restored: true, disabled: true, running: true, listeners: 9, frames: 1 });
});

test('HUD has bounded diagnostic polling, correct absent overlay and fails safely if optional QC inspection throws', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const w = window as any, hud = w.WECOG_DEBUG_HUD;
    hud.stop(); let calls = 0, time = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
    w.__WECOG_STATE__.runtime.qcMetrics = { isRunning: () => true, getCurrentMetrics: () => { calls++; return { cameraFps: 30 }; } };
    const absentOverlay = hud.collectSnapshot().runtime.activeOverlay; calls = 0;
    hud.start();
    for (let i = 1; i <= 120; i++) {
      time = i * 1000 / 120;
      const [id, callback] = [...w.__auditFrames.entries()][0]; w.__auditFrames.delete(id); callback(time);
    }
    const bounded = calls >= 4 && calls <= 6;
    w.__WECOG_STATE__.runtime.qcMetrics.getCurrentMetrics = () => { throw new Error('optional-fixture'); };
    time += 250; const [id, callback] = [...w.__auditFrames.entries()][0]; w.__auditFrames.delete(id); callback(time);
    return { bounded, absentOverlay, stopped: !hud.isRunning(), frames: w.__auditFrames.size,
      keyboardListeners: w.__auditListeners.filter((item: any) => item.target === document).length };
  });
  expect(result).toEqual({ bounded: true, absentOverlay: 'none', stopped: true, frames: 0, keyboardListeners: 0 });
});

test('debug is inert without either gate and cannot inspect a disabled runtime', async ({ page }) => {
  await boot(page, { allowed: false });
  expect(await page.evaluate(() => {
    const w = window as any; w.WECOG_DEBUG_HUD.start();
    return { enabled: w.WECOG_DEBUG.enabled, running: w.WECOG_DEBUG_HUD.isRunning(), snapshot: w.WECOG_DEBUG_HUD.collectSnapshot(),
      frames: w.__auditFrames.size, roots: document.querySelectorAll('#wecog-debug-hud').length,
      documentListeners: w.__auditListeners.filter((item: any) => item.target === document).length };
  })).toEqual({ enabled: false, running: false, snapshot: null, frames: 0, roots: 0, documentListeners: 0 });
});

test('legacy runner preserves final block and ignores stale/double-click navigation', async ({ page }) => {
  await runner(page);
  const result = await page.evaluate(async () => {
    const w = window as any, api = w.ProtocolRunner, host = document.getElementById('host')!;
    window.fetch = async () => new Response(JSON.stringify({ definition: { blocks: [
      { type: 'instruction', params: { title: 'First' } }, { type: 'instruction', params: { title: 'Second' } },
      { type: 'final', params: { title: 'Authored final', text: 'Retained final text' } } ] } }));
    await api.loadByCode('synthetic'); api.start(host);
    const first = host.querySelector('button')!; first.click(); first.click();
    const second = host.querySelector('h2')!.textContent;
    const button = host.querySelector('button')!; button.click(); button.click();
    return { second, title: host.querySelector('h2')!.textContent, text: host.querySelector('p')!.textContent,
      completed: api.getRunLog().run_log.map((row: any) => row.block_type) };
  });
  expect(result).toEqual({ second: 'Second', title: 'Authored final', text: 'Retained final text', completed: ['instruction', 'instruction'] });
});

test('100 legacy rest/baseline/recovery cycles dispose intervals, handlers and detached screens', async ({ page }) => {
  await runner(page);
  const result = await page.evaluate(async () => {
    const w = window as any, api = w.ProtocolRunner, host = document.getElementById('host')!;
    for (let i = 0; i < 100; i++) {
      window.fetch = async () => new Response(JSON.stringify({ definition: { blocks: [
        { type: ['rest', 'baseline', 'recovery'][i % 3], params: { duration_sec: 0 } },
        { type: 'instruction', params: { title: 'Next' } } ] } }));
      await api.loadByCode('synthetic'); api.start(host);
      if (w.__auditIntervals.size !== 1) return { clean: false };
      const stale = [...w.__auditIntervals.values()][0];
      api.start(host); stale();
      if (w.__auditIntervals.size !== 1 || api.getRunLog().run_log.length) return { clean: false };
      [...w.__auditIntervals.values()][0]();
      if (w.__auditIntervals.size || host.querySelector('h2')!.textContent !== 'Next') return { clean: false };
      const staleButton = host.querySelector('button')!; api.stop(); staleButton.click();
      if (api.getRunLog().run_log.length !== 1) return { clean: false };
    }
    window.fetch = async () => new Response(JSON.stringify({ definition: { blocks: [{ type: 'rest', params: { duration_sec: 1 } }] } }));
    await api.loadByCode('detach'); api.start(host); host.remove(); [...w.__auditIntervals.values()][0]();
    return { clean: true, timers: w.__auditIntervals.size, completed: api.getRunLog().run_log.length };
  });
  expect(result).toEqual({ clean: true, timers: 0, completed: 0 });
});

test('legacy stale questionnaire submit cannot add answers to a replacement run', async ({ page }) => {
  await runner(page);
  const result = await page.evaluate(async () => {
    const w = window as any, api = w.ProtocolRunner, host = document.getElementById('host')!;
    window.fetch = async () => new Response(JSON.stringify({ definition: { blocks: [{ type: 'questionnaire',
      params: { config: [{ name: 'fixture', type: 'text' }] } }, { type: 'final' }] } }));
    await api.loadByCode('old'); api.start(host);
    const staleForm = host.querySelector('form')!; staleForm.querySelector('input')!.value = 'stale-fixture';
    await api.loadByCode('new'); api.start(host);
    staleForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const empty = Object.keys(api.getRunLog().answers).length === 0;
    host.querySelector('input')!.value = 'current-fixture';
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return { empty, answers: api.getRunLog().answers, completed: api.getRunLog().run_log.length };
  });
  expect(result).toEqual({ empty: true, answers: { fixture: 'current-fixture' }, completed: 1 });
});

test('legacy countdown does not truncate large durations and rejects invalid authored values', async ({ page }) => {
  await runner(page);
  const result = await page.evaluate(async () => {
    const w = window as any, api = w.ProtocolRunner, host = document.getElementById('host')!;
    const valid = [], invalid = [];
    for (const duration of [0, 60, 2147483648, -1, 'broken', 1.25]) {
      window.fetch = async () => new Response(JSON.stringify({ definition: { blocks: [{ type: 'rest', params: { duration_sec: duration } }] } }));
      await api.loadByCode('synthetic'); api.start(host);
      if (typeof duration === 'number' && Number.isSafeInteger(duration) && duration >= 0) {
        valid.push(host.querySelector('.rest-timer')!.textContent === duration + ' s');
      } else invalid.push(host.querySelector('.error') !== null && w.__auditIntervals.size === 0);
      api.stop();
    }
    return { valid, invalid };
  });
  expect(result).toEqual({ valid: [true, true, true], invalid: [true, true, true] });
});
