'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { isEmail } = require('validator');
const seed = require('../scripts/seed-analytics-lab');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const { validatePhysiologyIntervals } = require('../security/physiology-intervals');
const { assertPublishedSurveyResponses } = require('../security/survey-admission');
const { validateProtocolAois } = require('../../web/aoi-protocol');
const { validateAnalyticsQuery } = require('../analytics/query');
const { buildSessionMetrics, channelQc } = require('../analytics/metrics');
const { buildDescriptiveComparison } = require('../analytics/comparisons');
const { eventsToRtJsonl } = require('../rt/event_adapter');
const { sessionVersion } = require('../analytics/protocol-versions');

const safeEnv = () => ({ NODE_ENV: 'test', ANALYTICS_LAB_ISOLATED: 'YES',
  DATABASE_URL: 'postgresql://fixture:private@127.0.0.1:5432/analytics_lab_test',
  ANALYTICS_LAB_DATABASE_URL: 'postgresql://fixture:private@127.0.0.1:5432/analytics_lab_test',
  ANALYTICS_LAB_API_BASE: 'http://127.0.0.1:3012', ANALYTICS_LAB_FIXTURE: '/test-output/analytics-lab.json' });
let records;
test.before(async () => { records = await seed.createSyntheticSessions(); });

test('import is inert even with production environment and credential-looking variables', () => {
  const script = require.resolve('../scripts/seed-analytics-lab');
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(script)}); if (require.cache[require.resolve('pg')]) process.exit(9);`],
    { cwd: path.dirname(script), env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgres://do-not-connect@remote/production' }, encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});

test('requires every explicit guard before touching a fixture, DB or API', async () => {
  for (const key of ['NODE_ENV', 'ANALYTICS_LAB_ISOLATED', 'DATABASE_URL', 'ANALYTICS_LAB_DATABASE_URL',
    'ANALYTICS_LAB_API_BASE', 'ANALYTICS_LAB_FIXTURE']) {
    const env = safeEnv(); delete env[key];
    assert.throws(() => seed.assertSafetyGuards(env), /analytics_lab_/);
    await assert.rejects(seed.main(env), /analytics_lab_/);
  }
  for (const [key, value] of [['NODE_ENV', 'production'], ['ANALYTICS_LAB_ISOLATED', 'yes'],
    ['ANALYTICS_LAB_DATABASE_URL', 'postgres://other@localhost/other_test'], ['ANALYTICS_LAB_FIXTURE', './fixture.json'],
    ['ANALYTICS_LAB_FIXTURE', '/test-output/../fixture.json'], ['ANALYTICS_LAB_SEED', '-1'], ['ANALYTICS_LAB_SEED', '4294967296']]) {
    assert.throws(() => seed.assertSafetyGuards({ ...safeEnv(), [key]: value }), /analytics_lab_/);
  }
});

test('DB guard rejects remote/production/query overrides and only accepts exact loopback *_test URLs', () => {
  for (const url of ['postgres://u@db/analytics_test', 'postgres://u@192.168.1.1/analytics_test',
    'postgres://u@127.0.0.2/analytics_test', 'postgres://u@localhost/production', 'postgres://u@localhost/test',
    'postgres://u@localhost/analytics_test?host=remote', 'postgres://u@localhost/analytics_test#fragment',
    'postgres://u@localhost/%61nalytics_test', 'http://localhost/analytics_test',
    'postgres://u@localhost/analytics_test/extra']) {
    const env = { ...safeEnv(), DATABASE_URL: url, ANALYTICS_LAB_DATABASE_URL: url };
    assert.throws(() => seed.assertSafetyGuards(env), /analytics_lab_loopback_test_database_required/);
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `postgresql://fixture@${host}:5432/emocog_lab_test`;
    assert.equal(seed.assertSafetyGuards({ ...safeEnv(), DATABASE_URL: url, ANALYTICS_LAB_DATABASE_URL: url }).databaseName, 'emocog_lab_test');
  }
});

