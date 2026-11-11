const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function production(overrides = {}) {
  const context = vm.createContext({
    URL, URLSearchParams, Blob, setTimeout, clearTimeout,
    localStorage: { getItem: () => null },
    location: { href: 'http://127.0.0.1:4215/apps/web/researcher.html', search: '' },
    addEventListener() {}, ...overrides,
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../web/researcher-analytics-production.js'), 'utf8'), context);
  return context.EmocogAnalyticsProduction;
}

test('analytics identifiers cannot normalize into a parent route; query values stay encoded', async () => {
  const paths = [];
  const snapshot = { id: 'snap&format=html#fragment' };
  const app = production({ apiGet: async path => {
    paths.push(path);
    const kind = path.includes('/comparisons/') ? 'model_result' : path.includes('/summary?') ? 'session_summary'
      : path.includes('/aoi?') ? 'session_aoi' : path.includes('/visuals?') ? 'session_visuals' : 'heatmap';
    return { kind, snapshot, data: {} };
  } });
  for (const method of ['sessionSummary', 'sessionAoi', 'sessionHeatmap', 'sessionVisuals', 'comparison']) {
    for (const id of ['', '.', '..', null]) await assert.rejects(app.api[method](id, snapshot), /invalid analytics identifier/);
  }
  assert.equal(paths.length, 0);
  await app.api.sessionSummary('11/a?b#c', snapshot);
  await app.api.comparison('comparison/a?b#c', snapshot);
  for (const request of paths) {
    const url = new URL(request, 'http://localhost');
    assert.equal(url.searchParams.get('snapshot_id'), snapshot.id);
    assert.equal(url.hash, '');
    assert.match(url.pathname, /%2Fa%3Fb%23c/);
  }
});

test('export uses fixed endpoint, authenticated headers, workspace ownership and redirect denial', async () => {
  let seen;
  const snapshot = { id: 'snapshot&content=unexpected', datasetHash: 'sha256:audit', queryEcho: { protocolVersion: '1' } };
  const app = production({ API_BASE: 'http://localhost:3000/api/',
    apiRequestHeaders: json => { assert.equal(json, false); return { 'X-CSRF-Token': 'synthetic', 'X-Staff-User-ID': '1' }; },
    WecogHttp: { request: async (url, init, reader, options) => {
      seen = { url, init, options };
      return reader({ ok: true, headers: new Map([['X-Analysis-Snapshot-Id', snapshot.id], ['X-Dataset-Hash', snapshot.datasetHash]]),
        blob: async () => new Blob(['synthetic']) });
    } },
  });
  const state = { snapshot, dirty: false, protocols: [], query: {} };
  const result = await app.api.exportSnapshot(state, 'json', 'summary');
  const url = new URL(seen.url);
  assert.equal(url.pathname, '/api/analytics/v1/exports');
  assert.equal(url.searchParams.get('snapshot_id'), snapshot.id);
  assert.equal(url.searchParams.get('content'), 'summary');
  assert.equal(seen.init.credentials, 'include');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.headers['X-CSRF-Token'], 'synthetic');
  assert.equal(seen.init.headers['X-Staff-User-ID'], '1');
  assert.equal(seen.options.scope, 'workspace');
  assert.equal(seen.options.transfer, true);
  assert.equal(await result.blob.text(), 'synthetic');
});

test('export rejects stale snapshots, unconfirmed hashes and non-success responses before reading bytes', async () => {
  let reads = 0, mode = 'snapshot';
  const snapshot = { id: 'audit', datasetHash: 'sha256:audit' };
  const app = production({ WecogHttp: { request: async (_url, _init, reader) => reader({
    ok: mode !== 'status', status: 403, statusText: 'Forbidden',
    headers: new Map([['X-Analysis-Snapshot-Id', mode === 'snapshot' ? 'wrong' : snapshot.id],
      ['X-Dataset-Hash', mode === 'hash' ? 'wrong' : snapshot.datasetHash]]),
    blob: async () => { reads++; return new Blob(); },
  }) } });
  const state = { snapshot, dirty: false };
  for (mode of ['snapshot', 'hash', 'status']) await assert.rejects(app.api.exportSnapshot(state, 'json', 'summary'));
  await assert.rejects(app.api.exportSnapshot({ ...state, dirty: true }, 'json', 'summary'));
  assert.equal(reads, 0);
});

test('snapshot creation remains the canonical POST and does not turn query data into a path', async () => {
  let seen;
  const app = production({ apiPost: async (path, body) => { seen = { path, body }; return { id: 'snapshot' }; } });
  const query = { projectId: '../foreign', protocolId: '<literal>', filters: { sessionIds: ['../../'] } };
  await app.api.createSnapshot(query);
  assert.equal(seen.path, '/analytics/v1/snapshots');
  assert.equal(seen.body, query);
});
