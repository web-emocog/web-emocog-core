// Manual acceptance test. Run only against a disposable loopback API/database.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Pool } = require('pg');
const config = require('../config');

function requireIsolatedTarget(env, settings) {
  const database = new URL(env.DATABASE_URL);
  const api = new URL(env.MEDIA_LOAD_TEST_URL || 'http://127.0.0.1:3000');
  assert.equal(env.MEDIA_LOAD_TEST_ISOLATED, 'YES', 'Explicit disposable-fixture acknowledgement is required');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.DATABASE_URL, env.MEDIA_TEST_DATABASE_URL);
  assert.ok(database.pathname.endsWith('_test'), 'Use a dedicated test database');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname));
  assert.equal(api.protocol, 'http:');
  assert.equal(api.hostname, '127.0.0.1');
  assert.equal(api.pathname, '/');
  assert.ok(!api.username && !api.password && !api.search && !api.hash);
  assert.equal(settings.http.rateLimitStore, 'postgres');
  assert.deepEqual(settings.http.rateLimits, { auth: 20, ingest: 60, media: 1200, default: 600 });
  assert.ok(env.LIVE_STIMULUS_FIXTURE && env.MEDIA_LOAD_TEST_IMAGE && env.MEDIA_LOAD_TEST_REPORT);
  return api.origin;
}

async function parallel(count, concurrency, work) {
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count && !failure) {
      try { await work(next++); } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(2));
}

