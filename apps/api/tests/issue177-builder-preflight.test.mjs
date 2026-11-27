import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import quality from '../../shared/protocol-quality.js';
import standard from '../../shared/standard-stimuli.js';
import { inspectProtocolPreflight as inspect, inspectPassiveValidTimeBlock } from '../../shared/protocol-preflight.mjs';

const policy = (maxExtensionRatio = .5) => ({ schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio, minSegmentMs: 1000 });
const protocol = (validTime = policy()) => ({ version: 'v2', blocks: [{ id: 'passive', type: 'passive',
  blockConfig: { ...(validTime === undefined ? {} : { validTime }), useFixation: false },
  trials: [{ stimulusId: 'std_simple_black_square', duration: 2000, repetitions: 2, condition: 'original' }] }] });
const codes = result => result.errors.map(error => error.code);
const builderSource = fs.readFileSync(new URL('../../web/researcher-builder.js?v=20261124-load2', import.meta.url), 'utf8');
const context = vm.createContext({ StandardStimuli: standard });
vm.runInContext(builderSource, context);

test('#177 opt-in absent leaves existing protocols, previews and QC unchanged', () => {
  const p = protocol(); delete p.blocks[0].blockConfig.validTime;
  const before = JSON.stringify(p);
  assert.equal(quality.validate(p), true);
  assert.equal(inspect(p).duration.plannedMaximumMs, 4400);
  assert.equal(inspect(p).warnings.some(warning => warning.code === 'passive_valid_time_extension'), false);
  assert.equal(context.builderPassiveValidTimePreview({ type: 'passive', content: {} }), '');
  assert.equal(context.builderPassiveValidTimeConfig(false, 50), null);
  assert.equal(JSON.stringify(p), before);
});

test('#177 bounded ratio and one-second segment are exact, without coercion or extra keys', () => {
  for (const ratio of [0, .125, .5]) {
    const p = protocol(policy(ratio)), before = JSON.stringify(p);
    assert.equal(quality.validate(p), true);
    assert.equal(inspect(p).ok, true);
    assert.equal(inspect(p).duration.plannedMaximumMs, 2 * (Math.floor(2000 * (1 + ratio)) + 200));
    assert.equal(JSON.stringify(p), before);
  }
  for (const config of [null, false, [], {}, { ...policy(), enabled: 'true' }, { ...policy(), enabled: 1 },
    { ...policy(), schemaVersion: 'future' }, { ...policy(), maxExtensionRatio: -.01 },
    { ...policy(), maxExtensionRatio: .50001 }, { ...policy(), maxExtensionRatio: '0.5' },
    { ...policy(), maxExtensionRatio: NaN }, { ...policy(), maxExtensionRatio: Infinity },
    { ...policy(), minSegmentMs: 999 }, { ...policy(), minSegmentMs: '1000' }, { ...policy(), override: true }]) {
    const p = protocol(config);
    assert.equal(quality.validate(p), false, JSON.stringify(config));
    assert.ok(codes(inspect(p)).includes('passive_valid_time_invalid'));
  }
  assert.equal(quality.validate(protocol({ ...policy(), enabled: false })), true);
});

test('#177 both canonical policy locations work; conflicting copies fail closed', () => {
  const p = protocol();
  p.blocks[0].content = { validTime: policy() };
  assert.equal(inspect(p).ok, true);
  p.blocks[0].content.validTime.maxExtensionRatio = .25;
  assert.equal(quality.validate(p), false);
  assert.ok(codes(inspect(p)).includes('passive_valid_time_invalid'));
  delete p.blocks[0].blockConfig.validTime;
  assert.equal(inspect(p).ok, true);
  assert.deepEqual(inspectPassiveValidTimeBlock(p.blocks[0]).config, policy(.25));
});

