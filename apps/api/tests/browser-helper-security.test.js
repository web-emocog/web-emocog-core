const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const helperSource = fs.readFileSync(path.join(root, 'apps/autotests/scripts/run-live-suite.cjs'), 'utf8');
const email = 'admin-11111111-2222-3333-4444-555555555555@example.test';
const password = 'SyntheticBrowserOnly2026!';

async function runSyntheticHelper(env, fixtureEmail = email) {
  const requests = [], children = [];
  const processStub = { env: { LIVE_STIMULUS_FIXTURE: '/synthetic-fixture.json', ...env },
    execPath: '/synthetic-node', argv: ['node', 'run-live-suite.cjs'], stderr: { write() {} } };
  const requireStub = name => {
    if (name === 'node:fs') return { readFileSync: () => JSON.stringify({ users: {
      admin: { email: fixtureEmail, password: 'FILE_PASSWORD_MUST_NOT_BE_SENT' },
      owner: { email: 'owner@example.test', password },
    }, projectId: 1 }) };
    if (name === 'node:child_process') return { spawnSync: (...args) => { children.push(args); return { status: 0 }; } };
    throw new Error('Unexpected module');
  };
  requireStub.resolve = () => '/synthetic-playwright-cli';
  vm.runInNewContext(helperSource, {
    require: requireStub, process: processStub,
    fetch: async (...args) => { requests.push(args); return { ok: true, json: async () => ({ token: 'synthetic-token' }) }; },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { requests, children, exitCode: processStub.exitCode };
}

describe('browser helper and legacy HTML security', () => {
  it('does not authenticate from a file without explicit matching synthetic credentials', async () => {
    for (const env of [{}, { EMOCOG_ADMIN_EMAIL: email },
      { EMOCOG_ADMIN_EMAIL: 'real@example.org', EMOCOG_ADMIN_PASSWORD: password },
      { EMOCOG_ADMIN_EMAIL: email, EMOCOG_ADMIN_PASSWORD: 'real-password' }]) {
      const result = await runSyntheticHelper(env);
      assert.equal(result.exitCode, 1);
      assert.equal(result.requests.length, 0);
      assert.equal(result.children.length, 0);
    }
  });

  it('rejects production and a fixture belonging to another synthetic administrator', async () => {
    const env = { EMOCOG_ADMIN_EMAIL: email, EMOCOG_ADMIN_PASSWORD: password };
    for (const result of [await runSyntheticHelper({ ...env, NODE_ENV: 'production' }),
      await runSyntheticHelper(env, 'admin-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@example.test')]) {
      assert.equal(result.exitCode, 1);
      assert.equal(result.requests.length, 0);
    }
  });

  it('sends only explicitly supplied synthetic login data to loopback and refuses redirects', async () => {
    const result = await runSyntheticHelper({ EMOCOG_ADMIN_EMAIL: email, EMOCOG_ADMIN_PASSWORD: password });
    assert.equal(result.exitCode, 0);
    assert.equal(result.requests.length, 1);
    const [url, options] = result.requests[0];
    assert.equal(url, 'http://127.0.0.1:3000/auth/login');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { email, password });
    assert.equal(result.children.length, 1);
  });

  it('escapes markup, attribute delimiters and ampersands in both researcher builders', () => {
    for (const [file, name] of [['apps/web/researcher-builder.js', 'escapeBuilderHtml'],
      ['apps/researcher-web/app_shell.html', 'escapeLegacyResearcherHtml']]) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const declaration = source.match(new RegExp(`function ${name}\\(value\\) \\{[\\s\\S]*?\\n\\}`));
      assert.ok(declaration);
      const escape = vm.runInNewContext(`${declaration[0]}; ${name}`);
      assert.equal(escape(`<img src=x onerror="alert('x')">&`),
        '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
      assert.equal(escape(null), '');
    }
  });

  it('escapes persisted experiment names, IDs, versions and translated step names at HTML sinks', () => {
    const legacy = fs.readFileSync(path.join(root, 'apps/researcher-web/app_shell.html'), 'utf8');
    assert.doesNotMatch(legacy, /data-id="\$\{exp\.id\}"/);
    assert.match(legacy, /escapeLegacyResearcherHtml\(exp\.title \|\|/);
    assert.match(legacy, /escapeLegacyResearcherHtml\(protocolVersion\)/);
    assert.match(legacy, /escapeLegacyResearcherHtml\(editingExp \? editingExp\.title : ''\)/);
    assert.match(legacy, /escapeLegacyResearcherHtml\(s\)/);
    const builder = fs.readFileSync(path.join(root, 'apps/web/researcher-builder.js'), 'utf8');
    assert.match(builder, /escapeBuilderHtml\(s\)/);
    assert.match(builder, /escapeBuilderHtml\(editingExp \? editingExp\.title : ''\)/);
  });
});