test('API guard has no old-port fallback, disallows credentials, redirects-by-base and nonlocal targets', () => {
  for (const api of ['', 'https://127.0.0.1:3012', 'http://remote:3012', 'http://localhost.evil:3012',
    'http://u:p@localhost:3012', 'http://localhost:3012/api', 'http://localhost:3012/?target=remote', 'http://localhost:3012/#x']) {
    assert.throws(() => seed.assertSafetyGuards({ ...safeEnv(), ANALYTICS_LAB_API_BASE: api }), /analytics_lab_explicit_loopback_api_required/);
  }
  for (const api of ['http://localhost:3000', 'http://127.0.0.1:3012', 'http://[::1]:3012']) {
    assert.equal(seed.assertSafetyGuards({ ...safeEnv(), ANALYTICS_LAB_API_BASE: api }).apiBase, api);
  }
});

test('CLI guard failure never discloses URL credentials or creates output', () => {
  const child = spawnSync(process.execPath, [require.resolve('../scripts/seed-analytics-lab')],
    { env: { ...safeEnv(), NODE_ENV: 'production', DATABASE_URL: 'postgres://fixture:SECRET_SENTINEL@remote/production' }, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /failed closed/);
  assert.doesNotMatch(child.stderr, /SECRET_SENTINEL|postgres:|stack|password_hash/);
});

test('private fixture is 0600, exclusive, never follows links, and does not retain old tail bytes', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'analytics-lab-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'fixture.json');
  const file = await seed.openPrivateFixture(filename);
  await seed.writeFixture(file, { users: { researcher: { password: 'PRIVATE_TEST_SENTINEL' } }, lengthy: 'x'.repeat(1024) });
  await seed.writeFixture(file, { status: 'complete' });
  await file.close();
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { status: 'complete' });
  await assert.rejects(seed.openPrivateFixture(filename), { code: 'EEXIST' });
  await fs.symlink(filename, path.join(root, 'linked.json'));
  await assert.rejects(seed.openPrivateFixture(path.join(root, 'linked.json')));
  await fs.symlink(root, path.join(root, 'parent-link'));
  await assert.rejects(seed.openPrivateFixture(path.join(root, 'parent-link', 'new.json')), /symlink/);
  assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { status: 'complete' });
});

test('default data is deterministic, named, repeated and balanced without DB dependencies', async () => {
  assert.deepEqual(await seed.createSyntheticSessions(), records);
  const altered = await seed.createSyntheticSessions({ seed: seed.DEFAULT_SEED + 1 });
  assert.notEqual(records[0].payload.cognitiveResults[0].rt, altered[0].payload.cognitiveResults[0].rt);
  const participants = new Map();
  for (const record of records) {
    if (!participants.has(record.participantId)) participants.set(record.participantId, []);
    participants.get(record.participantId).push(record);
    assert.match(record.participantId, /^SYN_[AB]_[A-Za-z]+$/);
    assert.equal(record.participantName.length > 0, true);
    assert.match(record.payload.experimentMeta.source, /synthetic/);
    assert.equal(record.payload.quality_assessment.independentlyValidated, false);
    for (const item of record.payload.gaze_analytics.presentations) {
      assert.ok(item.fixationPoints.reduce((sum, fixation) => sum + fixation.durationMs, 0) <= item.validObservationDurationMs);
    }
  }
  assert.equal(records.length, 40);
  assert.equal(participants.size, 20);
  assert.equal([...participants.values()].filter(rows => rows[0].group === 'A').length, 10);
  for (const rows of participants.values()) {
    assert.deepEqual(rows.map(row => row.visit), [1, 2]);
    assert.equal(rows.reduce((sum, row) => sum + row.payload.cognitiveResults.filter(trial => trial.qualityIssueCodes.length === 0 || row.profile === 'low_qc').length, 0) >= 60, true);
    assert.deepEqual(rows[0].payload.experimentMeta.presentationPlan.blocks, rows[1].payload.experimentMeta.presentationPlan.blocks);
  }
  for (const count of [0, 15, 25, 20.5]) await assert.rejects(seed.createSyntheticSessions({ participantCount: count }));
  for (const value of [-1, 1.5, NaN, Infinity, 0x100000000]) await assert.rejects(seed.createSyntheticSessions({ seed: value }));
});

