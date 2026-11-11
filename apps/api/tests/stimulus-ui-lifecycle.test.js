const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../web/researcher-stimuli.js'), 'utf8');

function harness() {
  class Target {
    handlers = new Map();
    addEventListener(type, fn) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
    emit(type) { for (const fn of [...(this.handlers.get(type) || [])]) fn({ type }); }
    count() { return [...this.handlers.values()].reduce((n, handlers) => n + handlers.size, 0); }
  }
  const observers = [];
  class Observer {
    active = false;
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() { this.active = true; }
    unobserve() {}
    disconnect() { this.active = false; }
  }
  const owner = { isConnected: true }, host = { firstElementChild: owner };
  const window = new Target(), document = new Target();
  document.getElementById = () => host;
  const store = new Map([['emocog_workspace_owner_v1', '1'], ['emocog_selected_project_id', '7']]);
  let id = 0;
  const frames = new Map(), timers = new Map();
  const context = vm.createContext({ window, document, location: { hash: '#/stimuli' },
    localStorage: { getItem: key => store.get(key) || '' },
    getApiBaseForResearcher: () => 'http://127.0.0.1:3000',
    MutationObserver: Observer, ResizeObserver: Observer, IntersectionObserver: Observer,
    requestAnimationFrame: fn => { frames.set(id, fn); return id++; },
    cancelAnimationFrame: key => frames.delete(key),
    setTimeout: fn => { timers.set(id, fn); return id++; }, clearTimeout: key => timers.delete(key),
    stimuliList: [{ id: '42' }], CURRENT_LANG: 'ru' });
  vm.runInContext(source, context);
  return { window, document, owner, store, frames, timers, observers, context,
    baseline: window.count(), evaluate: code => vm.runInContext(code, context) };
}

