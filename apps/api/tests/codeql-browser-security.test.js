const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('analytics override IDs cannot mutate the dictionary prototype and malformed entries are ignored', () => {
  const context = vm.createContext({});
  vm.runInContext(read('apps/web/researcher-analytics-config.js'), context);
  const result = vm.runInContext(`(() => {
    const blocks = ['__proto__', 'constructor', 'normal', 'null', 'array'].map(id => ({ id, type: 'cognitive_task' }));
    const raw = JSON.parse('{"blockOverrides":{"__proto__":{"packages":["data_quality"]},"constructor":{"packages":["data_quality"]},"normal":{"packages":["task_performance"]},"null":null,"array":[]}}');
    const plan = EmocogAnalyticsPlan.normalizePlan(raw, blocks);
    return { prototypeIntact: Object.getPrototypeOf(plan.blockOverrides) === Object.prototype,
      ownSpecial: Object.hasOwn(plan.blockOverrides, '__proto__'),
      ownConstructor: Object.hasOwn(plan.blockOverrides, 'constructor'),
      validNormal: plan.blockOverrides.normal.packages.includes('task_performance'),
      malformedIgnored: !Object.hasOwn(plan.blockOverrides, 'null') && !Object.hasOwn(plan.blockOverrides, 'array'),
      roundTrip: Object.hasOwn(JSON.parse(JSON.stringify(plan)).blockOverrides, '__proto__') };
  })()`, context);
  assert.ok(Object.values(result).every(value => value === true));
});

test('legacy random IDs use cryptographic randomness and fail closed when unavailable', () => {
  const source = read('apps/participant-web/js/web-page/ui.js');
  assert.doesNotMatch(source, /Math\.random/);
  const fn = source.match(/export function generateUniqueId\(\) \{[\s\S]*?\n\}/)[0].replace('export ', '');
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
  const generate = vm.runInNewContext(`${fn}; generateUniqueId`, { crypto: { getRandomValues: target => target.set(bytes) } });
  assert.match(generate(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const unavailable = vm.runInNewContext(`${fn}; generateUniqueId`, {});
  assert.throws(unavailable, /Secure random/);
});

test('legacy imported protocol, stimulus and filename sinks are escaped without interpolated JavaScript', () => {
  const source = read('apps/researcher-web/app_shell.html');
  for (const expression of ['s.id', 's.name', 's.info', 's.url', 'f.id', 'block.label',
    'b.id', 'b.type', 'trial.condition || \'\'', 'trial.correctResponse || \'\'',
    'trial.duration || 1000', 'trial.repetitions || 1', 'file.name', 'stimulus.name', 'stimulus.url']) {
    assert.equal(source.includes('${' + expression + '}'), false, expression);
    assert.ok(source.includes('${escapeLegacyResearcherHtml(' + expression + ')}'), expression);
  }
  assert.doesNotMatch(source, /onclick="[^"]*deleteStimulusFromLibrary/);
  assert.match(source, /row\.textContent = `[^`]*\$\{f\.name\}/);
});

test('offline design prototype routes never call inherited Object methods', () => {
  const source = read('docs/design/sprint-1/prototype/app.js');
  const render = source.match(/function render\(\) \{[\s\S]*?\n\}/)[0];
  for (const route of ['__proto__', 'constructor', 'toString', '/participant/invite', '/known']) {
    const app = {};
    const context = { app, normalizeRoute: () => route,
      participantViews: { '/participant/invite': () => 'participant' },
      views: { '/overview': () => 'overview', '/known': () => 'known' }, routeMeta: {},
      shell: (html, key) => `${html}:${key}`, requestAnimationFrame: () => {},
      document: { body: { classList: { remove() {} } } } };
    vm.runInNewContext(`${render}; render()`, context);
    assert.equal(app.innerHTML, route === '/participant/invite' ? 'participant'
      : route === '/known' ? 'known:/known' : 'overview:/overview');
  }
});
