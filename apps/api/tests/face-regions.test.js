const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = file => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/face-segmenter', file)).href);

test('mask regions and confidence samples do not wrap at image boundaries', async () => {
  const { extractFaceRegion, extractConfidenceStats } = await load('mask-analyzer.js');
  const mask = new Uint8Array(100).fill(3);
  const region = extractFaceRegion(mask, 10, 10, [{ x: .9, y: .2 }, { x: 1.1, y: .8 }], 10, 10);
  assert.ok(region.boundingBox.x + region.boundingBox.width <= 1);
  assert.equal(region.stats.totalPixels, 14);
  const data = new Float32Array([1, 0, .5, .5]);
  const stats = extractConfidenceStats({ width: 2, height: 2, getAsFloat32Array: () => data },
    [{ x: 1, y: 0 }, { x: -.1, y: .5 }, { x: NaN, y: .2 }, { x: .1, y: .1 }], 2, 2);
  assert.equal(stats.sampledPoints, 1);
  assert.equal(stats.averageConfidence, 1);
  const { analyzeAreaPixels } = await load('region-analyzer.js');
  const { DEFAULT_THRESHOLDS } = await load('thresholds.js');
  const local = analyzeAreaPixels(new Uint8Array([3, 2, 2, 3]), { width: 2, height: 2 },
    { x: 0, y: 0, width: .5, height: .5, points: [{ x: 1, y: 0 }, { x: -.1, y: .5 }, { x: 0, y: 0 }] },
    'forehead', DEFAULT_THRESHOLDS);
  assert.equal(local.landmarkFaceSkinRatio, 1);
  assert.equal(local.landmarkBodySkinRatio, 0);
});

test('forehead excludes the jaw, chin excludes the forehead; true local occlusion remains detected', async () => {
  const { defineFaceAreas, analyzeAreaPixels } = await load('region-analyzer.js');
  const { DEFAULT_THRESHOLDS } = await load('thresholds.js');
  // Selected x/y coordinates of MediaPipe canonical_face_model.obj (Apache-2.0).
  // Source: google-ai-edge/mediapipe/mediapipe/modules/face_geometry/data/.
  const coordinates = {
    9: [0, 4.885979], 10: [0, 8.261778], 17: [0, -5.365123], 67: [-3.523964, 8.005976],
    103: [-5.133204, 7.485602], 108: [-1.6195, 6.599217], 109: [-1.891399, 8.236377],
    136: [-5.085276, -7.17859], 148: [-1.292924, -9.29592], 149: [-3.210651, -8.533278],
    150: [-4.068926, -7.993109], 152: [0, -9.403378], 176: [-2.308977, -8.974196],
    200: [0, -6.991499], 297: [3.523964, 8.005976], 332: [5.133204, 7.485602],
    337: [1.6195, 6.599217], 338: [1.891399, 8.236377], 365: [5.085276, -7.17859],
    377: [1.292924, -9.29592], 378: [3.210651, -8.533278], 379: [4.068926, -7.993109],
    400: [2.308977, -8.974196]
  };
  const landmarks = Array.from({ length: 478 }, (_, i) => {
    const [x, y] = coordinates[i] || [0, 0]; return { x: (x + 8) / 16, y: (9 - y) / 19 };
  });
  const areas = defineFaceAreas(landmarks);
  assert.ok(areas.forehead.y + areas.forehead.height < .3);
  assert.ok(areas.chin.y > .7);
  const mask = new Uint8Array(100 * 100).fill(3);
  for (let y = 75; y < 100; y++) mask.fill(2, y * 100, (y + 1) * 100);
  const analyze = name => analyzeAreaPixels(mask, { width: 100, height: 100 }, areas[name], name, DEFAULT_THRESHOLDS);
  assert.equal(analyze('forehead').isVisible, true);
  assert.equal(analyze('chin').reason, 'hand_occlusion');
  mask.fill(3);
  for (let y = 0; y < 25; y++) mask.fill(2, y * 100, (y + 1) * 100);
  assert.equal(analyze('forehead').reason, 'hand_occlusion');
  assert.equal(analyze('chin').isVisible, true);
});