test('protocol publishes with real preflight, supported shells, standard AOIs and current survey types', async () => {
  const definition = seed.createProtocolDefinition();
  const { inspectProtocolPreflight } = await import('../../shared/protocol-preflight.mjs');
  const report = inspectProtocolPreflight(definition);
  assert.deepEqual(report.errors, []);
  assert.equal(report.scientificValidation, 'not_established');
  assert.equal(definition.title, seed.LAB_NAME);
  assert.deepEqual(definition.blocks.map(block => block.id), ['baseline', 'practice', 'main', 'conditional', 'nogo', 'survey', 'audio', 'rest']);
  assert.equal(definition.blocks[0].type, 'rest');
  assert.deepEqual(validateProtocolAois(definition).errors, []);
  assert.equal(definition.participantShell.consent, true);
  assert.equal(definition.blocks.find(b => b.id === 'nogo').blockConfig.selected_metrics.includes('commission_rate'), true);
  const manifest = seed.createStimulusManifest(definition);
  assert.deepEqual([manifest.std_simple_black_square.intrinsicWidth, manifest.std_simple_black_square.intrinsicHeight], [512, 512]);
  for (const record of records) for (const presentation of record.payload.gaze_analytics.presentations) {
    const descriptor = manifest[presentation.stimulusId];
    assert.equal(presentation.intrinsicWidth, descriptor.intrinsicWidth);
    assert.equal(presentation.intrinsicHeight, descriptor.intrinsicHeight);
    assert.equal(presentation.stimulusType, descriptor.type);
    for (const point of presentation.fixationPoints) {
      assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
      assert.ok(point.startMs >= 0 && point.startMs + point.durationMs <= 2000);
    }
  }
});

test('every wire packet passes the existing closed schema and has bounded, ordered event clocks', () => {
  const definition = seed.createProtocolDefinition();
  for (const record of records) {
    const { payload, sourceData } = record;
    assert.deepEqual(validateSessionFeaturePayload(payload), []);
    assert.deepEqual(validatePhysiologyIntervals(payload.physiology_intervals), []);
    assert.doesNotThrow(() => assertPublishedSurveyResponses(payload.events, definition));
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 1750 * 1024);
    assert.ok(payload.events.length <= 250);
    const times = sourceData.events.map(event => event.monotonicMs);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    for (const event of sourceData.events) assert.equal(event.timestamp, sourceData.startTime + event.tRelMs);
    assert.equal(sourceData.lifecycle.completedAt - sourceData.startTime, payload.physiology_intervals.throughMs);
    assert.doesNotMatch(JSON.stringify(payload), /"(?:rawVideo|rawAudio|pcmSamples|landmarks|password|email)"\s*:/);
    assert.equal(payload.audio_summary.rawAudioStored, false);
    assert.equal(payload.audio_summary.rawAudioTransmitted, false);
  }
});

test('trial identity, go/nogo scoring, conditional target maps, omissions and errors stay aligned', () => {
  const definition = seed.createProtocolDefinition();
  for (const record of records) {
    const { cognitiveResults, experimentMeta, gaze_analytics } = record.payload;
    assert.equal(new Set(cognitiveResults.map(row => row.presentationId)).size, cognitiveResults.length);
    assert.ok(cognitiveResults.some(row => row.rt === null && row.correct === false && row.condition !== 'nogo'));
    assert.ok(cognitiveResults.some(row => row.response !== null && row.correct === false));
    assert.ok(cognitiveResults.some(row => row.condition === 'nogo' && row.correct && row.response === null));
    assert.ok(cognitiveResults.some(row => row.condition === 'nogo' && !row.correct && row.response !== null));
    for (const row of cognitiveResults) {
      const trial = definition.blocks.find(block => block.id === row.blockId).trials.find(trial => trial.id === row.trialId);
      assert.equal(row.expectedResponse, trial.correctResponse);
      const actual = experimentMeta.presentationPlan.actual.find(item => item.presentationId === row.presentationId);
      assert.equal(actual.trialId, row.trialId);
      assert.equal(actual.stimulusOnPerfMs, row.onsetMs);
      assert.ok(actual.stimulusOffPerfMs <= actual.stimulusOnPerfMs + 2016);
      assert.equal(actual.stimulusOffEpochMs, row.timestamp);
      const gaze = gaze_analytics.presentations.find(item => item.presentationId === row.presentationId);
      assert.equal(gaze.attempt, row.attempt);
      if (row.rt !== null) assert.ok(row.rt >= 0 && row.rt <= actual.effectiveStimulusDurationMs);
    }
  }
  const rows = records[2].payload.cognitiveResults;
  const nogo = eventsToRtJsonl(records[2].payload.events.filter(event => event.blockId === 'nogo'), rows.filter(row => row.blockId === 'nogo'), { blockId: 'nogo', taskType: 'go_nogo' });
  assert.equal(nogo.events.filter(event => event.event_type === 'stimulus_on' && event.is_go === false).length, 4);
  const conditional = eventsToRtJsonl([], rows.filter(row => row.blockId === 'conditional'), { blockId: 'conditional', taskType: 'flanker' });
  assert.deepEqual(new Set(conditional.events.filter(event => event.event_type === 'stimulus_on').map(event => event.expected_response)), new Set(['left', 'right']));
});

