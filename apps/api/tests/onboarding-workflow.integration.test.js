const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('canonical API: captured signup mail, workspace isolation, media recovery and publication', {
  skip: !process.env.IDENTITY_TEST_DATABASE_URL,
}, async t => {
  const db = new URL(process.env.IDENTITY_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname));
  assert.match(db.pathname, /_test$/);
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'wecog-onboarding-http-'));
  const capture = path.join(root, 'mail');
  const stamp = randomUUID().slice(0, 10);
  const emails = ['owner', 'member'].map(name => `${name}-${stamp}@example.test`);
  Object.assign(process.env, {
    DATABASE_URL: db.href, UPLOADS_ROOT: path.join(root, 'uploads'), FORCE_HTTPS: 'false', NODE_ENV: 'test',
    RATE_LIMIT_STORE: 'postgres', MEDIA_MIN_FREE_BYTES: '1', AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    IDENTITY_ENABLED: 'true', IDENTITY_MAIL_MODE: 'local', IDENTITY_PUBLIC_URL: 'http://127.0.0.1:3000/apps/web/',
    IDENTITY_TRUSTED_ORIGINS: 'http://127.0.0.1:3000', IDENTITY_MAIL_FROM: 'wecog@local.test',
    IDENTITY_LOCAL_CAPTURE_DIR: capture, IDENTITY_OUTBOX_KEY: randomBytes(32).toString('base64'),
  });
  const { pool } = require('../db');
  const { startServer } = require('../server');
  const instance = startServer({ port: 0, host: '127.0.0.1' });
  let organization;
  t.after(async () => {
    try {
      if (organization) await pool.query('DELETE FROM organizations WHERE id=$1', [organization]);
      await pool.query('DELETE FROM identity_challenges WHERE email=ANY($1::text[])', [emails]);
      await pool.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails]);
    } finally {
      instance.removeProcessHandlers();
      await instance.shutdown('test');
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  if (!instance.server.listening) await new Promise((resolve, reject) => {
    instance.server.once('listening', resolve); instance.server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + instance.server.address().port;
  async function call(route, status, body, token) {
    const form = body instanceof FormData;
    const headers = { ...(token ? { Authorization: 'Bearer ' + token } : {}) };
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + route, { headers, method: body === undefined ? 'GET' : 'POST',
      body: body === undefined || form ? body : JSON.stringify(body) });
    assert.equal(response.status, status, route.split('?')[0]);
    return response.json();
  }
  async function delivered(email, subject) {
    for (let i = 0; i < 80; i++) {
      for (const name of await fs.readdir(capture).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      })) {
        const message = JSON.parse(await fs.readFile(path.join(capture, name), 'utf8'));
        if (!message.to.some(entry => entry.address === email) || message.subject !== subject) continue;
        const link = new URL(message.text.match(/http[^\s]+/)[0]);
        return new URLSearchParams(link.hash.slice(1)).get('token');
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('Expected captured email was not delivered');
  }
  const password = 'Synthetic-password-2026';
  async function register(email) {
    await call('/identity/signup', 202, { email });
    const token = await delivered(email, 'Confirm your wecog account');
    await call('/identity/confirm', 200, { token, password });
    return (await call('/auth/login', 200, { email, password })).token;
  }
  const owner = await register(emails[0]), member = await register(emails[1]);
  const created = await call('/workspace/organizations', 201, { organization_name: 'HTTP test', project_name: 'Private' }, owner);
  organization = created.organization.id;
  const project = created.project.id;
  assert.deepEqual(await call('/projects', 200, undefined, member), []);
  await call(`/workspace/organizations/${organization}/invitations`, 202, { email: emails[1], project_id: project }, owner);
  await call('/workspace/invitations/accept', 200, { token: await delivered(emails[1], 'Your wecog project invitation') }, member);
  await call('/projects', 403, { organization_id: organization, name: 'Denied', slug: 'denied' }, member);
  const extra = await call('/projects', 201, { organization_id: organization, name: 'Owner only', slug: 'owner-only' }, owner);
  assert.deepEqual((await call('/projects', 200, undefined, member)).map(row => row.id), [project]);
  const ownership = await pool.query('SELECT role FROM user_projects WHERE project_id=$1', [extra.id]);
  assert.equal(ownership.rows[0].role, 'owner');

  const file = Buffer.from('%PDF-1.4\nsynthetic admission fixture');
  const key = randomUUID();
  await call('/stimuli/operations', 201, { key, kind: 'upload', project_id: project,
    file: { name: 'fixture.pdf', type: 'application/pdf', size: file.length, sha256: createHash('sha256').update(file).digest('hex') } }, owner);
  const body = new FormData();
  body.append('file', new Blob([file], { type: 'application/pdf' }), 'fixture.pdf');
  const uploaded = await call('/stimuli/upload?operation_key=' + key, 201, body, owner);
  assert.equal((await call(`/stimuli/operations/${key}?project_id=${project}`, 200, undefined, owner)).result.id, uploaded.id);
  await call(`/stimuli/operations/${key}?project_id=${project}`, 404, undefined, member);
  assert.deepEqual(await call('/stimuli?project_id=' + project, 200, undefined, member), []);

  const protocol = await call('/protocols', 201, { project_id: project, name: 'Published with standard media',
    definition: { version: 'v2', blocks: [{ id: 'main', type: 'cognitive_task', taskType: 'simple_rt',
      trials: [{ id: 'trial', stimulusId: 'std_simple_black_square' }] }] } }, owner);
  const invitation = await call('/invitations', 201, { protocol_id: protocol.id }, owner);
  assert.equal((await call('/invitations/by-code/' + invitation.code, 200)).protocol_id, protocol.id);
  await call('/operations/metrics', 403, undefined, owner);
});