test('#177 RT, manual/deadline blocks and active response fields cannot enable extension', () => {
  for (const mutate of [
    block => { block.type = 'cognitive_task'; block.taskType = 'simple_rt'; },
    block => { block.type = 'rest'; },
    block => { block.type = 'precheck'; },
    block => { block.blockConfig.useRT = true; },
    block => { block.blockConfig.responseMode = 'keypress'; },
    block => { block.blockConfig.slideChangeMode = 'manual'; },
    block => { block.blockConfig.protocolDurationMs = 5000; },
    block => { block.trials[0].action = 'Space'; },
    block => { block.trials[0].responseMode = 'click'; },
    block => { block.trials[0].stimulus = { type: 'video' }; },
    block => { block.trials[0].type = 'audio'; },
    block => { block.trials[0].stimulusType = 'video'; }
  ]) {
    const p = protocol(); mutate(p.blocks[0]);
    assert.equal(quality.validate(p), false);
    assert.ok(codes(inspect(p)).includes('passive_valid_time_invalid'));
  }
  const normalized = protocol();
  Object.assign(normalized.blocks[0], { type: 'cognitive_task', taskType: 'passive_viewing' });
  Object.assign(normalized.blocks[0].blockConfig, { useRT: false, responseMode: 'none' });
  assert.equal(quality.validate(normalized), true);
  assert.equal(inspect(normalized).ok, true);
});

test('#177 uploaded files require verified static metadata at publication, not an image label', () => {
  const p = protocol(); p.blocks[0].trials[0].stimulusId = 31;
  assert.equal(inspect(p).ok, true, 'draft preflight defers server-only metadata');
  assert.equal(inspect(p, { mediaReport: { ok: true } }).ok, false);
  for (const mimeType of ['video/mp4', 'audio/wav', 'image/gif', 'image/webp', 'image/svg+xml', 'image/png', undefined]) {
    assert.equal(inspect(p, { mediaReport: { ok: true, validTimeMedia: { 31: { mimeType } } } }).ok, false);
  }
  for (const mimeType of ['image/png', 'image/jpeg', 'image/bmp']) {
    assert.equal(inspect(p, { mediaReport: { ok: true, validTimeMedia: { 31: { mimeType, codec: mimeType === 'image/png' ? 'png' : undefined } } } }).ok, true);
  }
  for (const extra of [{ animated: true }, { frameCount: 2 }, { codec: 'apng' }, { duration_ms: 2000 }]) {
    assert.equal(inspect(p, { mediaReport: { ok: true, validTimeMedia: { 31: { mimeType: 'image/png', ...extra } } } }).ok, false);
  }
  p.mediaManifest = { 31: { mimeType: 'image/jpeg', sizeBytes: 100, sha256: 'a'.repeat(64) } };
  assert.equal(inspect(p, { mediaReport: { ok: true } }).ok, true);
  assert.equal(inspect(p, { mediaReport: { ok: true, validTimeMedia: { 31: { mime_type: 'video/mp4' } } } }).ok, false);
});

test('#177 extended duration follows the accumulator bound and rejects subsecond targets', () => {
  const p = protocol(); p.blocks[0].trials[0].duration = 999;
  assert.ok(codes(inspect(p)).includes('passive_valid_time_duration'));
  p.blocks[0].trials[0].duration = 57600000;
  assert.equal(inspect(p).ok, true);
  p.blocks[0].trials[0].duration++;
  assert.ok(codes(inspect(p)).includes('timing_invalid'));
});

test('#177 real publication assertion rejects invalid policies without mutating conditions or RT', async () => {
  const { default: router } = await import('../routes/protocols_new.js?v=20261124-load2');
  const p = protocol(), before = JSON.stringify(p);
  assert.equal((await router.assertProtocolPublishable(p, { ok: true })).ok, true);
  assert.equal(JSON.stringify(p), before);
  p.blocks[0].blockConfig.validTime.maxExtensionRatio = .6;
  await assert.rejects(router.assertProtocolPublishable(p, { ok: true }), error => error.status === 422
    && error.code === 'protocol_preflight_failed' && codes(error.details).includes('passive_valid_time_invalid'));
});

