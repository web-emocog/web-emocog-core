const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { buildGroupSummary, buildSessionMetrics, buildExportBundle } = require('../analytics/metrics');
const { buildReproducibilityExport } = require('../export/reproducibility');

const METRIC = 'physiology.respiration_mean';
const CURRENT = 'respiration_luma.log_peak.v2';
const PREVIOUS = 'respiration_luma.log_peak.v1';
const query = {
  mode: 'group', projectId: 1, protocolId: 2, protocolVersion: '1.0', metricIds: [METRIC],
  filters: { participantIds: [], sessionIds: [], groupIds: [], conditionIds: [], blockIds: [], stimulusIds: [],
    aoiIds: [], deviceClasses: [], qcChannels: ['respiration'], qcMode: 'all', includeIncompleteSessions: true },
};

function session(id, participant, value, methodVersion = CURRENT, count = 1) {
  return { id, session_id: `method-review-${id}`, participant_id: participant, project_id: 1, protocol_id: 2,
    started_at: '2026-11-07T10:00:00.000Z', stopped_at: '2026-11-07T10:01:00.000Z', qc_validity: 'valid',
    features_payload: { respiration_summary: { resp_rate_mean: value, resp_sample_count: count,
      resp_available: true, methodVersion } } };
}

const groupMetric = rows => buildGroupSummary(rows, query).metrics[0];

function measurements(metric) {
  const { algorithm, participantValues, ...rest } = metric;
  return { ...rest, participantValues: [...participantValues].sort((a, b) => a.participantId.localeCompare(b.participantId)) };
}

test('a homogeneous group preserves the recorded method and existing participant-equal weights', () => {
  const rows = [session(1, 'a', 12, CURRENT, 10), session(2, 'a', 18, CURRENT, 90), session(3, 'b', 24)];
  const metric = groupMetric(rows);
  assert.deepEqual(metric.algorithm, buildSessionMetrics(rows[0], query)[0].algorithm);
  assert.equal(metric.algorithm.version, CURRENT);
  assert.equal(metric.mean, 19.5);
  assert.equal(metric.median, 19.5);
  assert.equal(metric.nParticipants, 2);
  assert.equal(metric.nObservations, 101);
  assert.equal(metric.denominator, 101);
  assert.deepEqual(metric.participantValues.map(row => [row.participantId, row.value]), [['a', 15], ['b', 24]]);
});

test('mixed group provenance is explicit and invariant under every session ordering', () => {
  const rows = [session(1, 'a', 12, PREVIOUS, 10), session(2, 'a', 18, CURRENT, 90), session(3, 'b', 24)];
  const saved = structuredClone(rows);
  const homogeneous = rows.map(row => ({ ...row, features_payload: { respiration_summary: {
    ...row.features_payload.respiration_summary, methodVersion: CURRENT,
  } } }));
  const expectedMeasurements = measurements(groupMetric(homogeneous));
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  let expectedAlgorithm;
  for (const order of permutations) {
    const metric = groupMetric(order.map(index => rows[index]));
    assert.equal(metric.algorithm.version, 'mixed_versions');
    assert.match(metric.algorithm.parametersHash, /^sha256:[a-f0-9]{64}$/);
    expectedAlgorithm ??= metric.algorithm;
    assert.deepEqual(metric.algorithm, expectedAlgorithm);
    assert.deepEqual(measurements(metric), expectedMeasurements);
  }
  const changed = structuredClone(rows);
  changed[0].features_payload.respiration_summary.methodVersion = 'respiration_luma.log_peak.v0';
  assert.notEqual(groupMetric(changed).algorithm.parametersHash, expectedAlgorithm.parametersHash);
  assert.deepEqual(rows, saved);
});

test('missing historical methods stay legacy; legacy plus a known method is explicitly mixed', () => {
  const legacy = session(1, 'a', 12, null);
  const absent = session(2, 'b', 18);
  delete absent.features_payload.respiration_summary.methodVersion;
  assert.equal(groupMetric([legacy, absent]).algorithm.version, 'legacy_summary');
  const known = session(3, 'c', 24);
  const forward = groupMetric([legacy, known]);
  assert.equal(forward.algorithm.version, 'mixed_versions');
  assert.deepEqual(forward.algorithm, groupMetric([known, legacy]).algorithm);
  assert.equal(forward.mean, 18);
});

