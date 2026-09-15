const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  isPlatformAdmin,
} = require('../security/permissions');
const {
  isPiiKey,
  validateSessionFeaturePayload,
} = require('../security/payload-policy');
const {
  resolveServerOwnedUploadPath,
  resolveReadableServerOwnedUploadPath,
  rejectClientOwnedContentPath,
  getStoredContentPath,
  contentDisposition,
} = require('../security/upload-paths');
const {
  ALLOWED_UPLOAD_MIME_TYPES,
  INLINE_MEDIA_TYPES,
  matchesDeclaredMediaType,
  verifyUploadedFileType,
} = require('../security/stimulus-files');
const {
  classifyRoute,
  buildCorsOptions,
  createSecurityHeaders,
  createRouteAwareJsonParser,
  createRouteRateLimiter,
  requireSecureTransport,
} = require('../security/http-security');
const { withTransaction } = require('../db/transaction');
const {
  reserveInvitationRun,
} = require('../ingest/invitation-repository');
const invitationsRouter = require('../routes/invitations_new');

function validPayload() {
  return {
    schemaVersion: 'session_feature.v1',
    ids: { session: 'S-S2-01', participant: 'P-1', invitationCode: 'INV-1' },
    meta: { user: { interfaceLanguage: 'ru' }, tech: {} },
    lifecycle: {
      schemaVersion: 'session_lifecycle.v1',
      state: 'running',
      status: 'in_progress',
    },
    events: [],
  };
}

describe('S2-01 admin bootstrap boundary', () => {
  it('never elevates a non-admin JWT claim through bypass metadata', () => {
    assert.equal(isPlatformAdmin({ role: 'researcher', bypass_admin: true }), false);
    assert.equal(isPlatformAdmin({ role: 'admin' }), true);
  });

  it('keeps public registration respondent-only and bootstrap operational', () => {
    const authSource = fs.readFileSync(
      path.resolve(__dirname, '../routes/auth.js'),
      'utf8'
    );
    const permissionSource = fs.readFileSync(
      path.resolve(__dirname, '../security/permissions.js'),
      'utf8'
    );
    const bootstrapSource = fs.readFileSync(
      path.resolve(__dirname, '../scripts/bootstrap-admin.js'),
      'utf8'
    );
    assert.match(authSource, /PUBLIC_REGISTER_ROLE = 'respondent'/);
    assert.doesNotMatch(authSource, /PROJECT_ADMIN_EMAILS|bypass_admin/);
    assert.doesNotMatch(permissionSource, /PROJECT_ADMIN_EMAILS|bypass_admin/);
    assert.match(bootstrapSource, /BOOTSTRAP_ADMIN_EMAIL/);
    assert.match(bootstrapSource, /BEGIN/);
    assert.match(bootstrapSource, /COMMIT/);
    assert.match(bootstrapSource, /ROLLBACK/);
  });

  it('fails closed for production HTTPS and JWT configuration', () => {
    const cwd = path.resolve(__dirname, '..');
    const secureEnv = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(48),
      FORCE_HTTPS: 'false',
    };
    const forceHttps = execFileSync(
      process.execPath,
      ['-e', "process.stdout.write(String(require('./config').forceHttps))"],
      { cwd, env: secureEnv, encoding: 'utf8' }
    );
    assert.equal(forceHttps, 'true');

    const weakSecret = spawnSync(
      process.execPath,
      ['-e', "require('./config')"],
      {
        cwd,
        env: { ...secureEnv, JWT_SECRET: 'too-short' },
        encoding: 'utf8',
      }
    );
    assert.notEqual(weakSecret.status, 0);
    assert.match(`${weakSecret.stdout}${weakSecret.stderr}`, /JWT_SECRET/);

    const hardenedLimits = JSON.parse(execFileSync(
      process.execPath,
      ['-e', [
        "const c = require('./config');",
        'process.stdout.write(JSON.stringify({',
        'port: c.port,',
        'authRate: c.http.rateLimits.auth,',
        'ingestRate: c.http.rateLimits.ingest,',
        'uploadBytes: c.storage.maxUploadBytes',
        '}));',
      ].join('')],
      {
        cwd,
        env: {
          ...secureEnv,
          PORT: '70000',
          AUTH_RATE_LIMIT_PER_MINUTE: '-1',
          INGEST_RATE_LIMIT_PER_MINUTE: '0',
          MAX_UPLOAD_BYTES: '-500',
        },
        encoding: 'utf8',
      }
    ));
    assert.deepEqual(hardenedLimits, {
      port: 3000,
      authRate: 20,
      ingestRate: 60,
      uploadBytes: 50 * 1024 * 1024,
    });
  });
});