test('presentation plans restore against actual protocol and retain deviations plus rejected attempts', async () => {
  const { restorePresentationPlan } = await import('../../participant-web/js/session-runtime/presentation-plan.mjs');
  for (const record of records) {
    const plan = record.payload.experimentMeta.presentationPlan;
    assert.doesNotThrow(() => restorePresentationPlan(plan, seed.createProtocolDefinition().blocks));
    assert.ok(plan.actual.some(item => item.deviations.includes('synthetic_scheduler_delay')));
    const sequence = plan.actual.map(item => item.sequence);
    assert.deepEqual(sequence, Array.from({ length: sequence.length }, (_, i) => i + 1));
  }
  assert.equal(records[0].payload.cognitiveResults.filter(row => row.trialId === 'main-trial-1').length, 2);
  assert.equal(records[0].payload.cognitiveResults.find(row => row.trialId === 'main-trial-1').qualityValid, false);
});

test('physiology uses real reducer with warmup, minute boundaries and no held/rejected/missing coverage', async () => {
  const { PhysiologyIntervals } = await import('../../participant-web/js/session-runtime/physiology-intervals.mjs');
  for (const record of records) {
    const data = record.payload.physiology_intervals;
    assert.equal(data.minutes.length, Math.ceil(data.throughMs / 60000));
    const fresh = record.observations.physiologySamples.filter(sample => sample.kind === 'fresh');
    assert.equal(data.minutes.reduce((sum, row) => sum + row.heartRate.count, 0), fresh.length);
    assert.equal(data.minutes.reduce((sum, row) => sum + row.respiration.count, 0), fresh.length);
    assert.ok(record.observations.physiologySamples.some(sample => sample.kind === 'missing'));
    if (record.profile === 'complete') {
      assert.ok(record.observations.physiologySamples.some(sample => sample.kind === 'held'));
      assert.ok(record.observations.physiologySamples.some(sample => sample.kind === 'rejected'));
    }
  }
  const original = records[0];
  const replay = new PhysiologyIntervals();
  for (const block of original.payload.physiology_intervals.blocks) {
    replay.beginBlock(block, block.startMs);
    for (const sample of original.observations.physiologySamples.filter(sample => sample.blockId === block.blockId && sample.attempt === block.attempt)) {
      replay.record(sample.ms, sample, 10000, 20000);
    }
    replay.endBlock(block.status, block.endMs);
  }
  assert.deepEqual(replay.snapshot(), original.payload.physiology_intervals);
  assert.ok(original.payload.physiology_intervals.blocks.some(block => block.status === 'repeat_required'));
});

test('real analytics computes median RT and honest no_data without overwriting source observations', () => {
  const query = seed.dashboardSelection(1, 2, 1, 3, records).query;
  const toRow = (record, i) => ({ id: i + 1, participant_id: record.participantId, features_payload: record.payload });
  const complete = toRow(records[2], 2), missing = toRow(records.find(row => row.profile === 'missing'), 30);
  const before = JSON.stringify(complete.features_payload);
  const metrics = buildSessionMetrics(complete, query);
  assert.ok(metrics.find(metric => metric.metricId === 'task.rt_median_ms').value > 0);
  assert.ok(metrics.find(metric => metric.metricId === 'physiology.bpm_mean').value > 45);
  const absent = buildSessionMetrics(missing, query);
  assert.equal(absent.find(metric => metric.metricId === 'physiology.bpm_mean').status, 'no_data');
  assert.equal(absent.find(metric => metric.metricId === 'physiology.respiration_mean').value, null);
  assert.equal(channelQc(toRow(records.find(row => row.profile === 'low_qc'), 31), 'gaze').status, 'invalid');
  assert.equal(JSON.stringify(complete.features_payload), before);
  assert.ok(records[0].payload.blink_summary.amplitude.mean > 0);
  assert.ok(records[0].payload.body_pose_summary.shoulderRollAbsMeanDeg > 0);
  assert.ok(records[0].payload.emotion_summary.n > 0);
  assert.ok(records[0].payload.rt_alignment.trials.length >= 30);
});

