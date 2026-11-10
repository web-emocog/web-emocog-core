const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Never defaults to DATABASE_URL/S2_TEST_DATABASE_URL or creates/migrates a DB.
// The integration runner must explicitly supply an already migrated, disposable DB.
describe('Media admission, retained storage and durable operations', {
  skip: process.env.MEDIA_TEST_ISOLATED !== '1' || !process.env.MEDIA_TEST_DATABASE_URL,
  concurrency: false,
}, () => {
  let pool, config, server, base, root, reconcile, operations;
  const fixtures = [];
  const savedEnv = {};
  const envNames = ['DATABASE_URL','UPLOADS_ROOT','MEDIA_MIN_FREE_BYTES','MEDIA_ORGANIZATION_QUOTA_BYTES','MEDIA_MAX_USER_UPLOADS'];
  const pdf = Buffer.from('%PDF-1.4\nmedia fixture');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  async function request(fixture, route, method = 'GET', body, actor = 0) {
    const form = body instanceof FormData;
    return fetch(base+route, { method, headers: { authorization: `Bearer ${fixture.tokens[actor]}`,
      ...(form ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
  }
  async function fixture() {
    const organizationId = (await pool.query('INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id', ['Media integration',crypto.randomUUID()])).rows[0].id;
    const projectId = (await pool.query('INSERT INTO projects(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id', [organizationId,'Media integration',crypto.randomUUID()])).rows[0].id;
    const f = { organizationId, projectId, users: [], tokens: [] };
    fixtures.push(f);
    const jwt = require('jsonwebtoken');
    for (let index=0; index<3; index++) {
      const user = (await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING *',
        [`${crypto.randomUUID()}@test.invalid`,'not-a-login-password','researcher'])).rows[0];
      f.users.push(user.id);
      await pool.query('INSERT INTO user_organizations(user_id,organization_id) VALUES($1,$2)', [user.id,organizationId]);
      if (index<2) await pool.query('INSERT INTO user_projects(user_id,project_id) VALUES($1,$2)', [user.id,projectId]);
      f.tokens.push(jwt.sign({ sub: user.id, email: user.email, role: user.role, ver: 0 }, config.jwt.secret,
        { issuer: config.jwt.staffIssuer, audience: config.jwt.staffAudience, expiresIn: '1h', algorithm: 'HS256' }));
    }
    return f;
  }
  function descriptor(f, bytes = pdf, extra = {}) {
    return { key: crypto.randomUUID(), kind: 'upload', project_id: f.projectId,
      file: { name: 'fixture.pdf', size: bytes.length, type: 'application/pdf', sha256: hash(bytes) }, ...extra };
  }
  async function admit(f, d, actor = 0) {
    const response = await request(f, '/stimuli/operations', 'POST', d, actor);
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }
  async function upload(f, d, bytes = pdf, actor = 0) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: d.file.type }), d.file.name);
    const route = d.kind === 'replace' ? `/stimuli/${d.stimulus_id}/content` : d.kind === 'convert' ? '/stimuli/convert' : '/stimuli/upload';
    return request(f, `${route}?operation_key=${d.key}`, 'POST', form, actor);
  }
  async function readUsage(f) {
    const response = await request(f, `/stimuli/storage?project_id=${f.projectId}`);
    assert.equal(response.status,200,await response.clone().text()); return response.json();
  }
  async function waitTerminal(f,d) {
    for (let index=0; index<50; index++) {
      const row = await (await request(f, `/stimuli/operations/${d.key}?project_id=${f.projectId}`)).json();
      if (['completed','failed','uncertain'].includes(row.state)) return row;
      await new Promise(resolve => setTimeout(resolve,20));
    }
    assert.fail('media operation did not settle');
  }
  async function expireReserved(f) {
    await pool.query("UPDATE media_operations SET expires_at=now()-interval '1 minute' WHERE organization_id=$1 AND state='reserved'", [f.organizationId]);
    // Reconciliation is explicit and fixture-owned; no native jobs are active.
    for (const row of (await pool.query("SELECT id FROM media_operations WHERE organization_id=$1 AND state='reserved'", [f.organizationId])).rows) {
      await reconcile(pool,row.id,path.join(root,'stimuli'),{ writersStopped: true });
    }
  }
  before(async () => {
    const database = new URL(process.env.MEDIA_TEST_DATABASE_URL);
    assert.match(database.pathname, /test/i, 'disposable media test database must be clearly named as a test database');
    for (const key of envNames) savedEnv[key] = process.env[key];
    root = await fs.mkdtemp(path.join(os.tmpdir(),'wecog-media-integration-'));
    process.env.DATABASE_URL = process.env.MEDIA_TEST_DATABASE_URL;
    process.env.UPLOADS_ROOT = root;
    process.env.MEDIA_MIN_FREE_BYTES = '1';
    process.env.MEDIA_ORGANIZATION_QUOTA_BYTES = String(1024*1024*1024);
    process.env.MEDIA_MAX_USER_UPLOADS = '2';
    config = require('../config');
    assert.equal(config.database.url, process.env.MEDIA_TEST_DATABASE_URL, 'local .env must not redirect media fixtures');
    assert.equal(config.storage.uploadsRoot, root, 'local .env must not redirect media files');
    ({ pool } = require('../db'));
    assert.ok((await pool.query("SELECT to_regclass('media_operations') AS table_name")).rows[0].table_name,
      'apply migrations through 1699000000019 in the disposable test harness first');
    ({ reconcileMediaOperation: reconcile } = require('../stimuli/media-reconciliation'));
    operations = require('../stimuli/media-operations');
    // Deterministic native fixtures, not a claim of real codec/converter coverage.
    const probe = path.join(root,'probe');
    const encoder = path.join(root,'encoder');
    const info = path.join(root,'info');
    const raster = path.join(root,'raster');
    await fs.writeFile(probe, '#!/bin/sh\nprintf \'%s\' \'{"streams":[{"codec_type":"video","codec_name":"png","width":100,"height":80}],"format":{}}\'\n', { mode: 0o700 });
    await fs.writeFile(encoder, '#!/bin/sh\nfor last; do :; done\nprintf "\\377\\330\\377\\331" > "$last"\n', { mode: 0o700 });
    await fs.writeFile(info, '#!/bin/sh\nprintf "Pages: 1\\nPage size: 100 x 100 pts\\n"\n', { mode: 0o700 });
    await fs.writeFile(raster, '#!/bin/sh\nfor last; do :; done\nprintf "\\377\\330\\377\\331" > "$last.jpg"\n', { mode: 0o700 });
    config.storage.preview = { ...config.storage.preview, ffprobeBin: probe, ffmpegBin: encoder };
    config.storage.conversion = { ...config.storage.conversion, pdfInfoBin: info, pdfToPpmBin: raster };
    const express = require('express');
    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/stimuli', require('../routes/stimuli'));
    server = app.listen(0,'127.0.0.1');
    await new Promise((resolve,reject) => { server.once('listening',resolve); server.once('error',reject); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) {
      for (const f of fixtures) {
        const active = await pool.query("SELECT id FROM media_operations WHERE organization_id=$1 AND state NOT IN ('completed','failed')", [f.organizationId]);
        for (const row of active.rows) await reconcile(pool,row.id,path.join(root,'stimuli'),{ writersStopped: true });
        await pool.query('DELETE FROM organizations WHERE id=$1',[f.organizationId]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[f.users]);
      }
      await pool.end();
    }
    if (root) await fs.rm(root,{ recursive: true,force: true });
    for (const key of envNames) savedEnv[key] === undefined ? delete process.env[key] : process.env[key] = savedEnv[key];
  });

  it('rejects old/missing admission before multipart disk writes', async () => {
    const f = await fixture();
    const before = await fs.readdir(path.join(root,'stimuli'));
    const response = await upload(f,{ kind:'upload',key:'unreserved-operation-key',file:{ type:'application/pdf',name:'fixture.pdf' } });
    assert.equal(response.status,422);
    assert.equal((await response.json()).code,'media_operation_required');
    assert.deepEqual(await fs.readdir(path.join(root,'stimuli')),before);
  });

  it('serializes concurrent same-key admissions, conflicts on changed fingerprint, and replays exactly the same IDs', async () => {
    const f = await fixture(), d = descriptor(f);
    const admissions = await Promise.all([admit(f,d),admit(f,d)]);
    assert.equal(admissions[0].key,admissions[1].key);
    const conflict = await request(f,'/stimuli/operations','POST',{ ...d,name:'different' });
    assert.equal(conflict.status,409);
    const results = await Promise.all([upload(f,d),upload(f,d)]);
    const ok = results.filter(response => response.status === 201);
    assert.ok(ok.length >= 1);
    assert.ok(results.every(response => [201,409].includes(response.status)));
    const first = await ok[0].json();
    const replay = await upload(f,d);
    assert.equal(replay.status,201);
    assert.deepEqual(await replay.json(),first);
    const recovered = await waitTerminal(f,d);
    assert.deepEqual(recovered.result,first);
    assert.equal(Number((await pool.query('SELECT count(*) FROM stimuli WHERE project_id=$1',[f.projectId])).rows[0].count),1);
    assert.equal((await readUsage(f)).reserved_bytes,0);
  });

  it('scopes recovery to both actor and tenant membership, including private libraries', async () => {
    const f = await fixture(), d = descriptor(f);
    await admit(f,d); assert.equal((await upload(f,d)).status,201);
    const route = `/stimuli/operations/${d.key}?project_id=${f.projectId}`;
    assert.equal((await request(f,route,'GET',undefined,1)).status,404);
    assert.equal((await request(f,route,'GET',undefined,2)).status,404);
    assert.equal((await request(f,`/stimuli/operations/${d.key}?project_id=${f.projectId+1}`)).status,404);
    const peerList = await (await request(f,`/stimuli?project_id=${f.projectId}`,'GET',undefined,1)).json();
    assert.deepEqual(peerList,[]);
    await pool.query('DELETE FROM user_projects WHERE user_id=$1 AND project_id=$2',[f.users[0],f.projectId]);
    assert.equal((await request(f,route)).status,404);
  });

  it('enforces organization reservation quota concurrently across actors and bounds two active uploads per actor', async () => {
    const f = await fixture();
    const oldQuota = process.env.MEDIA_ORGANIZATION_QUOTA_BYTES;
    try {
      process.env.MEDIA_ORGANIZATION_QUOTA_BYTES = String(pdf.length);
      const responses = await Promise.all([request(f,'/stimuli/operations','POST',descriptor(f),0),request(f,'/stimuli/operations','POST',descriptor(f),1)]);
      assert.deepEqual(responses.map(response => response.status).sort(),[201,413]);
      assert.equal((await readUsage(f)).reserved_bytes,pdf.length);
    } finally { process.env.MEDIA_ORGANIZATION_QUOTA_BYTES = oldQuota; }
    await expireReserved(f);
    await admit(f,descriptor(f)); await admit(f,descriptor(f));
    const third = await request(f,'/stimuli/operations','POST',descriptor(f));
    assert.equal(third.status,429);
    await expireReserved(f);
  });

  it('rejects mismatched/oversized bytes, cleans confirmed failure, and releases the reservation', async () => {
    const f = await fixture(), d = descriptor(f);
    await admit(f,d);
    const response = await upload(f,d,Buffer.concat([pdf,Buffer.alloc(10000)]));
    assert.equal(response.status,413);
    assert.equal((await waitTerminal(f,d)).state,'failed');
    const totals = await readUsage(f);
    assert.equal(totals.reserved_bytes,0); assert.equal(totals.retained_bytes,0);
    const smaller = descriptor(f); await admit(f,smaller);
    const mismatch = Buffer.from(pdf); mismatch[mismatch.length-1] ^= 1;
    assert.equal((await upload(f,smaller,mismatch)).status,409);
    assert.equal((await waitTerminal(f,smaller)).state,'failed');
  });

  it('closes a partial multipart writer and releases its slot after a real socket abort', async () => {
    const f = await fixture(), bytes = Buffer.concat([pdf, Buffer.alloc(1024 * 1024)]), d = descriptor(f, bytes);
    await admit(f, d);
    const boundary = 'fixture-multipart-boundary';
    const req = require('node:http').request(base + '/stimuli/upload?operation_key=' + d.key, {
      method: 'POST', headers: { authorization: 'Bearer ' + f.tokens[0],
        'content-type': 'multipart/form-data; boundary=' + boundary, 'content-length': String(bytes.length + 1024) },
    });
    req.on('error', () => {});
    try {
      req.write('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="fixture.pdf"\r\n'
        + 'Content-Type: application/pdf\r\n\r\n');
      req.write(bytes.subarray(0, 16 * 1024));
      let partial;
      for (let i = 0; i < 100 && !partial; i++) {
        const row = await operations.findOperation(pool, f.users[0], d.key);
        const artifact = row.artifacts[0];
        if (artifact) {
          const file = path.join(root, 'stimuli', artifact.path);
          const stat = await fs.stat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
          if (stat?.size > 0) partial = file;
        }
        if (!partial) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(partial, 'abort must happen after a real partial file exists');
      req.destroy();
      assert.equal((await waitTerminal(f, d)).state, 'failed');
      assert.equal((await readUsage(f)).reserved_bytes, 0);
      await assert.rejects(fs.stat(partial), { code: 'ENOENT' });
    } finally { req.destroy(); }
  });

  it('counts both immutable historical originals and posters after replacement, and preserves referenced versions', async () => {
    const f = await fixture();
    const png = Buffer.from([137,80,78,71,13,10,26,10]);
    const first = descriptor(f,png,{ file:{ name:'image.png',type:'image/png',size:png.length,sha256:hash(png) } });
    await admit(f,first);
    const row = await (await upload(f,first,png)).json();
    const replacement = descriptor(f,png,{ kind:'replace',stimulus_id:row.id,file:first.file });
    await admit(f,replacement);
    const changed = await (await upload(f,replacement,png)).json();
    assert.notEqual(changed.current_version_id,row.current_version_id);
    assert.equal((await readUsage(f)).retained_bytes,2*(png.length+4));
    const historical = await request(f,`/stimuli/${row.id}/content?version=${row.current_version_id}`);
    assert.deepEqual(Buffer.from(await historical.arrayBuffer()),png);
    await pool.query('INSERT INTO protocols(project_id,name,definition) VALUES($1,$2,$3::jsonb)',
      [f.projectId,'References media',JSON.stringify({ blocks:[{ stimulusId:row.id }] })]);
    assert.equal((await request(f,`/stimuli/${row.id}`,'DELETE')).status,409);
    assert.equal((await readUsage(f)).retained_bytes,2*(png.length+4));
  });

  it('regenerates a missing ready poster without replacing or losing the original version', async () => {
    const f = await fixture();
    const png = Buffer.from([137,80,78,71,13,10,26,10]);
    const d = descriptor(f,png,{ file:{ name:'poster-recovery.png',type:'image/png',size:png.length,sha256:hash(png) } });
    await admit(f,d);
    const uploaded = await upload(f,d,png);
    assert.equal(uploaded.status,201,await uploaded.clone().text());
    const row = await uploaded.json();
    const before = (await pool.query('SELECT * FROM stimulus_versions WHERE id=$1',[row.current_version_id])).rows[0];
    await fs.unlink(path.join(root,'stimuli',before.preview_path));
    const regenerated = await request(f,`/stimuli/${row.id}/preview`);
    assert.equal(regenerated.status,200,await regenerated.clone().text());
    const after = (await pool.query('SELECT * FROM stimulus_versions WHERE id=$1',[row.current_version_id])).rows[0];
    assert.equal(after.id,before.id);
    assert.notEqual(after.preview_path,before.preview_path);
    assert.equal(after.sha256,before.sha256);
    assert.equal(after.media_info.validated_sha256,before.sha256);
    const original = await request(f,`/stimuli/${row.id}/content?version=${row.current_version_id}`);
    assert.equal(original.status,200);
    assert.deepEqual(Buffer.from(await original.arrayBuffer()),png);
  });

  it('converts once and replays identical slide/version IDs with no second native conversion', async () => {
    const f = await fixture(), d = descriptor(f,pdf,{ kind:'convert' });
    await admit(f,d);
    const response = await upload(f,d);
    assert.equal(response.status,201,await response.clone().text());
    const first = await response.json();
    const replay = await upload(f,d);
    assert.deepEqual(await replay.json(),first);
    assert.equal(first.stimuli.length,1);
    assert.equal((await readUsage(f)).retained_bytes,8);
    const completed = await operations.findOperation(pool, f.users[0], d.key);
    for (const artifact of completed.artifacts.filter(row => row.directory || row.path.startsWith('.incoming/'))) {
      await assert.rejects(fs.stat(path.join(root, 'stimuli', artifact.path)), { code: 'ENOENT' });
    }
  });

  it('conversion cleanup failure keeps its reservation and rollback artifacts recoverable before publication', async () => {
    for (const failedCleanup of ['workspace', 'incoming']) {
      const f = await fixture(), d = descriptor(f, pdf, { kind: 'convert' });
      await admit(f, d);
      const original = { rm: fs.rm, unlink: fs.unlink };
      const denied = () => Object.assign(new Error('synthetic cleanup failure'), { code: 'EACCES' });
      fs.rm = async (file, ...args) => {
        if (failedCleanup === 'workspace' && String(file).startsWith(path.join(root, 'stimuli', '.conversion') + path.sep)) throw denied();
        return original.rm(file, ...args);
      };
      fs.unlink = async (file, ...args) => {
        if (failedCleanup === 'incoming' && String(file).startsWith(path.join(root, 'stimuli', '.incoming') + path.sep)) throw denied();
        return original.unlink(file, ...args);
      };
      let operation;
      try {
        const response = await upload(f, d);
        assert.equal(response.status, 500);
        assert.equal((await waitTerminal(f, d)).state, 'uncertain');
        operation = await operations.findOperation(pool, f.users[0], d.key);
        assert.ok(Number(operation.reserved_bytes) > 0);
        assert.equal((await pool.query('SELECT 1 FROM stimuli WHERE project_id=$1', [f.projectId])).rowCount, 0);
        assert.equal((await readUsage(f)).retained_bytes, 0);
      } finally { fs.rm = original.rm; fs.unlink = original.unlink; }
      const recovered = await reconcile(pool, operation.id, path.join(root, 'stimuli'), { writersStopped: true });
      assert.equal(recovered.state, 'failed');
      assert.equal((await readUsage(f)).reserved_bytes, 0);
      for (const artifact of operation.artifacts) {
        await assert.rejects(fs.stat(path.join(root, 'stimuli', artifact.path)), { code: 'ENOENT' });
      }
    }
  });

  it('retains uncertain active reservations; offline reconciliation removes only journaled unreferenced artifacts', async () => {
    const f = await fixture(), d = descriptor(f);
    await admit(f,d);
    const operation = await operations.findOperation(pool,f.users[0],d.key);
    const relative = crypto.randomUUID();
    await fs.writeFile(path.join(root,'stimuli',relative),pdf);
    await pool.query(`UPDATE media_operations SET state='uncertain',artifacts=$2::jsonb,expires_at=now()-interval '1 hour' WHERE id=$1`,
      [operation.id,JSON.stringify([{path:relative,directory:false}])]);
    assert.equal((await readUsage(f)).reserved_bytes,pdf.length);
    assert.equal((await upload(f,d)).status,409);
    const status = await reconcile(pool,operation.id,path.join(root,'stimuli'),{ writersStopped:true });
    assert.equal(status.state,'failed');
    await assert.rejects(fs.stat(path.join(root,'stimuli',relative)),{code:'ENOENT'});
    assert.equal((await readUsage(f)).reserved_bytes,0);
  });

  it('stores a completed result in the actual media transaction despite a lost COMMIT acknowledgement', async () => {
    const f = await fixture(), d = descriptor(f);
    await admit(f,d);
    const operation = await operations.findOperation(pool,f.users[0],d.key);
    const claim = await operations.claimOperation(pool,operation,path.join(root,'stimuli'));
    const relative = crypto.randomUUID();
    await fs.writeFile(path.join(root,'stimuli',relative),pdf);
    const { withMediaWrite,ensureStimulusVersion } = require('../stimuli/versions');
    try {
      const wrappedPool = { connect:async () => {
        const client = await pool.connect();
        return { release:() => client.release(), query:async (sql,...args) => {
          const result = await client.query(sql,...args);
          if (sql==='COMMIT') throw Object.assign(new Error('fixture lost acknowledgement'),{code:'ECONNRESET'});
          return result;
        } };
      } };
      await assert.rejects(withMediaWrite(wrappedPool,client => operations.completeOperation(client,operation,201,row => ({
        id:row.id,project_id:row.project_id,current_version_id:row.current_version_id,
      }),async queryable => {
        const row = (await queryable.query(`INSERT INTO stimuli(project_id,name,mime_type,size_bytes,metadata,created_by,visibility)
          VALUES($1,'Committed fixture','application/pdf',$2,$3::jsonb,$4,'private') RETURNING *`,
        [f.projectId,pdf.length,JSON.stringify({content_path:relative}),f.users[0]])).rows[0];
        await ensureStimulusVersion(queryable,row); return row;
      })),{code:'media_write_uncertain'});
      await operations.failOperation(pool,operation,true);
      const recovered = await waitTerminal(f,d);
      assert.equal(recovered.state,'completed');
      assert.ok(recovered.result.current_version_id);
      assert.deepEqual(await fs.readFile(path.join(root,'stimuli',relative)),pdf);
      assert.equal((await readUsage(f)).reserved_bytes,0);
    } finally { await claim.release(); }
  });

  it('allows ordinary project/user/tenant deletion after completed uploads while retaining project-orphan storage charges', async () => {
    const f = await fixture(), d = descriptor(f);
    await admit(f,d); assert.equal((await upload(f,d)).status,201);
    await pool.query('DELETE FROM projects WHERE id=$1',[f.projectId]);
    assert.equal(Number((await pool.query('SELECT count(*) FROM media_operations WHERE project_id=$1',[f.projectId])).rows[0].count),0);
    const retained = await pool.query('SELECT sum(size_bytes) AS bytes FROM media_storage_objects WHERE organization_id=$1',[f.organizationId]);
    assert.equal(Number(retained.rows[0].bytes),pdf.length);
    await pool.query('DELETE FROM users WHERE id=$1',[f.users[0]]);
    await pool.query('DELETE FROM organizations WHERE id=$1',[f.organizationId]);
  });

  it('refuses deletion while an active writer reservation would otherwise disappear', async () => {
    const f = await fixture(); await admit(f,descriptor(f));
    await assert.rejects(pool.query('DELETE FROM projects WHERE id=$1',[f.projectId]),{code:'23503'});
    await assert.rejects(pool.query('DELETE FROM users WHERE id=$1',[f.users[0]]),{code:'23503'});
    await expireReserved(f);
    await pool.query('DELETE FROM projects WHERE id=$1',[f.projectId]);
  });
});
