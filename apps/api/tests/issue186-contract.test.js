const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpClient } = require('../../web/http-client');
const { validateSessionFeaturePayload: validate } = require('../security/payload-policy');

test('#186 publication errors keep bounded typed preflight details, not arbitrary response data', async () => {
  const client = createHttpClient({ fetch: async () => {}, context: () => ({ owner: 'synthetic', key: 'fixture' }) });
  const response = { status: 422, headers: { get: () => null }, json: async () => ({ error: 'Protocol preflight failed',
    code: 'protocol_preflight_failed', privateValue: 'secret-not-for-ui', preflight: { schemaVersion: 'protocol_preflight.v1',
      errors: Array.from({ length: 80 }, () => ({ code: 'passive_valid_time_invalid', path: '/blocks/0',
        privateValue: 'secret-not-for-ui', message: { ru: 'Проверьте статичное изображение', en: 'Check static image' } })),
      warnings: [], duration: { plannedMaximumMs: 2000 }, privateValue: 'secret-not-for-ui' } }) };
  const error = await client.httpError(response);
  assert.equal(error.preflight.errors.length, 50);
  assert.equal(error.preflight.ok, false);
  assert.equal(error.preflight.duration.plannedMaximumMs, 2000);
  assert.doesNotMatch(JSON.stringify(error.preflight), /secret-not-for-ui/);
});

test('delegate probe provenance accepts only bounded diagnostics without pixels or arbitrary fields', () => {
  const probe = { schemaVersion: 'face_delegate_probe.v1', scope: 'precheck_same_frame', decision: 'cpu_selected',
    samples: 8, gpuMeanMs: 40, cpuMeanMs: 15, cpuMaxMs: 18, modelBudgetMs: 20 };
  const packet = value => ({ schemaVersion: 'session_feature.v1', ids: { session: 'synthetic-probe' },
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, events: [],
    meta: { tech: { framePipeline: { faceDelegateProbe: value } } } });
  assert.deepEqual(validate(packet(probe)), []);
  assert.deepEqual(validate(packet(null)), []);
  for (const change of [{ samples: 9 }, { cpuMeanMs: -1 }, { modelBudgetMs: 40 }, { decision: 'unknown' },
    { rawFrames: [] }, { cpuMaxMs: Infinity }]) assert.ok(validate(packet({ ...probe, ...change })).length);
});

test('#186 public pinned media preserves only decoder eligibility facts, never storage paths or probe errors', () => {
  const { publicProtocolDefinition } = require('../stimuli/public-projection');
  const definition = { mediaManifest: { 1: { mimeType: 'image/png', media_info: { codec: 'png', duration_ms: 0,
    frame_count: 1, animated: false, content_path: '/private/path', preview_error: 'private error', arbitrary: true } } } };
  const result = publicProtocolDefinition(definition);
  assert.deepEqual(result.mediaManifest[1].media_info, { codec: 'png', duration_ms: 0, frame_count: 1, animated: false });
  assert.doesNotMatch(JSON.stringify(result), /private|arbitrary|content_path/);
});
