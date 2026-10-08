const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { left: 100, top: 50, width: 800, height: 600 };
const contain = { display: 'block', objectFit: 'contain', objectPosition: '50% 50%' };
const image = (width, height) => ({ naturalWidth: width, naturalHeight: height, getBoundingClientRect: () => box });

test('stimulus geometry uses only displayed media pixels, not letterboxes or the stage', async t => {
  const { mediaContentRect } = await import('../../participant-web/js/web-page/stimulus-geometry.mjs');
  await t.test('portrait, landscape, video and visual viewport offsets', () => {
    assert.deepEqual(mediaContentRect(image(200, 800), { offsetLeft: 10, offsetTop: 20 }, contain), {
      left: 415, top: 30, width: 150, height: 600, intrinsicWidth: 200, intrinsicHeight: 800, coordinateMappingVersion: 'media-content-rect.v1',
    });
    const video = { videoWidth: 800, videoHeight: 200, getBoundingClientRect: () => box };
    assert.equal(mediaContentRect(video, {}, contain).top, 250);
    assert.equal(mediaContentRect(video, {}, contain).height, 200);
    assert.equal(mediaContentRect(image(400, 400), {}, contain).left, 200);
  });
  await t.test('padding, borders, object position and scale-down are respected', () => {
    const rect = mediaContentRect(image(200, 800), {}, { ...contain, objectPosition: 'right top',
      borderLeftWidth: '10px', paddingLeft: '10px', paddingRight: '20px', paddingTop: '20px', paddingBottom: '20px' });
    assert.equal(rect.left, 740);
    assert.equal(rect.top, 70);
    assert.equal(rect.width, 140);
    assert.equal(rect.height, 560);
    assert.equal(mediaContentRect(image(20, 10), {}, { ...contain, objectFit: 'scale-down' }).width, 20);
  });
  await t.test('hidden, undecoded, invalid and unsupported media fail closed', () => {
    for (const style of [{ ...contain, display: 'none' }, { ...contain, visibility: 'hidden' },
      { ...contain, objectFit: 'cover' }, { ...contain, objectPosition: 'calc(50% - 10px) center' }]) {
      assert.equal(mediaContentRect(image(200, 800), {}, style), null);
    }
    assert.equal(mediaContentRect(image(0, 0), {}, contain), null);
    assert.equal(mediaContentRect(null, {}, contain), null);
  });
  await t.test('the actual participant sampling wrapper selects media and does not fall back while loading', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/web-page/app-updated.js'), 'utf8');
    const wrapper = source.slice(source.indexOf('export function currentStimulusContentRect()'), source.indexOf('window.setLanguage'));
    const media = image(200, 800);
    const elements = { cogImage: media, cognitiveStimulusArea: { getBoundingClientRect: () => box } };
    const context = { state: { runtime: { currentPhase: 'cognitive_stimulus' } },
      getCurrentTaskContext: () => ({ stimulusType: 'image' }), getContentViewport: () => ({}),
      document: { getElementById: id => elements[id] }, getComputedStyle: () => contain,
      mediaContentRect: (element, viewport) => mediaContentRect(element, viewport, contain) };
    const result = vm.runInNewContext(`${wrapper.replace('export ', '')}\ncurrentStimulusContentRect()`, context);
    assert.equal(result.width, 150);
    media.naturalWidth = 0;
    assert.equal(vm.runInNewContext(`${wrapper.replace('export ', '')}\ncurrentStimulusContentRect()`, context), null);
    context.state.runtime.currentPhase = 'instruction';
    assert.equal(vm.runInNewContext(`${wrapper.replace('export ', '')}\ncurrentStimulusContentRect()`, context), null);
  });
  await t.test('normalized heatmaps exclude margins and version the corrected mapping', async () => {
    const { buildHeatmaps } = await import('../../participant-web/js/web-page/heatmap.js');
    const rect = mediaContentRect(image(200, 800), {}, contain);
    const sample = { correctedX: rect.left + rect.width * 0.25, correctedY: rect.top + rect.height * 0.75,
      valid: true, onScreen: true, confidence: 1, phase: 'cognitive_stimulus', blockId: 'main', trialId: 'trial', stimulusId: '42',
      stimulusType: 'image', stimulusRect: rect, screenWidth: 1000, screenHeight: 800 };
    const result = buildHeatmaps([{ ...sample, t: 1000 }, { ...sample, t: 1033, correctedX: rect.left - 1 }],
      { screenWidth: 1000, screenHeight: 800, gridWidth: 4, gridHeight: 4 });
    const entry = result.perStimulus[0];
    assert.equal(entry.outsideStimulusCount, 1);
    assert.equal(entry.intrinsicWidth, 200);
    assert.equal(entry.algorithm.version, '1.1.0');
    assert.equal(entry.algorithm.parameters.coordinateMappingVersion, 'media-content-rect.v1');
    assert.ok(entry.grid.values.some(value => value > 0));
  });
  await t.test('group heatmaps never silently average legacy stage coordinates with corrected media coordinates', () => {
    const { buildGroupHeatmap } = require('../analytics/metrics');
    const presentation = { stimulusId: '42', blockId: 'main', stimulusType: 'image',
      validObservationDurationMs: 1000, grid: { width: 2, height: 2, values: [1, 0, 0, 0] },
      fixationPoints: [{ x: 0.25, y: 0.25, durationMs: 200 }] };
    const row = (id, parameters) => ({ id, participant_id: `p-${id}`, features_payload: { gaze_analytics: {
      schemaVersion: 'gaze_analytics.v1',
      presentations: [{ ...presentation, algorithm: { id: 'idt-fixation-heatmap', version: '1.0.0', parameters } }],
    } } });
    const query = { filters: { blockIds: ['main'], stimulusIds: ['42'], aoiIds: [] } };
    const result = buildGroupHeatmap([row(1, {}), row(2, { coordinateMappingVersion: 'media-content-rect.v1' })], query);
    assert.equal(result.status, 'no_data');
    assert.equal(result.reason, 'gaze_coordinate_mappings_mixed');
    assert.deepEqual(result.grid.values, []);
    assert.equal(buildGroupHeatmap([row(1, {}), row(2, {})], query).status, 'computed');
  });
  await t.test('mixed mappings within repeated presentations are rejected for heatmaps and AOI', () => {
    const { buildHeatmapData, buildAoiRows, buildGroupHeatmap } = require('../analytics/metrics');
    const { rows, query, protocol } = mappingFixture();
    rows[0].features_payload.gaze_analytics.presentations.push(rows[1].features_payload.gaze_analytics.presentations[0]);
    const heatmap = buildHeatmapData(rows[0], query);
    assert.equal(heatmap.reason, 'gaze_coordinate_mappings_mixed');
    assert.equal(heatmap.nFixations, 0);
    assert.deepEqual(heatmap.grid.values, []);
    assert.equal(buildGroupHeatmap([rows[0]], query).reason, 'gaze_coordinate_mappings_mixed');
    assert.equal(buildAoiRows(rows[0], protocol, query)[0].metrics[0].reason, 'gaze_coordinate_mappings_mixed');
  });
  await t.test('group AOI metrics reject mixed mappings and retain corrected algorithm provenance', () => {
    const { buildGroupSummary, buildAoiRows } = require('../analytics/metrics');
    const { rows, query, protocol } = mappingFixture();
    const mixed = buildGroupSummary(rows, query, protocol).metrics[0];
    assert.equal(mixed.status, 'no_data');
    assert.equal(mixed.reason, 'gaze_coordinate_mappings_mixed');
    assert.equal(mixed.nParticipants, 0);
    assert.deepEqual(mixed.participantValues, []);
    const corrected = buildGroupSummary([rows[1]], query, protocol).metrics[0];
    assert.equal(corrected.status, 'computed');
    assert.equal(corrected.algorithm.version, '1.1.0');
    assert.equal(corrected.algorithm.parameters.coordinateMappingVersion, 'media-content-rect.v1');
    assert.notEqual(corrected.algorithm.parametersHash, buildAoiRows(rows[0], protocol, query)[0].metrics[0].algorithm.parametersHash);
  });
  await t.test('group heatmap counts include all compatible repeated presentations', () => {
    const { buildGroupHeatmap } = require('../analytics/metrics');
    const { rows, query } = mappingFixture();
    const presentations = rows[1].features_payload.gaze_analytics.presentations;
    presentations.push({ ...presentations[0], presentationId: 'repeat' });
    const heatmap = buildGroupHeatmap([rows[1]], query);
    assert.equal(heatmap.status, 'computed');
    assert.equal(heatmap.nFixations, 2);
    assert.equal(heatmap.validObservationDurationMs, 2000);
    assert.equal(heatmap.algorithm.parameters.coordinateMappingVersion, 'media-content-rect.v1');
  });
});

function mappingFixture() {
  const presentation = { stimulusId: '42', blockId: 'main', stimulusType: 'image',
    validObservationDurationMs: 1000, grid: { width: 2, height: 2, values: [1, 0, 0, 0] },
    fixationPoints: [{ x: 0.25, y: 0.25, startMs: 0, durationMs: 200 }] };
  const rows = [null, 'media-content-rect.v1'].map((mapping, id) => ({ id, participant_id: `p-${id}`,
    features_payload: { gaze_analytics: { schemaVersion: 'gaze_analytics.v1', presentations: [{ ...presentation,
      algorithm: { parameters: mapping ? { coordinateMappingVersion: mapping } : {} },
    }] } },
  }));
  const query = { metricIds: ['aoi.dwell_time_ms'], filters: { blockIds: ['main'], stimulusIds: ['42'], aoiIds: [], qcChannels: ['gaze'] } };
  const protocol = { definition: { blocks: [{ id: 'main', blockConfig: { aoiDefinitions: { 42: [
    { id: 'face', shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  ] } } }] } };
  return { rows, query, protocol };
}