test('audio retains acoustic biomarkers and rejected-window QC; missing is not a plausible zero', () => {
  for (const record of records) {
    const audio = record.payload.audio_summary;
    assert.equal(audio.windowCount, audio.windows.length);
    assert.equal(audio.acceptedWindowCount + audio.rejectedWindowCount, audio.windowCount);
    assert.equal(audio.algorithmVersion, 'analytics-lab-synthetic.v1');
    for (const window of audio.windows) {
      assert.equal(window.durationMs, window.sessionEndMs - window.sessionStartMs);
      assert.equal(window.qc.valid, window.accepted);
      assert.equal(window.blockId, 'audio');
      assert.equal(window.accepted ? window.biomarkers.pitch_mean_hz > 0 : window.biomarkers.pitch_mean_hz === null, true);
    }
    if (record.profile === 'missing') assert.deepEqual([audio.windowCount, audio.qualityMean], [0, null]);
  }
});

test('survey numeric text is explicitly distinguished from ordinal options and validates published answers', () => {
  const event = records[0].payload.events.find(event => event.type === 'survey_response');
  assert.equal(event.responses[0].responseType, 'single');
  assert.match(event.responses[0].value, /^level_[1-9]$/);
  assert.equal(event.responses[1].responseType, 'open');
  assert.ok(Number.isFinite(Number(event.responses[1].value)));
  const invalid = structuredClone(event); invalid.responses[1].value = 3;
  assert.throws(() => assertPublishedSurveyResponses([invalid], seed.createProtocolDefinition()));
  invalid.responses[1].value = '3'; invalid.responses[0].value = '10';
  assert.throws(() => assertPublishedSurveyResponses([invalid], seed.createProtocolDefinition()));
});

test('binding is immutable from input perspective and publication:1 resolves with validated selection metadata', async () => {
  const source = records[0].sourceData, before = JSON.stringify(source);
  const payload = await seed.buildIngestPayload(source, { projectId: 11, protocolId: 22, publicationVersion: 1,
    invitationCode: 'SYNTHETIC-CODE', sessionId: 'lab-bound-session' });
  assert.equal(JSON.stringify(source), before);
  assert.equal(payload.ids.session, 'lab-bound-session');
  assert.equal(payload.ids.invitationCode, 'SYNTHETIC-CODE');
  assert.equal(payload.experimentMeta.publicationVersion, 1);
  assert.equal(payload.lifecycle.finishAttemptId, 'lab-bound-session-finish');
  assert.ok(payload.events.every(event => event.sessionId === payload.ids.session));
  assert.equal(sessionVersion({ publication_version: 1, invitation_id: 7 }), 'publication:1');
  const dashboard = seed.dashboardSelection(11, 22, 1, 33, records);
  assert.equal(validateAnalyticsQuery(dashboard.query).ok, true);
  assert.equal(dashboard.query.protocolVersion, 'publication:1');
  assert.equal(dashboard.localStorage.emocog_selected_project_id, '11');
  assert.equal(dashboard.localStorage.emocog_selected_protocol_id, '22');
  assert.equal(dashboard.requiresLandingIntegration, true);
  assert.equal(dashboard.groups.A.length, 10);
  const comparison = buildDescriptiveComparison(records.map((row, i) => ({ id: i + 1, participant_id: row.participantId, features_payload: row.payload })),
    { ...dashboard.query, comparison: { design: 'independent', axis: 'participants', metricId: 'task.rt_median_ms',
      referenceParticipantIds: dashboard.groups.A, comparisonParticipantIds: dashboard.groups.B } });
  assert.ok(comparison);
});

test('closed schema is still strict for hidden biometric or invented survey payloads', () => {
  for (const mutate of [
    p => { p.audio_summary.windows[0].pcmSamples = [1, 2]; },
    p => { p.cognitiveResults[0].inventedScore = 7; },
    p => { p.body_pose_summary.landmarks = []; },
    p => { p.experimentMeta.syntheticMetadata = { arbitrary: true }; },
  ]) {
    const payload = structuredClone(records[0].payload); mutate(payload);
    assert.ok(validateSessionFeaturePayload(payload).length > 0);
  }
});

