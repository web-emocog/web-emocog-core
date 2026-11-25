const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('#186 publish legacy static PNG, enable valid time/new physiology and revert methods without losing publication', {
  skip: !process.env.S2_TEST_DATABASE_URL,
}, async t => {
  const db = new URL(process.env.S2_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname)); assert.match(db.pathname, /_test$/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-186-publication-'));
  Object.assign(process.env, { DATABASE_URL: db.href, UPLOADS_ROOT: root, NODE_ENV: 'test', FORCE_HTTPS: 'false' });
  const { pool } = require('../db'), config = require('../config');
  const jwt = require('jsonwebtoken');
  let org, user, server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (org) await pool.query('DELETE FROM organizations WHERE id=$1', [org]);
    if (user) await pool.query('DELETE FROM users WHERE id=$1', [user]);
    await pool.end(); await fs.rm(root, { recursive: true, force: true });
  });
  org = (await pool.query('INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id', ['Synthetic186', randomUUID()])).rows[0].id;
  const project = (await pool.query('INSERT INTO projects(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id', [org, 'Synthetic186', randomUUID()])).rows[0].id;
  user = (await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,'not-a-login','researcher') RETURNING id", [randomUUID()+'@example.test'])).rows[0].id;
  await pool.query('INSERT INTO user_organizations(user_id,organization_id) VALUES($1,$2)', [user, org]);
  await pool.query('INSERT INTO user_projects(user_id,project_id) VALUES($1,$2)', [user, project]);
  const token = jwt.sign({ sub: user, role: 'researcher', ver: 0 }, config.jwt.secret,
    { algorithm: 'HS256', issuer: config.jwt.staffIssuer, audience: config.jwt.staffAudience, expiresIn: '10m' });
  await fs.mkdir(path.join(root, 'stimuli'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(path.join(root, 'stimuli', 'synthetic.png'), png);
  const stimulus = (await pool.query(`INSERT INTO stimuli(project_id,name,mime_type,metadata,created_by,visibility)
    VALUES($1,'Static PNG','image/png',$2::jsonb,$3,'private') RETURNING id`,
    [project, JSON.stringify({ content_path: 'synthetic.png' }), user])).rows[0].id;
  server = require('../app').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method, body, status) {
    const res = await fetch(base+route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body) }); const result = await res.json(); assert.equal(res.status, status, JSON.stringify(result)); return result;
  }
  const definition = { version: 'v2.0', blocks: [{ id: 'passive', type: 'passive',
    content: { useRT: false, responseMode: 'none', slideDuration: 2000 }, trials: [{ stimulusId: stimulus, duration: 2000 }] }] };
  definition.blocks[0].content.validTime = { schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio: .5, minSegmentMs: 1000 };
  definition.settings = { physiologyMethods: { heartRate: 'auto', respiration: 'motion' } };
  // No prior version/decoder metadata: publication must pin/decode before static eligibility is checked.
  const protocol = await request('/protocols', 'POST', { project_id: project, name: randomUUID(), definition }, 201);
  assert.equal(protocol.preflight.ok, true);
  assert.equal(protocol.definition.mediaManifest[stimulus].media_info.codec, 'png');
  const quality = require('../../shared/protocol-quality');
  assert.equal(quality.validate(protocol.definition), true, 'publication and participant QC must agree about static eligibility');
  const first = await request('/invitations', 'POST', { protocol_id: protocol.id }, 201);
  const saved = structuredClone(protocol.definition);
  definition.settings.physiologyMethods = { heartRate: 'pos', respiration: 'luma' };
  const updated = await request('/protocols/'+protocol.id, 'PATCH', { definition }, 200);
  assert.equal(updated.preflight.ok, true);
  assert.deepEqual(updated.definition.settings.physiologyMethods, definition.settings.physiologyMethods);
  const immutable = (await pool.query('SELECT protocol_definition FROM invitations WHERE id=$1', [first.id])).rows[0].protocol_definition;
  assert.deepEqual(immutable.settings.physiologyMethods, saved.settings.physiologyMethods);
  const invalid = structuredClone(definition);
  invalid.blocks[0].content.slideChangeMode = 'manual';
  const rejected = await request('/protocols/'+protocol.id, 'PATCH', { definition: invalid }, 422);
  assert.equal(rejected.code, 'protocol_quality_invalid');
  const tooShort = structuredClone(definition);
  tooShort.blocks[0].trials[0].duration = 999;
  const preflight = await request('/protocols/'+protocol.id, 'PATCH', { definition: tooShort }, 422);
  assert.equal(preflight.code, 'protocol_preflight_failed');
  assert.ok(preflight.preflight.errors.some(item => item.code === 'passive_valid_time_duration'));
  const stillSaved = (await pool.query('SELECT definition FROM protocols WHERE id=$1', [protocol.id])).rows[0].definition;
  assert.deepEqual(stillSaved, updated.definition, 'rejected publication must preserve the saved definition');
});
