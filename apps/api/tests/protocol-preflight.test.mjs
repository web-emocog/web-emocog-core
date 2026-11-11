import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProtocolPreflight as inspect, PUBLICATION_LIMITS, PHYSIOLOGY_WINDOWS_MS } from '../../shared/protocol-preflight.mjs';
import { DEFAULTS } from '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/config.js';
import { DEFAULT_MEDIA_BUDGET_BYTES } from '../../participant-web/js/session-runtime/media-cache.mjs';
import { DEFAULT_LIMITS } from '../security/payload-policy.js';

const base = () => ({ version: 'v2.0_universal', title: 'Test', testHubMetrics: [],
  settings: { signalProfileId: 'protocol_signals.v2' },
  blocks: [{ id: 'main', type: 'cognitive_task', taskType: 'simple_rt', blockConfig: { useFixation: false },
    trials: [{ stimulusId: 'std_simple_black_square', action: 'KeyD', duration: 1000, repetitions: 2 }] }] });
const codes = report => report.errors.map(item => item.code);

test('preflight is pure, uses real registry keys, reports limitations rather than scientific pass', () => {
  const input = base(), before = JSON.stringify(input), report = inspect(input);
  assert.equal(report.ok, true); assert.equal(report.scientificValidation, 'not_established');
  assert.equal(report.mediaCheck, 'server_check_required');
  assert.equal(report.duration.plannedMaximumMs, 2400);
  assert.ok(report.warnings.some(item => item.code === 'short_physiology_window'));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(inspect(input), report);
});

test('engineering bounds and nominal windows match the actual producer, ingest and physiology implementation', () => {
  assert.equal(PUBLICATION_LIMITS.blocks, DEFAULT_LIMITS.maxBlocks);
  assert.equal(PUBLICATION_LIMITS.trials, DEFAULT_LIMITS.maxCognitiveResults);
  assert.equal(PUBLICATION_LIMITS.mediaBudgetBytes, DEFAULT_MEDIA_BUDGET_BYTES);
  assert.equal(PHYSIOLOGY_WINDOWS_MS.heartRate, DEFAULTS.windowSec * 1000);
  assert.equal(PHYSIOLOGY_WINDOWS_MS.respiration, DEFAULTS.respiration.windowSec * 1000);
});

test('unknown block/task/profile/version and shell-only protocols are hard errors, not fallback examples', () => {
  for (const [change, code] of [
    [p => { p.blocks[0].type = 'baseline'; }, 'block_unsupported'],
    [p => { p.blocks[0].taskType = 'not-real'; }, 'task_unsupported'],
    [p => { p.settings.signalProfileId = 'future'; }, 'signal_profile_unsupported'],
    [p => { p.version = 'v3'; }, 'protocol_version_unsupported'],
    [p => { p.blocks = [{ type: 'precheck' }]; }, 'execution_required'],
    [p => { p.blocks[0].trials = []; }, 'trials_required'],
    [p => { p.blocks = []; }, 'blocks_required']
  ]) { const p = base(); change(p); assert.ok(codes(inspect(p)).includes(code), code); }
});

test('invitation hub tests retain supported tasks; unknown tests cannot be dropped silently', () => {
  const p = base(); p.testHubMetrics = ['vpc', 'visuospatial'];
  assert.equal(inspect(p).ok, true);
  assert.ok(inspect(p).warnings.some(item => item.code === 'gaze_task_research_only'));
  p.testHubMetrics = ['impossible']; assert.ok(codes(inspect(p)).includes('hub_test_unsupported'));
});

test('empty, unknown, browser-only and out-of-range database stimuli cannot be published', () => {
  for (const sid of ['', null, 'std_does_not_exist', '123.456', 'blob:secret', 'https://example.test/a.jpg', '2147483648']) {
    const p = base(); p.blocks[0].trials[0].stimulusId = sid;
    assert.ok(codes(inspect(p)).includes('stimulus_required'), String(sid));
  }
});

test('zero, negative, nonfinite, fractional and overflow durations/repetitions cannot be clamped into valid trials', () => {
  for (const key of ['duration', 'repetitions']) {
    for (const value of [0, -1, 1.5, Infinity, NaN, 'oops', 2147483648]) {
      const p = base(); p.blocks[0].trials[0][key] = value;
      assert.ok(codes(inspect(p)).includes('timing_invalid'), `${key}: ${value}`);
    }
  }
  const p = base(); delete p.blocks[0].trials[0].duration; p.blocks[0].blockConfig.stimulusDuration = -1;
  assert.ok(codes(inspect(p)).includes('timing_invalid'));
});

