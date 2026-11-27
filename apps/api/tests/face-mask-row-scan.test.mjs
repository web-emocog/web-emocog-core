import test from 'node:test';
import assert from 'node:assert/strict';
import { createFaceSupport } from '../../participant-web/js/face-segmenter/face-support.mjs?v=20261028-139';
import { extractFaceRegion } from '../../participant-web/js/face-segmenter/mask-analyzer.js';
import { analyzeAreaPixels, defineFaceAreas } from '../../participant-web/js/face-segmenter/region-analyzer.js';
import { DEFAULT_THRESHOLDS } from '../../participant-web/js/face-segmenter/thresholds.js';
import { faceVisibilityFixture } from '../../autotests/tests/fixtures/face-visibility.mjs';

function oracle(input, bounds, length, points = []) {
    const indices = [];
    const { width, height } = input;
    for (let y = Math.max(0, Math.floor(bounds.y * height)); y < Math.min(height, Math.ceil((bounds.y + bounds.height) * height)); y++) {
        for (let x = Math.max(0, Math.floor(bounds.x * width)); x < Math.min(width, Math.ceil((bounds.x + bounds.width) * width)); x++) {
            if (y * width + x < length && input.contains((x + .5) / width, (y + .5) / height)) indices.push(y * width + x);
        }
    }
    for (const point of points) {
        const x = Math.floor(point.x * width), y = Math.floor(point.y * height);
        if (x >= 0 && x < width && y >= 0 && y < height && y * width + x < length
            && input.contains((x + .5) / width, (y + .5) / height)) indices.push(y * width + x);
    }
    return indices;
}

test('face masks scan exactly the same pixel centres with one support lookup per row, not per pixel', () => {
    for (const width of [32, 79, 160, 256]) for (const roll of [0, -.25, .2]) for (const mirror of [false, true]) {
        const input = faceVisibilityFixture({ width, height: width + 11, roll, mirror });
        const support = createFaceSupport(input.landmarks, input.width, input.height);
        const get = support.rows.get.bind(support.rows);
        let lookups = 0, reads = [];
        support.rows.get = y => { lookups++; return get(y); };
        const data = new Proxy({ length: input.data.length }, { get(target, key) {
            if (key === 'length') return target.length;
            if (/^\d+$/.test(String(key))) { reads.push(Number(key)); return input.data[Number(key)]; }
        } });
        const region = extractFaceRegion(data, input.width, input.height, input.landmarks, input.width, input.height, support);
        assert.deepEqual(reads, oracle(input, support.bounds, data.length));
        assert.equal(region.stats.totalPixels, reads.length);
        assert.ok(lookups <= input.height, `whole-face support lookups: ${lookups}`);
        for (const [name, area] of Object.entries(defineFaceAreas(input.landmarks))) {
            reads = []; lookups = 0;
            analyzeAreaPixels(data, input, area, name, DEFAULT_THRESHOLDS, support);
            assert.deepEqual(reads, oracle(input, area, data.length, area.points));
            assert.ok(lookups <= input.height + area.points.length, `${name} support lookups: ${lookups}`);
        }
    }
});

test('truncated masks, empty support rows and clipped contours never sample outside the same face support', () => {
    for (const shiftX of [-.4, 0, .4]) {
        const input = faceVisibilityFixture({ width: 79, height: 61, shiftX });
        const support = createFaceSupport(input.landmarks, input.width, input.height);
        const length = input.data.length - 79 * 13, reads = [];
        const data = new Proxy({ length }, { get(target, key) {
            if (key === 'length') return target.length;
            if (/^\d+$/.test(String(key))) { reads.push(Number(key)); return input.data[Number(key)]; }
        } });
        extractFaceRegion(data, input.width, input.height, input.landmarks, input.width, input.height, support);
        assert.deepEqual(reads, oracle(input, support.bounds, length));
        assert.ok(reads.every(index => index >= 0 && index < length));
    }
});