async function main() {
  const base = requireIsolatedTarget(process.env, config);
  const fixture = JSON.parse(await fs.readFile(process.env.LIVE_STIMULUS_FIXTURE, 'utf8'));
  assert.match(fixture.users.owner.email, /^owner-[\da-f-]+@example\.test$/);
  const image = await fs.readFile(process.env.MEDIA_LOAD_TEST_IMAGE);
  const sha = createHash('sha256').update(image).digest('hex');
  const pool = new Pool({ connectionString: config.database.url, max: 4 });
  const report = { libraryFiles: 600, actualUploads: 24, seededFiles: 576, concurrency: 8,
    fileBytes: image.length, normal: { requests: 0, bytes: 0, statuses: {}, timingsMs: [] },
    media: { requests: 0, bytes: 0, timingsMs: [] }, guards: {} };
  const started = performance.now();
  const normal = async (route, options = {}, expected = 200) => {
    const start = performance.now();
    const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(30_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    report.normal.requests++;
    report.normal.bytes += bytes.length;
    report.normal.statuses[response.status] = (report.normal.statuses[response.status] || 0) + 1;
    const duration = performance.now() - start;
    report.normal.timingsMs.push(duration);
    if (/\/(?:content|preview)(?:\?|$)/.test(route)) {
      report.media.requests++;
      report.media.bytes += bytes.length;
      report.media.timingsMs.push(duration);
    }
    assert.equal(response.status, expected, `${options.method || 'GET'} ${route.split('?')[0]}: ${response.status}`);
    return { response, bytes, json: () => JSON.parse(bytes.toString('utf8')) };
  };
  try {
    const login = await normal('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: fixture.users.owner.email, password: fixture.users.owner.password }) });
    const headers = { Authorization: `Bearer ${login.json().token}` };
    const jsonHeaders = { ...headers, 'content-type': 'application/json' };
    const ids = [];
    await parallel(24, 2, async index => {
      const key = randomUUID();
      const descriptor = { key, kind: 'upload', project_id: fixture.projectId, name: `Load ${index}`,
        file: { name: 'synthetic.png', type: 'image/png', size: image.length, sha256: sha } };
      await normal('/stimuli/operations', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(descriptor) }, 201);
      const body = new FormData();
      body.set('project_id', String(fixture.projectId));
      body.set('name', descriptor.name);
      body.set('file', new Blob([image], { type: 'image/png' }), 'synthetic.png');
      const uploaded = await normal(`/stimuli/upload?operation_key=${key}`, { method: 'POST', headers, body }, 201);
      ids.push(uploaded.json().id);
    });
    const template = (await pool.query(`SELECT s.*, v.preview_path, v.media_info,
      p.organization_id FROM stimuli s JOIN stimulus_versions v ON v.id=s.current_version_id
      JOIN projects p ON p.id=s.project_id WHERE s.id=$1`, [ids[0]])).rows[0];
    assert.equal(template.media_info.validated_sha256, sha);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let index = 24; index < 600; index++) {
        const relative = `load-${randomUUID()}.png`;
        await fs.writeFile(path.join(config.storage.uploadsRoot, 'stimuli', relative), image, { flag: 'wx' });
        const item = (await client.query(`INSERT INTO stimuli(project_id,name,mime_type,size_bytes,metadata,created_by,visibility)
          VALUES($1,$2,'image/png',$3,$4,$5,'private') RETURNING id`,
        [fixture.projectId, `Seeded ${index}`, image.length, JSON.stringify({ content_path: relative }), fixture.users.owner.id])).rows[0];
        const version = randomUUID();
        await client.query(`INSERT INTO stimulus_versions(id,stimulus_id,content_path,mime_type,size_bytes,sha256,preview_path,media_info,preview_status)
          VALUES($1,$2,$3,'image/png',$4,$5,$6,$7,'ready')`,
        [version, item.id, relative, image.length, sha, template.preview_path, template.media_info]);
        await client.query('UPDATE stimuli SET current_version_id=$1 WHERE id=$2', [version, item.id]);
        await client.query('INSERT INTO media_storage_objects(organization_id,content_path,size_bytes) VALUES($1,$2,$3)',
          [template.organization_id, relative, image.length]);
        ids.push(item.id);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    const definition = { version: 'v2.0_universal', blocks: Array.from({ length: 5 }, (_, index) => ({
      id: `load-${index}`, type: 'cognitive_task', taskType: 'simple_rt',
      blockConfig: { useAOI: false, useFixation: false, stimulusDuration: 1000 },
      trials: ids.slice(index * 120, (index + 1) * 120).map(id => ({ stimulusId: String(id), duration: 1000, action: 'Space' })),
    })) };
    const saved = await normal('/protocols', { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ project_id: fixture.projectId, name: 'Synthetic 600-image load test', definition }) }, 201);
    const protocol = saved.json();
    const published = await normal('/invitations', { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ protocol_id: protocol.id }) }, 201);
    const invitation = published.json();
    await normal(`/invitations/by-code/${invitation.code}`);
    const library = (await normal(`/stimuli?project_id=${fixture.projectId}`, { headers })).json();
    assert.equal(library.length, 600);
    let last;
    const burstStart = performance.now();
    await parallel(900, 8, async index => {
      const stimulus = library[index % library.length];
      const preview = index >= 600;
      const result = await normal(preview ? `/stimuli/${stimulus.id}/preview` : stimulus.content_url, { headers });
      if (!preview) assert.equal(createHash('sha256').update(result.bytes).digest('hex'), sha);
      else assert.match(result.response.headers.get('content-type'), /^image\//);
      last = result.response;
      if (index % 15 === 0) await normal(`/protocols/${protocol.id}`, { method: 'PATCH', headers: jsonHeaders,
        body: JSON.stringify({ name: 'Synthetic 600-image load test' }) });
    });
    await parallel(120, 4, async index => {
      const result = await normal(`/invitations/by-code/${invitation.code}/stimuli/${ids[index]}/content`);
      assert.equal(createHash('sha256').update(result.bytes).digest('hex'), sha);
      last = result.response;
    });
    report.media.durationSeconds = Number(((performance.now() - burstStart) / 1000).toFixed(2));
    assert.ok(report.media.durationSeconds < 60, 'The read burst must fit in one limiter window');
    assert.equal(last.headers.get('ratelimit-limit'), '1200');
    const guardStart = performance.now();
    let passed = 0, rejected;
    // Probe the remaining real PostgreSQL-backed budget, not a mocked middleware.
    while (passed <= 1200) {
      const response = await fetch(`${base}/stimuli/${ids[0]}/content`, { headers, signal: AbortSignal.timeout(10_000) });
      const bytes = await response.arrayBuffer();
      if (response.status === 429) {
        assert.equal(JSON.parse(Buffer.from(bytes).toString('utf8')).route_profile, 'media');
        rejected = response; break;
      }
      assert.equal(response.status, 200);
      passed++;
    }
    assert.ok(rejected, 'The media guard must remain finite');
    assert.equal(report.media.requests + passed, 1200, 'Normal and probe reads must share one rate window');
    assert.ok(Number(rejected.headers.get('retry-after')) > 0);
    report.guards.media = { status: rejected.status, acceptedProbeRequests: passed,
      retryAfterSeconds: Number(rejected.headers.get('retry-after')), durationMs: Math.round(performance.now() - guardStart) };
    await normal(`/protocols/${protocol.id}`, { method: 'PATCH', headers: jsonHeaders,
      body: JSON.stringify({ name: 'Still editable after media budget exhaustion', definition }) });
    report.guards.saveAfterMedia429 = 200;
    passed = 0;
    rejected = null;
    while (passed <= 600) {
      const response = await fetch(`${base}/projects`, { headers, signal: AbortSignal.timeout(10_000) });
      const bytes = await response.arrayBuffer();
      if (response.status === 429) {
        assert.equal(JSON.parse(Buffer.from(bytes).toString('utf8')).route_profile, 'default');
        rejected = response; break;
      }
      assert.equal(response.status, 200);
      passed++;
    }
    assert.ok(rejected, 'The general action guard must remain finite');
    assert.equal(rejected.headers.get('ratelimit-limit'), '600');
    report.guards.actions = { status: rejected.status, acceptedProbeRequests: passed,
      retryAfterSeconds: Number(rejected.headers.get('retry-after')) };
    assert.ok(report.guards.actions.retryAfterSeconds > 0);
    report.durationSeconds = Number(((performance.now() - started) / 1000).toFixed(2));
    for (const values of [report.normal, report.media]) {
      values.p50Ms = percentile(values.timingsMs, 0.5);
      values.p95Ms = percentile(values.timingsMs, 0.95);
      values.maxMs = Math.round(Math.max(...values.timingsMs));
      delete values.timingsMs;
    }
    await fs.writeFile(process.env.MEDIA_LOAD_TEST_REPORT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`Stimulus load test failed: ${error.message}\n`);
  process.exitCode = 1;
});
module.exports = { requireIsolatedTarget, percentile };
