const test = require('node:test');
const assert = require('node:assert/strict');
const { landmarksForGaze, changeEyelids } = require('./fixtures/gaze-topology');
const load = () => import('../../../scripts/reference-data/issue143-eye-shape.mjs');

test('offline eye shape preserves vertical image motion without reading lid or iris landmarks', async () => {
  const { extractEyeShapeCenters } = await load();
  const { syntheticEyeImage } = await import('../../autotests/fixtures/issue143-eye-image.mjs');
  const face = landmarksForGaze(0, 0);
  const pixels = syntheticEyeImage(face, { gazeX: .2, gazeY: -.5 });
  const downPixels = syntheticEyeImage(face, { gazeX: .2, gazeY: .5 });
  const changed = changeEyelids(face, { factor: .5, centerShift: .01 });
  for (let i = 468; i < 478; i++) changed[i] = { x: .5, y: .3 };
  for (const method of ['global', 'local', 'local_observed']) {
    const up = extractEyeShapeCenters(pixels, face, method), down = extractEyeShapeCenters(downPixels, face, method);
    assert.equal(up.length, 4);
    assert.ok(down[1] > up[1] && down[3] > up[3]);
    assert.deepEqual(extractEyeShapeCenters(pixels, changed, method), up);
    assert.equal(extractEyeShapeCenters(null, face, method), null);
    assert.equal(extractEyeShapeCenters(pixels, landmarksForGaze(0, 0, { leftShiftX: .6 }), method), null);
  }
});

test('flat, malformed or one-dimensional support cannot produce an eye shape center', async () => {
  const { fitEyeShapeCenters, extractEyeShapeCenters } = await load();
  const { syntheticEyeImage } = await import('../../autotests/fixtures/issue143-eye-image.mjs');
  const face = landmarksForGaze(0, 0);
  assert.equal(fitEyeShapeCenters([NaN]), null);
  assert.equal(fitEyeShapeCenters(new Array(320).fill(0)), null);
  assert.equal(fitEyeShapeCenters(Array.from({ length: 320 }, (_, i) => Math.floor((i % 160) / 16) === 5 ? 1 : 0)), null);
  assert.equal(extractEyeShapeCenters(syntheticEyeImage(face, { irisVisible: false }), face), null);
});

test('independent shape confirmation checks both eyes and never changes the estimated center', async () => {
  const { confirmEyeShapeCenters } = await load();
  const centers = [.1, -.2, .15, -.2];
  assert.equal(confirmEyeShapeCenters(centers, [.12, -.25, .15, -.25]), centers);
  assert.equal(confirmEyeShapeCenters(centers, [.12, -.25, .15, .05]), null);
  assert.equal(confirmEyeShapeCenters(centers, [.1, -.2, .35, 0]), null); // diagonal distance, not axis-by-axis
  assert.equal(confirmEyeShapeCenters(centers, null), null);
  assert.equal(confirmEyeShapeCenters(centers, [NaN, 0, 0, 0]), null);
});

test('masked eye extractor uses same-frame pixels and lid visibility, not the tracked iris', async () => {
  const { syntheticEyeImage, syntheticApertureLandmarks } = await import('../../autotests/fixtures/issue143-eye-image.mjs');
  const { measureMaskedEyeFrame, measureLidSupportPair } = await import('../../web/developer/gaze-eye-masked.mjs');
  const maskedEyeCentersForFrame = frame => measureMaskedEyeFrame(frame).centers;
  const { rememberFramePixels } = await import('../../participant-web/js/session-runtime/frame-pixels.mjs');
  const face = syntheticApertureLandmarks(landmarksForGaze(0, 0));
  const capture = (landmarks, gazeY, extras = {}) => {
    const frameSize = { width: 640, height: 480 };
    return rememberFramePixels({ landmarks, frameSize }, syntheticEyeImage(landmarks, { gazeY, ...extras }));
  };
  const captureUp = capture(face, -.55);
  assert.deepEqual(measureLidSupportPair(captureUp), { hard: null, soft: null });
  const up = maskedEyeCentersForFrame(captureUp);
  const down = maskedEyeCentersForFrame(capture(face, .55));
  assert.equal(up.length, 4);
  assert.ok(down[1] > up[1] && down[3] > up[3]);
  const wrongIris = face.slice();
  for (let i = 468; i < 478; i++) wrongIris[i] = { x: .1, y: .1 };
  assert.deepEqual(maskedEyeCentersForFrame(capture(wrongIris, -.55)), up);
  assert.deepEqual(measureMaskedEyeFrame({ ...captureUp }), { centers: null, reason: 'missing_frame_pixels' }); // a different capture owner
  assert.deepEqual(measureLidSupportPair({ ...captureUp }), { hard: 'missing_frame_pixels', soft: 'missing_frame_pixels' });
  captureUp.frameSize.height = 720;
  assert.equal(maskedEyeCentersForFrame(captureUp), null);
  assert.equal(maskedEyeCentersForFrame(capture(face, 0, { irisVisible: false, texture: 20 })), null);
  const closed = syntheticApertureLandmarks(face, { aperture: .035 });
  assert.deepEqual(measureMaskedEyeFrame(capture(closed, 0, { aperture: .035 })),
    { centers: null, reason: 'insufficient_visible_rows' });
  assert.deepEqual(measureLidSupportPair(capture(closed, 0, { aperture: .035 })),
    { hard: 'insufficient_visible_rows', soft: 'insufficient_visible_rows' });
});