test('different methods within one participant are not hidden by within-participant averaging', () => {
  const rows = [session(1, 'a', 12, PREVIOUS), session(2, 'a', 18)];
  const metric = groupMetric(rows);
  assert.equal(metric.nParticipants, 1);
  assert.equal(metric.mean, 15);
  assert.equal(metric.algorithm.version, 'mixed_versions');
  assert.deepEqual(metric.algorithm, groupMetric([...rows].reverse()).algorithm);
});

test('unavailable session values do not contaminate the method of contributing measurements', () => {
  const missing = session(1, 'a', null, PREVIOUS, 0);
  const known = session(2, 'b', 18);
  const expected = groupMetric([known]);
  for (const rows of [[missing, known], [known, missing]]) {
    const metric = groupMetric(rows);
    assert.deepEqual(metric.algorithm, expected.algorithm);
    assert.equal(metric.mean, expected.mean);
    assert.equal(metric.nParticipants, 1);
  }
});

test('already mixed recordings remain explicitly mixed and empty legacy groups do not invent a known method', () => {
  const methodVersion = 'respiration_luma.mixed_versions';
  assert.equal(groupMetric([session(1, 'a', 12, methodVersion)]).algorithm.version, methodVersion);
  assert.equal(groupMetric([session(2, 'a', null, null, 0)]).algorithm.version, 'legacy_summary');
  assert.equal(groupMetric([]).algorithm.version, 'legacy_summary');
});

test('group summary and long analytics exports carry the same mixed method provenance', () => {
  const rows = [session(1, 'a', 12, PREVIOUS), session(2, 'b', 18)];
  const expected = groupMetric(rows).algorithm;
  const snapshot = { queryEcho: query, versions: {}, excludedSessions: [],
    includedParticipantIds: ['a', 'b'], includedSessionIds: [1, 2] };
  const bundle = buildExportBundle({ snapshot, sessionRows: rows, protocol: { definition: { blocks: [] } } }, 'both');
  assert.equal(expected.version, 'mixed_versions');
  assert.deepEqual(bundle.summary.group.metrics[0].algorithm, expected);
  assert.deepEqual(bundle.longData.find(row => row.sourceKind === 'group_summary').algorithm, expected);
});

test('RT-aligned windows retain their own sanitized condition across scopes and channels', () => {
  const conditions = ['go', 'no_go', 0, undefined, 'private@example.test'];
  const source = { id: 1, session_id: 'rt-condition-review', project_id: 1, protocol_id: 2,
    features_payload: { rt_alignment: { algorithmVersion: 'event-windows-1.1.0', clock: 'monotonic_ms',
      trials: conditions.map((condition, index) => ({ blockId: 'b1', trialId: `t${index}`, stimulusId: 's1',
        attempt: 1, qualityValid: true, condition,
        windows: Object.fromEntries(['baseline', 'response', 'post'].map(scope => [scope, {
          startMs: 0, endMs: 1000, channels: {
            bpm: { status: 'observed', value: 80, nValid: 2, validFraction: 1 },
            gaze: { status: 'missing', value: null, nValid: 0, validFraction: 0 },
          },
        }])) })),
    } } };
  const saved = structuredClone(source);
  const selection = { projectId: 1, protocolId: 2, protocolVersion: 'publication:2' };
  const options = { pseudonymKey: 'synthetic-method-review-key', selection };
  const bundle = buildReproducibilityExport([source], options);
  const windows = bundle.rows.filter(row => row.source_kind === 'rt_aligned_window');
  assert.equal(windows.length, 30);
  for (const [index, expected] of ['go', 'no_go', '0', null, null].entries()) {
    const rows = windows.filter(row => row.trial_id === `t${index}`);
    assert.equal(rows.length, 6);
    assert.ok(rows.every(row => row.condition_id === expected));
    assert.deepEqual([...new Set(rows.map(row => row.scope))].sort(), ['baseline', 'post', 'response']);
    for (const row of rows) {
      assert.equal(row.value, row.channel === 'bpm' ? 80 : null);
      assert.equal(row.sample_count, row.channel === 'bpm' ? 2 : 0);
      assert.equal(row.missing_reason, row.channel === 'bpm' ? null : 'signal_data_missing');
    }
  }
  assert.deepEqual(source, saved);
  assert.deepEqual(bundle.selection, selection);
  const { datasetSha256, ...data } = bundle;
  assert.equal(datasetSha256, createHash('sha256').update(JSON.stringify(data)).digest('hex'));
  assert.notEqual(buildReproducibilityExport([source], { ...options, selection: { ...selection, protocolVersion: 'publication:3' } })
    .datasetSha256, datasetSha256);
  const completed = bundle.rows.find(row => row.metric === 'recording.completed');
  assert.equal(completed.value, null);
  assert.equal(completed.missing_reason, 'recording_status_not_recorded');
});

