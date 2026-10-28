const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const load = file => import(pathToFileURL(path.join(root, file)).href);

async function tools() {
    const [mask, region, thresholds, fixture] = await Promise.all([
        load('apps/participant-web/js/face-segmenter/mask-analyzer.js'),
        load('apps/participant-web/js/face-segmenter/region-analyzer.js'),
        load('apps/participant-web/js/face-segmenter/thresholds.js'),
        load('apps/autotests/tests/fixtures/face-visibility.mjs')
    ]);
    const analyze = input => {
        const analysis = mask.analyzeMasks({ categoryMask: input.categoryMask }, input.width, input.height, input.landmarks);
        return { analysis, visibility: region.analyzeFaceRegionsVisibility(analysis, input.landmarks,
            input.width, input.height, thresholds.DEFAULT_THRESHOLDS) };
    };
    return { ...mask, ...region, ...thresholds, ...fixture, analyze };
}

test('issue 139: exposed neck versus covered neck cannot change visibility of an unchanged open face', async () => {
    const t = await tools();
    const open = t.analyze(t.faceVisibilityFixture({ outside: 2 }));
    const covered = t.analyze(t.faceVisibilityFixture({ outside: 4 }));
    assert.equal(open.visibility.isComplete, true);
    assert.equal(covered.visibility.isComplete, true);
    assert.deepEqual(open.visibility.issues, []);
    assert.deepEqual(open.visibility, covered.visibility);
    assert.equal(open.analysis.faceRegion.ratios.bodySkin, 0);
});

test('face support matches the pinned MediaPipe contour and reference raster at rotations/mirrors/resolutions', async () => {
    const t = await tools();
    const { FACE_OVAL_INDICES, createFaceSupport, isFacePixel } = await load('apps/participant-web/js/face-segmenter/face-support.mjs');
    const { FaceLandmarker } = await load('apps/participant-web/js/vendor/mediapipe/vision_bundle.mjs');
    assert.deepEqual([...FACE_OVAL_INDICES], FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map(edge => edge.start));
    for (const width of [32, 79, 160, 256]) for (const roll of [0, .2, -.25]) for (const mirror of [false, true]) {
        const fixture = t.faceVisibilityFixture({ width, height: width + 11, roll, mirror });
        const support = createFaceSupport(fixture.landmarks, fixture.width, fixture.height);
        assert.ok(support?.inFrame);
        let expectedCount = 0;
        for (let y = 0; y < fixture.height; y++) for (let x = 0; x < fixture.width; x++) {
            const expected = fixture.contains((x + .5) / fixture.width, (y + .5) / fixture.height);
            assert.equal(isFacePixel(support, x, y), expected);
            if (expected) expectedCount++;
        }
        const { analysis, visibility } = t.analyze(fixture);
        assert.equal(visibility.isComplete, true);
        assert.equal(analysis.faceRegion.stats.totalPixels, expectedCount);
        assert.equal(analysis.faceRegion.sampling.method, 'face_oval_pixels.v1');
    }
});

test('regional hand/skin, hair, clothing and missing-face checks still reject real in-face mask evidence', async () => {
    const t = await tools();
    const { computeFrameFlags } = await load('apps/participant-web/js/qc-metrics/frame-analysis.js');
    for (const name of ['forehead','leftCheek','rightCheek','leftEye','rightEye','nose','mouth','chin']) {
        const input = t.faceVisibilityFixture({ outside: 2 });
        const bounds = t.defineFaceAreas(input.landmarks)[name];
        for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
            const sx = (x + .5) / input.width, sy = (y + .5) / input.height;
            if (input.contains(sx, sy) && sx >= bounds.x && sx <= bounds.x + bounds.width
                && sy >= bounds.y && sy <= bounds.y + bounds.height) input.data[y * input.width + x] = 2;
        }
        const { visibility } = t.analyze(input);
        assert.equal(visibility.isComplete, false, name);
        assert.equal(visibility.handDetected, true, name);
        assert.ok(visibility.issues.some(issue => issue.endsWith('_hand_occluded')), name);
        assert.equal(computeFrameFlags({ face: { detected: true } }, { faceVisibility: visibility }).occlusionDetected, true);
    }
    for (const inside of [0, 1, 4, 5]) {
        const { visibility } = t.analyze(t.faceVisibilityFixture({ inside }));
        assert.equal(visibility.isComplete, false);
        assert.equal(visibility.handDetected, false);
    }
    const diagnosticOnly = t.analyze(t.faceVisibilityFixture());
    diagnosticOnly.analysis.faceRegion.ratios.bodySkin = 1;
    const visibility = t.analyzeFaceRegionsVisibility(diagnosticOnly.analysis,
        t.faceVisibilityFixture().landmarks, 160, 120, t.DEFAULT_THRESHOLDS);
    assert.equal(visibility.isComplete, true, 'aggregate body_skin cannot override actual regional face pixels');
});