test('eye shape benchmark preserves negative cases and reports paired error separately from missing and off-screen', async () => {
  const { runEyeShapeSynthetic } = await import('../../../scripts/reference-data/issue143-eye-shape-synthetic.mjs');
  const result = runEyeShapeSynthetic();
  const get = condition => result.results.find(row => row.condition === condition).models;
  assert.equal(result.shapeCalibration.independentTargetsUsed, 0);
  assert.equal(result.shapeCalibration.calibrationRows, 50);
  assert.equal(result.localObservedShapeCalibration.calibrationRows, 50);
  const glare = get('glare');
  assert.equal(glare.eye_shape.accepted, glare.eye_patch.accepted);
  assert.ok(glare.eye_shape.commonPatch.errorDeltaPx < 0);
  const combined = get('combined');
  assert.ok(combined.eye_shape.commonBaseline.errorDeltaPx < 0);
  assert.ok(combined.eye_shape.missing > 0);
  const texture = get('texture');
  assert.ok(texture.eye_shape.missing > texture.eye_gradient_all.missing);
  assert.ok(texture.eye_shape.offScreenTruth.missing > 0);
  const partial = get('partial_lid');
  assert.ok(partial.eye_shape.offScreenTruth.falseOnScreen > 0);
  assert.equal(partial.eye_shape_local_observed.nearOffScreenTruth.falseOnScreen, 4);
  assert.equal(partial.eye_shape_confirmed.nearOffScreenTruth.falseOnScreen, 0);
  assert.equal(partial.eye_shape_confirmed.nearOffScreenTruth.missing, 4);
  assert.ok(partial.eye_shape_confirmed.commonGradient.errorDeltaPx > 0);
  const absent = get('no_iris').eye_shape;
  assert.equal(absent.accepted, 0);
  assert.equal(absent.meanErrorPx, null);
  assert.equal(texture.eye_shape_local_observed.accepted, texture.eye_patch.accepted);
  assert.ok(texture.eye_shape_local_observed.commonShape.errorDeltaPx < 0);
  const closed = get('near_closed');
  assert.ok(closed.eye_shape_local.accepted > 0);
  assert.equal(closed.eye_shape_local_observed.accepted, 0);
  const noIris = get('no_iris_with_texture');
  assert.ok(noIris.eye_shape_local_observed.accepted > 0);
  assert.equal(noIris.eye_shape_confirmed.accepted, 0);
  const masked = partial.eye_shape_masked_pooled;
  assert.ok(masked.accepted > partial.eye_gradient_all.accepted);
  assert.ok(masked.commonGradient.errorDeltaPx < 0);
  assert.equal(masked.offScreenOnScreenTruth, 0);
  assert.deepEqual(masked.offScreenTruth, { predictedOffScreen: 8, falseOnScreen: 0, missing: 0 });
  assert.ok(masked.nearOffScreenTruth.falseOnScreen > 0); // no claim of reliable boundary discrimination
  assert.ok(glare.eye_shape_masked_pooled.commonGradient.errorDeltaPx < 0);
  assert.equal(noIris.eye_shape_masked_pooled.accepted, 0);
  assert.equal(closed.eye_shape_masked_pooled.accepted, 0);
  assert.ok(get('partial_mask_jitter').eye_shape_masked_pooled.offScreenOnScreenTruth > 0);
  const band = get('row_illumination'), mixedBand = get('lid_with_row_illumination');
  assert.equal(band.eye_patch_row_centered.accepted, band.eye_patch.accepted);
  assert.ok(band.eye_patch_row_centered.commonPatch.errorDeltaPx < -100);
  assert.equal(band.eye_patch_row_centered.offScreenOnScreenTruth, 0);
  // This is a selective intensity transform, not eyelid robustness. Preserve
  // the negative case so a band-only win cannot turn into a production claim.
  assert.ok(mixedBand.eye_patch_row_centered.meanErrorPx > 500);
  assert.ok(mixedBand.eye_patch_row_soft.offScreenOnScreenTruth > 100);
  assert.equal(noIris.eye_patch_row_centered.accepted, 216);
  assert.equal(noIris.eye_patch_row_centered.nearOffScreenTruth.falseOnScreen, 8);
  assert.equal(noIris.eye_shape_masked_soft.accepted, 0);
  assert.equal(closed.eye_shape_masked_soft.accepted, 0);
  assert.equal(combined.eye_shape_masked_soft.offScreenOnScreenTruth, 0);
  assert.ok(combined.eye_shape_masked_soft.meanErrorPx < combined.eye_shape_masked_pooled.meanErrorPx);
  assert.ok(partial.eye_shape_masked_soft.bottomMeanErrorPx > masked.bottomMeanErrorPx);
  for (const { models } of result.results) {
    assert.ok(models.eye_shape_confirmed.accepted <= models.eye_shape_local_observed.accepted);
    assert.ok(models.eye_shape_confirmed.accepted <= models.eye_gradient_all.accepted);
    for (const model of Object.values(models)) {
      assert.equal(model.attempted, 216);
      assert.equal(model.accepted + model.missing, model.attempted);
      for (const band of [model.offScreenTruth, model.nearOffScreenTruth]) {
        assert.equal(Object.values(band).reduce((s, n) => s + n, 0), 8);
      }
    }
  }
});