test('trial count expands repetitions without allocation; boundary allows 5000, warns about retries, rejects 5001', () => {
  const p = base(); p.blocks[0].trials[0].repetitions = 5000;
  assert.equal(inspect(p).ok, true);
  assert.ok(inspect(p).warnings.some(item => item.code === 'retry_payload_capacity'));
  p.blocks[0].trials.push({ stimulusId: 'std_simple_black_square', duration: 1000 });
  assert.ok(codes(inspect(p)).includes('trial_limit'));
  p.blocks = Array.from({ length: 201 }, (_, i) => ({ id: String(i), type: 'instruction' }));
  assert.ok(codes(inspect(p)).includes('block_limit'));
});

test('duplicate block IDs, malformed content, responses and timing ranges fail explicitly', () => {
  const p = base(); p.blocks.push(structuredClone(p.blocks[0]));
  assert.ok(codes(inspect(p)).includes('block_id_invalid'));
  p.blocks.pop(); p.blocks[0].trials[0].action = 'MetaLeft';
  assert.ok(codes(inspect(p)).includes('response_key_unsupported'));
  p.blocks[0].trials[0].responseMode = 'telepathy';
  assert.ok(codes(inspect(p)).includes('response_mode_unsupported'));
  p.blocks[0].trials[0].fixationMin = 500; p.blocks[0].trials[0].fixationMax = 200;
  assert.ok(codes(inspect(p)).includes('timing_range_invalid'));
  p.blocks[0].content = [];
  assert.ok(codes(inspect(p)).includes('block_config_invalid'));
});

test('passive and legacy stimulus list formats use real IDs and timing without fake trials', () => {
  const passive = { version: 'v2', blocks: [{ type: 'passive', content: { slideDuration: 5000, slides: ['std_simple_black_square'] } }] };
  assert.equal(inspect(passive).ok, true); assert.equal(inspect(passive).duration.plannedMaximumMs, 5200);
  passive.blocks[0].content.slideChangeMode = 'manual'; assert.ok(codes(inspect(passive)).includes('manual_slides_unsupported'));
  const legacy = { blocks: [{ type: 'stimuli', params: { stimuli_ids: ['std_simple_black_square'], stimulus_ms: 2000 } }] };
  assert.equal(inspect(legacy).ok, true); assert.equal(inspect(legacy).duration.plannedMaximumMs, 2700);
});

test('rest/audio runtime caps, channel requirements and small windows are explicit', () => {
  const p = base(); p.blocks = [{ type: 'audio_test', content: { durationMs: 12000 } }];
  assert.ok(codes(inspect(p)).includes('audio_channel_required'));
  p.settings.featureFlags = { audio: true }; assert.equal(inspect(p).ok, true);
  p.blocks[0].content.durationMs = 3600001; assert.ok(codes(inspect(p)).includes('timing_invalid'));
  p.blocks[0].content.durationMs = 999; assert.ok(codes(inspect(p)).includes('timed_block_clamped'));
});

test('media preflight uses verified manifests and cold cache workspace; budgets are per block, not sum of protocol', () => {
  const p = base(); p.blocks[0].trials = [1, 2, 3].map(stimulusId => ({ stimulusId, duration: 1000 }));
  p.mediaManifest = Object.fromEntries([1, 2, 3].map(id => [id, { sizeBytes: 64 * 1024 * 1024, sha256: 'a'.repeat(64) }]));
  assert.ok(codes(inspect(p)).includes('block_media_budget'));
  p.blocks = [1, 2, 3].map(id => ({ type: 'passive', trials: [{ stimulusId: id, duration: 1000 }] }));
  assert.equal(inspect(p).ok, true);
  p.mediaManifest[1].sha256 = 'invalid'; assert.ok(codes(inspect(p)).includes('media_manifest_invalid'));
  assert.ok(codes(inspect(base(), { mediaReport: { ok: false } })).includes('media_unavailable'));
});

test('actual publication assertion returns warnings, throws typed 422 on hard errors, and leaves definitions immutable', async () => {
  const { default: router } = await import('../routes/protocols_new.js');
  const p = base(), before = JSON.stringify(p);
  const report = await router.assertProtocolPublishable(p, { ok: true });
  assert.equal(report.ok, true); assert.equal(report.mediaCheck, 'passed'); assert.equal(JSON.stringify(p), before);
  p.blocks[0].trials = [];
  await assert.rejects(router.assertProtocolPublishable(p), error => error.status === 422
    && error.code === 'protocol_preflight_failed' && error.details.errors[0].code === 'trials_required');
});