test('physiology interval export preserves per-channel methods, mixed methods and explicit legacy fallback', () => {
  const cases = [
    { heartRate: 'continuous_signals.v2', respiration: CURRENT },
    { heartRate: 'mixed_methods', respiration: 'mixed_methods' },
    { heartRate: undefined, respiration: null },
    { heartRate: 'not a method', respiration: 'https://private.example.test/method' },
    { heartRate: 'continuous_signals.v2', respiration: CURRENT, missing: true },
  ];
  const intervals = block => cases.map((methods, index) => ({
    startMs: index * 60000, endMs: (index + 1) * 60000,
    ...(block ? { blockId: `b${index}`, attempt: index + 1, status: index % 2 ? 'rejected' : 'accepted' } : {}),
    ...Object.fromEntries(['heartRate', 'respiration'].map(channel => [channel, {
      count: methods.missing ? 0 : 2, observedMs: methods.missing ? 0 : 30000,
      mean: methods.missing ? null : channel === 'heartRate' ? 80 : 12,
      ...(methods[channel] === undefined ? {} : { methodVersion: methods[channel] }),
    }])),
  }));
  const physiology = { schemaVersion: 'physiology_intervals.v1', minutes: intervals(false), blocks: intervals(true) };
  const source = { id: 1, session_id: 'interval-method-review', project_id: 1, protocol_id: 2,
    features_payload: { physiology_intervals: physiology } };
  const saved = structuredClone(source);
  const bundle = buildReproducibilityExport([source], { pseudonymKey: 'synthetic-method-review-key' });
  const rows = bundle.rows.filter(row => row.source_kind === 'physiology_interval');
  assert.equal(rows.length, 20);
  for (const scope of ['minute', 'block_attempt']) {
    for (const [index, methods] of cases.entries()) {
      const selected = rows.filter(row => row.scope === scope && row.interval_start_ms === index * 60000);
      assert.equal(selected.length, 2);
      for (const row of selected) {
        const expectedMethod = index === 2 || index === 3 ? 'legacy_summary' : methods[row.channel];
        assert.equal(row.method_version, expectedMethod);
        assert.notEqual(row.method_version, physiology.schemaVersion);
        assert.equal(row.value, methods.missing ? null : row.channel === 'heartRate' ? 80 : 12);
        assert.equal(row.sample_count, methods.missing ? 0 : 2);
        assert.equal(row.observed_ms, methods.missing ? 0 : 30000);
        assert.equal(row.coverage_fraction, methods.missing ? 0 : 0.5);
        assert.equal(row.missing_reason, methods.missing ? 'no_valid_samples' : null);
        if (scope === 'block_attempt') {
          assert.equal(row.block_id, `b${index}`);
          assert.equal(row.attempt, index + 1);
          assert.equal(row.attempt_status, index % 2 ? 'rejected' : 'accepted');
        }
      }
    }
  }
  assert.deepEqual(source, saved);
  assert.equal(physiology.schemaVersion, 'physiology_intervals.v1');
});