test('HTTP client rejects redirects, foreign bases and response-body secret leakage', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/secret' }); res.end(); }
    else { res.writeHead(422, { 'content-type': 'application/json' }); res.end(JSON.stringify({ token: 'DO_NOT_ECHO_SENTINEL' })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(seed.apiRequest(base, '/redirect'));
  await assert.rejects(seed.apiRequest(base, '/secret'), error => error.message === 'analytics_lab_http_422');
  await assert.rejects(seed.apiRequest(base, '//remote/secret'), /invalid_api_route/);
  await assert.rejects(seed.apiRequest('http://remote:3000', '/secret'), /explicit_loopback_api_required/);
});

test('main orchestration uses real routes, never SQL-publishes, verifies bindings and writes credentials only privately', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'analytics-lab-main-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pg = require('pg'), bcrypt = require('bcryptjs');
  const OriginalClient = pg.Client;
  t.after(() => { pg.Client = OriginalClient; });
  const { inspectProtocolPreflight } = await import('../../shared/protocol-preflight.mjs');
  const accounts = new Map(), protocols = new Map(), invites = new Map(), persisted = new Map();
  const routes = [], sql = [];
  let nextId = 100;
  pg.Client = class FakeClient {
    async connect() {}
    async end() {}
    async query(statement, args = []) {
      const q = statement.replace(/\s+/g, ' ').trim(); sql.push(q);
      const result = rows => ({ rows, rowCount: rows.length });
      if (q === 'SELECT current_database() AS name') return result([{ name: 'analytics_lab_test' }]);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return result([]);
      if (q.startsWith('INSERT INTO users')) {
        const id = nextId++; accounts.set(args[0], { id, email: args[0], hash: args[1] });
        return result([{ id }]);
      }
      if (/^INSERT INTO (organizations|projects)\(/.test(q)) return result([{ id: nextId++ }]);
      if (/^INSERT INTO user_(organizations|projects)\(/.test(q)) return result([]);
      if (q.startsWith('SELECT protocol_definition')) {
        const invite = invites.get(args[0]);
        assert.equal(invite.protocol_id, args[1]);
        return result([{ protocol_definition: protocols.get(args[1]).definition, publication_version: 1 }]);
      }
      if (q.startsWith('UPDATE sessions SET started_at=')) {
        const row = persisted.get(args[1]);
        assert.deepEqual([row.invitation_id, row.project_id, row.protocol_id], args.slice(2));
        assert.equal(row.stopped_at, undefined);
        row.started_at = args[0];
        return result([{ id: row.id }]);
      }
      if (q.startsWith('SELECT s.id, s.project_id')) return result([persisted.get(args[0])]);
      throw new Error('Unexpected mock SQL: ' + q);
    }
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const route = new URL(url).pathname;
    routes.push(route);
    assert.equal(new URL(url).origin, 'http://127.0.0.1:3012');
    assert.equal(options.redirect, 'error');
    const body = options.body ? JSON.parse(options.body) : null;
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (route === '/health') return json({ node_env: 'test' });
    if (route === '/ready') return json({ status: 'ready' });
    if (route === '/auth/login') {
      assert.equal(isEmail(body.email), true);
      const account = accounts.get(body.email);
      assert.equal(await bcrypt.compare(body.password, account.hash), true);
      return json({ user: { id: account.id, email: account.email }, token: 'PRIVATE_STAFF_TOKEN_SENTINEL' });
    }
    if (route === '/protocols') {
      assert.deepEqual(inspectProtocolPreflight(body.definition).errors, []);
      assert.equal(body.save_mode, 'publish');
      const row = { id: nextId++, project_id: body.project_id, definition: body.definition, updated_at: '2026-11-12T00:00:00.000Z' };
      protocols.set(row.id, row);
      return json(row, 201);
    }
    if (route === '/invitations') {
      assert.ok(protocols.has(body.protocol_id));
      const id = nextId++;
      const row = { id, protocol_id: body.protocol_id, code: `synthetic-invite-${id}`, publication_version: 1 };
      invites.set(id, row);
      return json(row, 201);
    }
    if (route.endsWith('/ingest-token')) {
      const code = route.split('/')[3], invite = [...invites.values()].find(row => row.code === code);
      const protocol = protocols.get(invite.protocol_id);
      assert.equal(body.consent_receipt.informedConsentVersion, 'informed-consent-v1.0');
      assert.equal(persisted.has(body.session_id), false);
      persisted.set(body.session_id, { id: nextId++, invitation_id: invite.id, project_id: protocol.project_id,
        protocol_id: protocol.id, publication_version: 1 });
      return json({ admitted: true, session_created: true, session_id: body.session_id, token: `PRIVATE_PARTICIPANT_TOKEN_${body.session_id}` });
    }
    if (route === '/ingest') {
      const row = persisted.get(body.ids.session);
      assert.deepEqual(validateSessionFeaturePayload(body), []);
      assertPublishedSurveyResponses(body.events, protocols.get(row.protocol_id).definition);
      assert.equal(body.experimentMeta.publicationVersion, 1);
      assert.equal(options.headers['Idempotency-Key'], body.lifecycle.finishAttemptId);
      row.payload = body; row.stopped_at = new Date(body.lifecycle.completedAt);
      assert.ok(row.started_at <= row.stopped_at);
      return json({ session_id: body.ids.session });
    }
    throw new Error('Unexpected mock route');
  });
  const fixturePath = path.join(root, 'fixture.json');
  const fixture = await seed.main({ ...safeEnv(), ANALYTICS_LAB_FIXTURE: fixturePath });
  assert.equal(fixture.status, 'complete');
  assert.equal(fixture.sessions.length, 40);
  assert.equal(persisted.size, 41);
  assert.equal(routes.filter(route => route === '/protocols').length, 2);
  assert.equal(routes.filter(route => route === '/invitations').length, 2);
  assert.equal(sql.some(q => /(?:INSERT|UPDATE).*?(?:protocols|invitations|protocol_publications)/.test(q)), false);
  assert.equal(sql.some(q => /\bDELETE\b|\bTRUNCATE\b/.test(q)), false);
  assert.ok(sql.every(q => !q.startsWith('UPDATE ') || q.startsWith('UPDATE sessions SET started_at=')));
  assert.equal((await fs.stat(fixturePath)).mode & 0o777, 0o600);
  const encoded = await fs.readFile(fixturePath, 'utf8'), written = JSON.parse(encoded);
  assert.equal(written.users.researcher.email.endsWith('@example.test'), true);
  for (const account of Object.values(written.users)) {
    assert.equal(isEmail(account.email), true);
    assert.ok(Buffer.byteLength(account.email.split('@')[0], 'utf8') <= 64);
  }
  assert.equal(written.users.researcher.password.length >= 40, true);
  assert.notEqual(written.users.researcher.password, written.users.otherResearcher.password);
  assert.doesNotMatch(encoded, /PRIVATE_STAFF_TOKEN_SENTINEL|PRIVATE_PARTICIPANT_TOKEN_/);
  assert.equal(written.query.protocolVersion, 'publication:1');
  assert.equal(written.dashboard.requiresLandingIntegration, true);
  assert.equal(written.surveySemantics.sleepiness.kind, 'ordinal');
  assert.equal(written.surveySemantics.pleasantness.kind, 'numeric');
});

// Opt-in only: never inherits the ordinary integration suite's database flags.
test('isolated real API persists publications, sessions and foreign-tenant negative fixtures', {
  skip: process.env.ANALYTICS_LAB_RUN_INTEGRATION !== 'YES', timeout: 180000,
}, async () => {
  const fixture = await seed.main();
  assert.equal(fixture.status, 'complete');
  assert.equal(fixture.publicationVersion, 1);
  assert.equal(fixture.sessions.length, 40);
  assert.notEqual(fixture.projectId, fixture.otherProjectId);
  assert.notEqual(fixture.organizationId, fixture.otherOrganizationId);
  assert.equal(fixture.publishedDefinition.blocks.length, 8);
  assert.ok(fixture.sessions.every(row => row.publicationVersion === 1 && row.sessionDbId > 0));
  const login = await seed.apiRequest(fixture.apiBase, '/auth/login', { body: {
    email: fixture.users.researcher.email, password: fixture.users.researcher.password } });
  await seed.apiRequest(fixture.apiBase, `/protocols/${fixture.otherProtocolId}`, { token: login.token, expected: [403, 404] });
  const snapshot = await seed.apiRequest(fixture.apiBase, '/analytics/v1/snapshots', { token: login.token, body: fixture.query });
  assert.ok(snapshot.id);
  assert.ok(snapshot.includedSessionIds.length > 0);
});