describe('S2-01 ingest allowlist and PII policy', () => {
  it('checks credentials before exposing payload validation details', () => {
    const ingestSource = fs.readFileSync(
      path.resolve(__dirname, '../routes/ingest.js'),
      'utf8'
    );
    const credentialIndex = ingestSource.indexOf('requireIngestCredential,');
    const payloadIndex = ingestSource.indexOf('requireSessionFeaturePayload,');
    assert.ok(credentialIndex > 0);
    assert.ok(payloadIndex > credentialIndex);
  });

  it('accepts the typed minimal envelope', () => {
    assert.deepEqual(validateSessionFeaturePayload(validPayload()), []);
  });

  it('rejects malformed sections and incoherent lifecycle states', () => {
    const payload = validPayload();
    payload.blocks = {};
    payload.bpm_summary = [];
    payload.ids.session = 'S'.repeat(65);
    payload.lifecycle.status = 'completed';
    payload.lifecycle.unreviewed = true;
    payload.events = [{
      schemaVersion: 'legacy_event',
      eventId: '',
      type: 'test',
      category: 'unknown',
      severity: 'info',
      timestamp: Number.NaN,
    }];
    const errors = validateSessionFeaturePayload(payload);
    assert.ok(errors.some(error => error.path === '/blocks' && error.keyword === 'type'));
    assert.ok(errors.some(error => error.path === '/bpm_summary' && error.keyword === 'type'));
    assert.ok(errors.some(error => error.path === '/ids/session' && error.keyword === 'maxLength'));
    assert.ok(errors.some(error => error.keyword === 'stateStatusMismatch'));
    assert.ok(errors.some(error =>
      error.path === '/lifecycle/unreviewed'
      && error.keyword === 'additionalProperties'
    ));
    assert.ok(errors.some(error =>
      error.path === '/events/0/schemaVersion'
      && error.keyword === 'const'
    ));
  });

  it('requires a replay key and completion timestamp for completed lifecycle', () => {
    const payload = validPayload();
    payload.lifecycle.state = 'completed';
    payload.lifecycle.status = 'completed';
    let errors = validateSessionFeaturePayload(payload);
    assert.ok(errors.some(error =>
      error.path === '/lifecycle'
      && error.keyword === 'required'
    ));

    payload.lifecycle.finishAttemptId = 'finish-S-S2-01';
    payload.lifecycle.completedAt = new Date().toISOString();
    errors = validateSessionFeaturePayload(payload);
    assert.deepEqual(errors, []);
  });

  it('rejects unknown top-level and identity fields', () => {
    const payload = validPayload();
    payload.unreviewed_blob = {};
    payload.ids.participantEmail = 'hidden@example.test';
    const errors = validateSessionFeaturePayload(payload);
    assert.ok(errors.some(error => error.keyword === 'additionalProperties'));
    assert.ok(errors.some(error => error.keyword === 'pii'));
    assert.equal(isPiiKey('phoneNumber'), true);
    assert.equal(isPiiKey('microphone'), false);
  });

  it('rejects PII values even under generic nested keys', () => {
    const payload = validPayload();
    payload.events.push({
      schemaVersion: 'session_event.v1',
      eventId: 'E-1',
      type: 'note',
      category: 'module',
      severity: 'info',
      timestamp: 1,
      label: 'participant@example.test',
    });
    assert.ok(
      validateSessionFeaturePayload(payload)
        .some(error => error.keyword === 'pii')
    );

    payload.events[0].label = '+7 (999) 123-45-67';
    assert.ok(
      validateSessionFeaturePayload(payload)
        .some(error => error.keyword === 'pii')
    );

    payload.events = [];
    payload.precheck = { result: { value: '79991234567' } };
    assert.ok(
      validateSessionFeaturePayload(payload)
        .some(error => error.keyword === 'pii')
    );
  });

  it('accepts numeric stimulus URLs but still rejects PII query parameters', () => {
    const payload = validPayload();
    payload.gazeTests = {
      stimulus: {
        url: 'https://commons.wikimedia.org/wiki/Special:FilePath/File:Panthera%20leo%20(55027011675).jpg',
      },
    };
    assert.deepEqual(validateSessionFeaturePayload(payload), []);

    payload.gazeTests.stimulus.url = 'https://assets.example.test/cat.jpg?phone=79991234567';
    assert.ok(
      validateSessionFeaturePayload(payload)
        .some(error => error.keyword === 'pii')
    );
  });

  it('rejects excessive depth and arrays', () => {
    const payload = validPayload();
    payload.precheck = { a: { b: { c: { d: true } } } };
    payload.events = Array.from({ length: 4 }, (_, index) => ({
      schemaVersion: 'session_event.v1',
      eventId: `E-${index}`,
      type: 'test',
      category: 'module',
      severity: 'info',
      timestamp: index,
    }));
    const errors = validateSessionFeaturePayload(payload, {
      maxDepth: 3,
      maxEvents: 3,
    });
    assert.ok(errors.some(error => error.keyword === 'maxDepth'));
    assert.ok(errors.some(error => error.keyword === 'maxItems'));
  });
});