test('batch upload persists each acknowledgement, reports partial success and does not repeat or continue mutations', async () => {
  const h = harness();
  h.context.localStorage.setItem = (key, value) => h.store.set(key, value);
  h.context.FormData = FormData;
  h.context.crypto = require('node:crypto').webcrypto;
  h.context.TextEncoder = TextEncoder;
  h.context.hasResearcherApiToken = () => true;
  h.context.resolveApiProjectId = async () => 7;
  h.context.folders = [];
  h.context.hydrateStimulusThumbnail = async () => { throw new Error('optional_preview_failed'); };
  let calls = 0;
  const progress = [];
  h.context.progress = (count, total) => progress.push([count, total]);
  h.context.apiGet = async () => ({ state: 'uncertain', recovery_required: true });
  h.context.apiPost = async url => {
    if (url === '/stimuli/operations') return { state: 'reserved' };
    assert.match(url, /^\/stimuli\/upload\?operation_key=/);
    if (++calls === 2) throw Object.assign(new Error('offline'), { mutationMayHaveCommitted: true });
    return { id: 55, name: 'Saved', project_id: 7, current_version_id: 'v55', mime_type: 'image/png', content_url: '/stimuli/55/content' };
  };
  h.context.files = [1, 2, 3].map(id => new File(['png'], `${id}.png`, { type: 'image/png' }));
  await assert.rejects(h.evaluate('handleFileUpload(files, progress)'), error => {
    assert.equal(error.mutationMayHaveCommitted, true);
    assert.deepEqual(Array.from(error.uploadedStimulusIds), ['55']);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(JSON.parse(h.store.get('emocog_media_operations_v1')).length, 1);
  assert.deepEqual(progress, [[0, 3], [1, 3]]);
  assert.ok(JSON.parse(h.store.get('emocog_stimuli')).some(item => item.id === '55'));
});

test('document conversion sends the original Unicode name as a UTF-8 form field', async () => {
  const h = harness();
  h.context.localStorage.setItem = (key, value) => h.store.set(key, value);
  h.context.FormData = FormData;
  h.context.crypto = require('node:crypto').webcrypto;
  h.context.TextEncoder = TextEncoder;
  h.context.hasResearcherApiToken = () => true;
  h.context.resolveApiProjectId = async () => 7;
  h.context.hydrateStimulusThumbnail = async () => {};
  h.context.file = new File(['%PDF-synthetic'], 'Проверка.pdf', { type: 'application/pdf' });
  h.context.apiPost = async (url, data) => {
    if (url === '/stimuli/operations') {
      assert.equal(data.file.name, 'Проверка.pdf');
      assert.match(data.file.sha256, /^[a-f0-9]{64}$/);
      return { state: 'reserved' };
    }
    assert.match(url, /^\/stimuli\/convert\?operation_key=/);
    assert.equal(data.get('original_name'), 'Проверка.pdf');
    return { stimuli: [{ id: 77, name: 'Проверка_page_1.jpg', project_id: 7, current_version_id: 'v77' }] };
  };
  const result = await h.evaluate('convertDocumentToStimuli(file)');
  assert.equal(result[0].name, 'Проверка_page_1.jpg');
});

test('stimulus UI cancels owned handle zero, removes global handlers and ignores captured late callbacks', () => {
  const h = harness();
  h.evaluate(`var calls = 0, cleaned = 0, ui = createStimulusUiScope();
    ui.onDispose(() => { throw new Error('synthetic teardown failure'); });
    ui.onDispose(() => { cleaned++; });
    ui.frame(() => { calls++; }); ui.timeout(() => { calls++; });`);
  assert.ok(h.frames.has(0));
  const late = [...h.frames.values(), ...h.timers.values()];
  h.evaluate('ui.dispose(); ui.dispose();');
  for (const fn of late) fn();
  assert.equal(h.evaluate('calls'), 0);
  assert.equal(h.evaluate('cleaned'), 1);
  assert.equal(h.frames.size + h.timers.size, 0);
  assert.equal(h.window.count(), h.baseline);
  assert.ok(h.observers.every(observer => !observer.active));
});

test('stimulus UI validates owner, identity, project, generation and API even before an invalidation event arrives', () => {
  for (const change of [
    h => { h.context.location.hash = '#/overview'; },
    h => { h.owner.isConnected = false; },
    h => { h.store.set('emocog_workspace_owner_v1', '2'); },
    h => { h.store.set('emocog_selected_project_id', '8'); },
    h => { h.evaluate('stimulusLibraryGeneration++;'); },
    h => { h.context.getApiBaseForResearcher = () => 'http://127.0.0.1:3001'; },
    h => { h.context.localStorage.getItem = () => { throw new Error('synthetic staff lock'); }; },
  ]) {
    const h = harness();
    h.evaluate('var calls = 0, ui = createStimulusUiScope(); ui.listen(window, "synthetic", () => { calls++; });');
    change(h);
    assert.equal(h.evaluate('ui.current()'), false);
    h.window.emit('synthetic');
    assert.equal(h.evaluate('calls'), 0);
    assert.equal(h.window.count(), h.baseline);
    assert.ok(h.observers.every(observer => !observer.active));
  }
});

test('retired thumbnail callbacks cannot hydrate new cells or disconnect their replacement observers', () => {
  const h = harness();
  const cell = { dataset: { stimulusThumbnail: '42' } };
  const container = { isConnected: true, querySelectorAll: selector => selector === '[data-stimulus-thumbnail]' ? [cell] : [] };
  h.context.container = container;
  h.evaluate('var hydrations = 0; hydrateStimulusThumbnail = () => { hydrations++; return Promise.resolve(); }; observeStimulusThumbnails(container);');
  const oldIntersection = container._thumbnailObserver, oldResize = container._shapeResizeObserver;
  h.evaluate('observeStimulusThumbnails(container);');
  const currentIntersection = container._thumbnailObserver, currentResize = container._shapeResizeObserver;
  oldIntersection.callback([{ isIntersecting: true, target: { dataset: { stimulusThumbnail: '42' } } }]);
  oldResize.callback();
  assert.equal(h.evaluate('hydrations'), 0);
  assert.equal(currentIntersection.active, true);
  assert.equal(currentResize.active, true);
  h.window.emit('pagehide');
  assert.ok(h.observers.every(observer => !observer.active));
  assert.equal(h.window.count(), h.baseline);
});

test('the library shell follows projects and API scopes but remains bound to its staff account', () => {
  const h = harness();
  h.evaluate('var ui = createStimulusUiScope(undefined, { workspaceView: true });');
  h.store.set('emocog_selected_project_id', '8');
  h.context.getApiBaseForResearcher = () => 'http://127.0.0.1:3001';
  h.evaluate('stimulusLibraryGeneration++;');
  h.window.emit('wecog:projectchange');
  assert.equal(h.evaluate('ui.current()'), true);
  h.store.set('emocog_workspace_owner_v1', '2');
  h.window.emit('wecog:stimulisynced');
  assert.equal(h.evaluate('ui.current()'), false);
  assert.equal(h.window.count(), h.baseline);
  assert.ok(h.observers.every(observer => !observer.active));
});

test('late first authentication replaces the anonymous shell without reviving its controls', () => {
  const h = harness();
  h.store.delete('emocog_workspace_owner_v1');
  const old = h.owner._stimulusLibraryUiScope = h.evaluate('createStimulusUiScope(undefined, { workspaceView: true })');
  let renders = 0;
  h.context.render = () => {
    renders++;
    h.owner._stimulusLibraryUiScope = h.evaluate('createStimulusUiScope(undefined, { workspaceView: true })');
  };
  h.store.set('emocog_workspace_owner_v1', '1');
  h.window.emit('wecog:researcherauthenticated');
  assert.equal(renders, 1);
  assert.equal(old.current(), false);
  assert.equal(h.owner._stimulusLibraryUiScope.current(), true);
  h.window.emit('wecog:researcherauthenticated');
  assert.equal(renders, 1, 'repeated authentication must preserve a current shell');
  h.owner._stimulusLibraryUiScope.dispose();
  assert.equal(h.window.count(), h.baseline);
});

test('authentication cannot remount an old shell on another route or a locked staff tab', () => {
  for (const boundary of ['route', 'staff-lock']) {
    const h = harness();
    const old = h.owner._stimulusLibraryUiScope = h.evaluate('createStimulusUiScope(undefined, { workspaceView: true })');
    let renders = 0;
    h.context.render = () => { renders++; };
    h.store.set('emocog_workspace_owner_v1', '2');
    if (boundary === 'route') h.context.location.hash = '#/overview';
    else h.window.WecogStaffSession = { assertCurrent() { throw new Error('synthetic account lock'); } };
    h.window.emit('wecog:researcherauthenticated');
    assert.equal(renders, 0);
    assert.equal(old.current(), false);
    assert.equal(h.window.count(), h.baseline);
  }
});

test('failed decoder teardown still clears every source and releases the remaining media', () => {
  const h = harness(), released = [];
  h.context.mediaContainer = { querySelectorAll: () => [1, 2].map(id => ({
    pause() { throw new Error('synthetic pause error'); },
    removeAttribute(key) { released.push([id, key]); },
    load() { throw new Error('synthetic load error'); }
  })) };
  h.evaluate('stopStimulusUiMedia(mediaContainer);');
  assert.deepEqual(released, [[1, 'src'], [2, 'src']]);
});