test('missing, malformed, clipped and collapsed mesh or missing mask never produces a passing precheck', async () => {
    const t = await tools();
    for (const landmarks of [null, [], [{ x: .5, y: .5 }],
        Array.from({ length: 478 }, () => ({ x: .5, y: .5 })),
        t.faceVisibilityFixture().landmarks.map((p, i) => i === 10 ? { x: NaN, y: .2 } : p),
        t.faceVisibilityFixture({ shiftX: -.4 }).landmarks]) {
        const input = t.faceVisibilityFixture(); input.landmarks = landmarks;
        const { visibility } = t.analyze(input);
        assert.equal(visibility.isComplete, false);
        assert.equal(visibility.handDetected, false, 'unknown geometry is not proof of a hand');
    }
    const input = t.faceVisibilityFixture();
    for (const categoryMask of [null, { width: 10, height: 10, getAsUint8Array: () => new Uint8Array(2) }]) {
        input.categoryMask = categoryMask;
        const { analysis, visibility } = t.analyze(input);
        assert.equal(analysis.hasData, false);
        assert.equal(visibility.isComplete, false);
    }
});

test('inline fallback and module use identical face-local evidence and release native mask after failure', async () => {
    const t = await tools();
    const Inline = require('../../participant-web/js/face-segmenter');
    const inline = new Inline(); inline.analysisCore = t; inline.isInitialized = true;
    for (const outside of [0, 2, 4, 5]) for (const inside of [1, 2, 3, 4]) {
        const input = t.faceVisibilityFixture({ outside, inside });
        const module = t.analyze(input).visibility;
        const mask = inline._analyzeMasks(input, input.width, input.height, input.landmarks);
        assert.deepEqual(inline._analyzeFaceRegionsVisibility(mask, input.landmarks, input.width, input.height), module);
    }
    let closed = 0;
    const input = t.faceVisibilityFixture();
    input.categoryMask.close = () => { closed++; };
    inline.imageSegmenter = { segmentForVideo: () => input };
    inline._analyzeMasks = () => { throw new Error('synthetic analyzer failure'); };
    const result = await inline.segmentFrame({ readyState: 2, videoWidth: 160, videoHeight: 120 }, input.landmarks);
    assert.ok(result.error); assert.equal(closed, 1);
});

test('new visibility method is explicit and supporting pixels/geometry are never enumerable session properties', async () => {
    const t = await tools();
    const { FACE_VISIBILITY_METHOD } = await load('apps/participant-web/js/face-segmenter/face-support.mjs');
    const { analysis, visibility } = t.analyze(t.faceVisibilityFixture());
    assert.equal(visibility.method, FACE_VISIBILITY_METHOD);
    assert.equal(visibility.method, 'face_oval_regions.v1');
    assert.equal(JSON.stringify(analysis).includes('rows'), false);
    assert.equal(visibility.regions.globalBodySkinRatio, 0);
    assert.equal(t.DEFAULT_THRESHOLDS.minSkinVisibility, .60);
    assert.equal(t.DEFAULT_THRESHOLDS.globalHandThreshold, .08);
    assert.equal(t.getAreaThresholds('leftEye', t.DEFAULT_THRESHOLDS).maxHand, .05);
});