describe('S2-01 upload root confinement', () => {
  const root = path.resolve('/srv/wecog/uploads/stimuli');

  it('accepts a server-owned relative path', () => {
    const result = resolveServerOwnedUploadPath(root, '2026/asset.png');
    assert.equal(result.ok, true);
    assert.equal(result.absolutePath, path.join(root, '2026/asset.png'));
  });

  for (const candidate of [
    '/etc/passwd',
    '../outside.txt',
    'nested/../../outside.txt',
    'C:\\Windows\\system.ini',
    '..\\outside.txt',
  ]) {
    it(`rejects unsafe path: ${candidate}`, () => {
      assert.equal(resolveServerOwnedUploadPath(root, candidate).ok, false);
    });
  }

  it('rejects client attempts to own content_path', () => {
    assert.equal(rejectClientOwnedContentPath({ title: 'safe' }).ok, true);
    assert.equal(rejectClientOwnedContentPath({ content_path: '../x' }).ok, false);
    assert.equal(rejectClientOwnedContentPath({ contentPath: '/tmp/x' }).ok, false);
  });

  it('keeps legacy contentPath records readable after storage upgrades', () => {
    assert.equal(getStoredContentPath({ content_path: 'new.png' }), 'new.png');
    assert.equal(getStoredContentPath({ contentPath: 'legacy.png' }), 'legacy.png');
  });

  it('encodes non-ASCII stimulus names in Content-Disposition headers', () => {
    const value = contentDisposition('inline', 'мяу-мяу.jpg');
    assert.match(value, /^inline; filename="[\x20-\x7e]+";/);
    assert.match(value, /filename\*=UTF-8''%D0%BC%D1%8F%D1%83/);
    assert.doesNotThrow(() => {
      const response = new (require('node:http').ServerResponse)({ method: 'GET' });
      response.setHeader('Content-Disposition', value);
    });
  });

  it('allows only passive media types and verifies their signatures', () => {
    assert.equal(ALLOWED_UPLOAD_MIME_TYPES.has('text/html'), false);
    assert.equal(ALLOWED_UPLOAD_MIME_TYPES.has('image/svg+xml'), false);
    assert.equal(INLINE_MEDIA_TYPES.has('application/pdf'), false);
    assert.equal(
      matchesDeclaredMediaType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png'
      ),
      true
    );
    assert.equal(matchesDeclaredMediaType(Buffer.from('<script>'), 'image/png'), false);
    assert.equal(matchesDeclaredMediaType(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
  });

  it('verifies uploaded media only inside the server-owned root', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-upload-signature-'));
    const localRoot = path.join(temp, 'uploads');
    const outside = path.join(temp, 'outside.png');
    const validName = '4b8fbca1-3f3f-40bf-b86c-e7b438c8862f_image.png';
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.mkdirSync(localRoot);
    fs.writeFileSync(path.join(localRoot, validName), pngSignature);
    fs.writeFileSync(outside, pngSignature);
    fs.symlinkSync(outside, path.join(localRoot, 'linked.png'));
    try {
      assert.equal(await verifyUploadedFileType(localRoot, validName, 'image/png'), true);
      assert.equal(await verifyUploadedFileType(localRoot, '../outside.png', 'image/png'), false);
      assert.equal(await verifyUploadedFileType(localRoot, 'linked.png', 'image/png'), false);
      assert.equal(await verifyUploadedFileType(localRoot, validName, 'image/svg+xml'), false);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('does not follow an in-root symlink outside uploads root', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-upload-path-'));
    const localRoot = path.join(temp, 'uploads');
    const outside = path.join(temp, 'outside.txt');
    fs.mkdirSync(localRoot);
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(localRoot, 'linked.txt'));
    try {
      const result = await resolveReadableServerOwnedUploadPath(localRoot, 'linked.txt');
      assert.equal(result.ok, false);
      assert.equal(result.code, 'content_path_symlink_escape');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});

describe('S1 typed transport boundary', () => {
  it('does not mount the legacy arbitrary event batch route', () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
    assert.doesNotMatch(appSource, /app\.use\(['"]\/events/);
    assert.match(appSource, /app\.use\(['"]\/ingest/);
    assert.match(
      appSource,
      /app\.use\(rateLimit\(buildRouteRateLimitOptions\(config\.http\.rateLimits\)\)\)/
    );
  });
});

describe('S2-01 route-specific HTTP controls', () => {
  it('does not log expected client rejections as internal stack traces', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const corsBranch = source.indexOf("err?.code === 'cors_origin_denied'");
    const invalidJsonBranch = source.indexOf('err instanceof SyntaxError');
    const unexpectedLog = source.indexOf('console.error(err);');
    assert.ok(corsBranch >= 0);
    assert.ok(invalidJsonBranch > corsBranch);
    assert.ok(unexpectedLog > invalidJsonBranch);
  });

  it('classifies auth, ingest and default independently', () => {
    assert.equal(classifyRoute('/auth/login'), 'auth');
    assert.equal(classifyRoute('/ingest'), 'ingest');
    assert.equal(classifyRoute('/invitations/by-code/ABC'), 'ingest');
    assert.equal(classifyRoute('/invitations/by-code/ABC/ingest-token'), 'ingest');
    assert.equal(classifyRoute('/invitations/by-code/ABC/stimuli'), 'ingest');
    assert.equal(classifyRoute('/invitations/by-code/ABC/stimuli/1/content'), 'ingest');
    assert.equal(classifyRoute('/projects'), 'default');
  });

  it('generates high-entropy URL-safe invitation bearer codes', () => {
    const first = invitationsRouter.generateCode();
    const second = invitationsRouter.generateCode();
    assert.match(first, /^[A-Za-z0-9_-]{22}$/);
    assert.match(second, /^[A-Za-z0-9_-]{22}$/);
    assert.notEqual(first, second);
  });

  it('extracts only numeric protocol-referenced stimuli and strips private metadata', () => {
    assert.deepEqual(
      invitationsRouter.referencedStimulusIds({
        blocks: [
          { params: { stimuli_ids: ['api:12', 'std_go_green_circle', 13] } },
          { trials: [{ stimulusId: '14' }, { stimulusId: '../15' }] },
        ],
      }),
      [12, 13, 14]
    );
    assert.deepEqual(
      invitationsRouter.publicStimulusMetadata({
        text: 'safe',
        emotion: 'neutral',
        content_path: 'private/file.png',
        url: 'https://tracker.invalid/pixel',
        participant_email: 'person@example.test',
      }),
      { text: 'safe', emotion: 'neutral' }
    );
  });

  it('sets API hardening headers and rejects insecure transport without redirecting', () => {
    const response = {
      headers: {},
      statusCode: 200,
      setHeader(name, value) { this.headers[name] = value; },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
    };
    let nextCalled = false;
    createSecurityHeaders()({ secure: true }, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.match(response.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
    assert.match(response.headers['Strict-Transport-Security'], /includeSubDomains/);

    nextCalled = false;
    requireSecureTransport(
      { secure: false },
      response,
      () => { nextCalled = true; }
    );
    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 426);
    assert.equal(response.body.code, 'https_required');
  });

  it('allows only configured browser origins', async () => {
    const options = buildCorsOptions(['https://wecog.ru']);
    const check = origin => new Promise(resolve => {
      options.origin(origin, (error, allowed) => resolve({ error, allowed }));
    });
    assert.equal((await check('https://wecog.ru')).allowed, true);
    assert.equal((await check(undefined)).allowed, true);
    assert.equal((await check('https://attacker.test')).error.code, 'cors_origin_denied');
    assert.equal(options.credentials, true);
  });

  it('uses different JSON limits for auth and ingest', async () => {
    const parser = createRouteAwareJsonParser({
      auth: '100b',
      ingest: '1kb',
      default: '200b',
    });
    const parse = route => new Promise(resolve => {
      const body = JSON.stringify({ value: 'x'.repeat(150) });
      const request = Readable.from([Buffer.from(body)]);
      request.method = 'POST';
      request.url = route;
      request.path = route;
      request.headers = {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      };
      parser(request, {}, error => resolve({ error, body: request.body }));
    });
    const auth = await parse('/auth/login');
    const ingest = await parse('/ingest');
    assert.equal(auth.error?.type, 'entity.too.large');
    assert.equal(ingest.error, undefined);
    assert.equal(ingest.body.value.length, 150);
  });

  it('rate-limits each route profile independently', async () => {
    const limiter = createRouteRateLimiter(
      { auth: 2, ingest: 3, default: 4 },
      { windowMs: 60_000, validate: false }
    );
    const run = pathValue => new Promise((resolve, reject) => {
      const req = { path: pathValue, ip: '127.0.0.1', headers: {}, socket: {} };
      const response = {
        headers: {},
        statusCode: 200,
        setHeader(name, value) { this.headers[name] = value; },
        getHeader(name) { return this.headers[name]; },
        status(value) { this.statusCode = value; return this; },
        json(value) {
          this.body = value;
          resolve({ response: this, nextCalled: false });
          return this;
        },
      };
      Promise.resolve(limiter(req, response, () => {
        resolve({ response, nextCalled: true });
      })).catch(reject);
    });
    assert.equal((await run('/auth/login')).nextCalled, true);
    assert.equal((await run('/auth/login')).nextCalled, true);
    const rejected = await run('/auth/login');
    assert.equal(rejected.response.statusCode, 429);
    assert.equal(rejected.response.body.route_profile, 'auth');
    assert.ok(Number(rejected.response.headers['Retry-After']) >= 1);
    assert.equal((await run('/ingest')).nextCalled, true);
  });

  it('keeps independent rate-limit counters for different addresses', async () => {
    const limiter = createRouteRateLimiter(
      { auth: 1, ingest: 1, default: 1 },
      { windowMs: 60_000, validate: false }
    );
    const run = ip => new Promise((resolve, reject) => {
      const req = { path: '/auth/login', ip, headers: {}, socket: {} };
      const response = {
        headers: {},
        statusCode: 200,
        setHeader(name, value) { this.headers[name] = value; },
        getHeader(name) { return this.headers[name]; },
        status(value) { this.statusCode = value; return this; },
        json(value) {
          this.body = value;
          resolve({ response: this, nextCalled: false });
          return this;
        },
      };
      Promise.resolve(limiter(req, response, () => {
        resolve({ response, nextCalled: true });
      })).catch(reject);
    });

    assert.equal((await run('192.0.2.1')).nextCalled, true);
    assert.equal((await run('192.0.2.1')).response.statusCode, 429);
    assert.equal((await run('192.0.2.2')).nextCalled, true);
    assert.equal((await run('192.0.2.1')).response.statusCode, 429);
  });
});

describe('S2-01 transactional ingest contracts', () => {
  it('rolls back all writes and releases the client after a late failure', async () => {
    const calls = [];
    let released = false;
    const client = {
      async query(sql) {
        calls.push(sql);
        return { rows: [] };
      },
      release() { released = true; },
    };
    const pool = { async connect() { return client; } };

    await assert.rejects(
      withTransaction(pool, async queryable => {
        await queryable.query('INSERT INTO sessions VALUES (1)');
        await queryable.query('INSERT INTO session_features VALUES (1)');
        await queryable.query('INSERT INTO session_qc_summary VALUES (1)');
        throw new Error('proxy write failed');
      }),
      /proxy write failed/
    );
    assert.equal(calls[0], 'BEGIN');
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.equal(calls.includes('COMMIT'), false);
    assert.equal(released, true);
  });

  it('rolls back an invitation run reservation with the session transaction', async () => {
    let committedRuns = 0;
    let transactionalRuns = 0;
    const client = {
      async query(sql) {
        if (sql === 'BEGIN') transactionalRuns = committedRuns;
        if (/UPDATE invitations/.test(sql)) {
          transactionalRuns += 1;
          return { rows: [{ id: 1, used_runs: transactionalRuns, max_runs: 1 }] };
        }
        if (sql === 'COMMIT') committedRuns = transactionalRuns;
        if (sql === 'ROLLBACK') transactionalRuns = committedRuns;
        return { rows: [] };
      },
      release() {},
    };
    await assert.rejects(
      withTransaction(
        { connect: async () => client },
        async queryable => {
          await reserveInvitationRun(queryable, 1);
          throw new Error('session insert failed');
        }
      )
    );
    assert.equal(committedRuns, 0);
    assert.equal(transactionalRuns, 0);
  });

  it('uses one conditional UPDATE for concurrent invitation quota claims', async () => {
    let usedRuns = 0;
    let sqlSeen = '';
    const maxRuns = 3;
    const client = {
      async query(sql) {
        sqlSeen = sql;
        await new Promise(resolve => setImmediate(resolve));
        if (usedRuns >= maxRuns) return { rows: [] };
        usedRuns += 1;
        return { rows: [{ id: 1, used_runs: usedRuns, max_runs: maxRuns }] };
      },
    };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveInvitationRun(client, 1))
    );
    assert.equal(results.filter(Boolean).length, maxRuns);
    assert.equal(usedRuns, maxRuns);
    assert.match(sqlSeen, /used_runs = used_runs \+ 1/);
    assert.match(sqlSeen, /used_runs < max_runs/);
  });

  it('unknown invitation resolver performs one SELECT and no write', async () => {
    const calls = [];
    const queryable = {
      async query(sql) {
        calls.push(sql);
        return { rows: [] };
      },
    };
    const result = await invitationsRouter.resolveInvitationByCode('UNKNOWN', queryable);
    assert.equal(result, null);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^\s*SELECT/);
    assert.doesNotMatch(calls[0], /INSERT|UPDATE|DELETE/);
  });

  it('migration defines symmetric up/down operations', () => {
    const migration = require('../migrations/1699000000012_atomic_ingest_security');
    const calls = [];
    const pgm = new Proxy({}, {
      get(_target, property) {
        return (...args) => calls.push([property, ...args]);
      },
    });
    migration.up(pgm);
    migration.down(pgm);
    assert.ok(calls.some(call => call[0] === 'addColumns' && call[1] === 'invitations'));
    assert.ok(calls.some(call => call[0] === 'addColumns' && call[1] === 'sessions'));
    assert.ok(calls.some(call => call[0] === 'dropColumns' && call[1] === 'sessions'));
    assert.ok(calls.some(call => call[0] === 'dropColumns' && call[1] === 'invitations'));
  });

  it('staff token revocation migration defines symmetric up/down operations', () => {
    const migration = require('../migrations/1699000000013_staff_token_version');
    const calls = [];
    const pgm = new Proxy({}, {
      get(_target, property) {
        return (...args) => calls.push([property, ...args]);
      },
    });
    migration.up(pgm);
    migration.down(pgm);
    assert.ok(calls.some(call => call[0] === 'addColumns' && call[1] === 'users'));
    assert.ok(calls.some(call => call[0] === 'addConstraint' && call[1] === 'users'));
    assert.ok(calls.some(call => call[0] === 'dropColumns' && call[1] === 'users'));
  });

  it('organization admin migration is reversible without retaining an unknown role', () => {
    const migration = require('../migrations/1699000000015_organization_admin_role');
    const calls = [];
    const pgm = new Proxy({}, {
      get(_target, property) {
        return (...args) => calls.push([property, ...args]);
      },
    });
    migration.up(pgm);
    migration.down(pgm);
    assert.ok(calls.some(call => call[0] === 'addConstraint' && /org_admin/.test(String(call[3]))));
    assert.ok(calls.some(call => call[0] === 'sql' && /UPDATE users SET role = 'PI'/.test(call[1])));
  });

  it('locks session creation and checks tenant scope before insert', () => {
    const sessionsSource = fs.readFileSync(
      path.resolve(__dirname, '../routes/sessions.js'),
      'utf8'
    );
    const ingestSource = fs.readFileSync(
      path.resolve(__dirname, '../routes/ingest.js'),
      'utf8'
    );
    const projectSource = fs.readFileSync(
      path.resolve(__dirname, '../routes/projects.js'),
      'utf8'
    );
    assert.match(sessionsSource, /lockSessionKey\(client, session_id\)/);
    assert.match(sessionsSource, /FOR UPDATE/);
    assert.match(ingestSource, /FOR UPDATE OF s/);
    assert.match(ingestSource, /storedSession\.invitation_id/);
    assert.match(projectSource, /const userParam = i/);
    assert.match(projectSource, /const projectParam = i \+ 1/);
  });
});