test('#177 builder enables only static passive selections and explains extension in RU/EN', () => {
  const block = { type: 'passive', content: { validTime: policy(.25) } };
  const trials = [{ stimulusId: 'std_simple_black_square', duration: 2000, condition: 'original' }];
  assert.equal(context.builderPassiveValidTimeEligible(block, trials), true);
  assert.equal(context.builderPassiveValidTimeEligible({ ...block, type: 'cognitive_task' }, trials), false);
  for (const [type, mimeType] of [['video', 'video/mp4'], ['audio', 'audio/wav'], ['image', 'image/gif'], ['image', undefined]]) {
    assert.equal(context.builderPassiveValidTimeEligible(block, [...trials, { stimulusId: 31 }], [{ id: 31, type, mimeType }]), false);
  }
  assert.equal(context.builderPassiveValidTimeEligible(block, [{ stimulusId: 31 }], [{ id: 31, type: 'image', mimeType: 'image/png' }]), true,
    'legacy PNG is a candidate for server verification, not an already verified published image');
  for (const id of ['browser-only-image', 'blob:local', '2147483648']) assert.equal(context.builderPassiveValidTimeEligible(block,
    [{ stimulusId: id }], [{ id, type: 'image', mimeType: 'image/png' }]), false);
  assert.equal(context.builderPassiveValidTimeEligible(block, [{ stimulusId: 31 }],
    [{ id: 31, type: 'image', mimeType: 'image/png', contentAvailable: false }]), false);
  assert.equal(context.builderPassiveValidTimeEligible(block, [{ stimulusId: 31 }], [{ id: 31, type: 'image', mimeType: 'image/jpeg' }]), true);
  for (const percent of [0, 12.5, 50]) assert.deepEqual(JSON.parse(JSON.stringify(context.builderPassiveValidTimeConfig(true, percent))), policy(percent / 100));
  for (const percent of ['', -1, 51, NaN, Infinity, 'bad']) assert.equal(context.builderPassiveValidTimeConfig(true, percent), null);
  const before = JSON.stringify(block);
  assert.match(context.builderPassiveValidTimePreview(block, 'en'), /up to \+25%.*original timer.*RT are unchanged/);
  assert.match(context.builderPassiveValidTimePreview(block, 'ru'), /до \+25%.*исходному таймеру/);
  assert.equal(JSON.stringify(block), before);
  assert.equal(context.builderPassiveValidTimePreview({ ...block, type: 'cognitive_task' }), '');
});

test('#177 browser QC tolerates helper arriving after precheck without permitting an early opt-in', () => {
  const browser = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('../../shared/protocol-quality.js', import.meta.url), 'utf8'), browser);
  assert.equal(browser.WecogProtocolQuality.validate(protocol()), false);
  vm.runInContext(fs.readFileSync(new URL('../../shared/passive-valid-time.js', import.meta.url), 'utf8'), browser);
  browser.StandardStimuli = standard;
  assert.equal(browser.WecogProtocolQuality.validate(protocol()), true);
});

test('#177 published QC evaluator validates static media once, not on every captured frame', () => {
  const definition = protocol();
  definition.settings = { qualityControl: { schemaVersion: 'protocol_quality.v1',
    rules: { fpsStable: { enabled: true, threshold: 25, hardStop: true } } } };
  let inspections = 0;
  const trials = definition.blocks[0].trials;
  Object.defineProperty(definition.blocks[0], 'trials', { get() { inspections++; return trials; } });
  const evaluate = quality.createEvaluator(definition);
  const prepared = inspections;
  assert.ok(prepared > 0);
  for (let index = 0; index < 9000; index++) assert.equal(evaluate({ analysisFps: 16 }).checks.fpsStable.status, 'failed');
  assert.equal(inspections, prepared);
  definition.settings.qualityControl.rules.fpsStable.threshold = 1;
  assert.equal(evaluate({ analysisFps: 16 }).checks.fpsStable.threshold, 25, 'an admitted run retains published thresholds');
  assert.equal(quality.createEvaluator({ settings: { qualityControl: {} } })({ analysisFps: 29 }), null);
});
