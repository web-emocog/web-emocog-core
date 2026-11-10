import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrecheckAnalyzer } from '../../participant-web/js/precheck-analyzer/PrecheckAnalyzer.js?v=20261110-integration1';
import { FaceSegmenter } from '../../participant-web/js/face-segmenter/FaceSegmenter.js?v=20261110-integration1';
import { VisionWorkerClient } from '../../participant-web/js/session-runtime/vision-worker-client.mjs?v=20261110-integration1';

function replace(t, key, value) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
}
function installCanvas(t) {
    replace(t, 'document', { createElement: () => ({ getContext: () => ({}) }) });
}

for (const mode of ['throw', 'reject']) {
    test(`${mode}: ready observers cannot turn one worker into a second main-thread model`, async t => {
        const oldSupported = VisionWorkerClient.supported, oldStart = VisionWorkerClient.prototype.start,
            oldDispose = VisionWorkerClient.prototype.dispose;
        t.after(() => {
            VisionWorkerClient.supported = oldSupported;
            VisionWorkerClient.prototype.start = oldStart;
            VisionWorkerClient.prototype.dispose = oldDispose;
        });
        let workers = 0, disposed = 0, mainStarts = 0;
        const events = [];
        replace(t, 'WECOG_DEBUG', { enabled: true, log() {}, error: (...args) => events.push(args) });
        replace(t, 'FilesetResolver', { forVisionTasks() { mainStarts++; throw new Error('Unexpected main model'); } });
        VisionWorkerClient.supported = () => true;
        VisionWorkerClient.prototype.start = async () => { workers++; return { inferenceDelegate: 'CPU' }; };
        VisionWorkerClient.prototype.dispose = () => { disposed++; };
        for (const Analyzer of [PrecheckAnalyzer, FaceSegmenter]) {
            let callbacks = 0;
            const analyzer = new Analyzer({ onInitialized() {
                assert.equal(this, analyzer); callbacks++;
                if (mode === 'throw') throw new Error('SYNTHETIC-PRIVATE-READY');
                return Promise.reject(new Error('SYNTHETIC-PRIVATE-READY'));
            } });
            assert.equal(await analyzer.initialize(), true);
            assert.equal(await analyzer.initialize(), true);
            assert.equal(analyzer.backend, 'worker');
            assert.equal(analyzer.isInitialized, true);
            assert.equal(analyzer.workerAllowed, true);
            assert.equal(analyzer.workerFallbackReason, undefined);
            assert.equal(callbacks, 1);
            assert.equal(disposed, workers - 1);
            analyzer.dispose();
        }
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(workers, 2); assert.equal(mainStarts, 0); assert.equal(disposed, 2);
        assert.equal(events.length, 2);
        assert.ok(!JSON.stringify(events).includes('SYNTHETIC-PRIVATE-READY'));
    });

    test(`${mode}: main-model readiness does not depend on a UI notification`, async t => {
        installCanvas(t);
        let models = 0, closed = 0;
        replace(t, 'FilesetResolver', { forVisionTasks: async () => ({}) });
        const factory = { createFromOptions: async () => { models++; return { close() { closed++; } }; } };
        replace(t, 'FaceLandmarker', factory); replace(t, 'ImageSegmenter', factory);
        for (const Analyzer of [PrecheckAnalyzer, FaceSegmenter]) {
            const analyzer = new Analyzer({ worker: false, onInitialized() {
                if (mode === 'throw') throw new Error('SYNTHETIC-PRIVATE-READY');
                return Promise.reject(new Error('SYNTHETIC-PRIVATE-READY'));
            } });
            assert.equal(await analyzer.initialize(), true);
            assert.equal(analyzer.isInitialized, true); assert.equal(analyzer.backend, 'main');
            assert.equal(await analyzer.initialize(), true);
            analyzer.dispose();
        }
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(models, 2); assert.equal(closed, 2);
    });
}

test('terminal initialization errors cannot re-create models per frame; reset/explicit initialization recovers', async t => {
    installCanvas(t);
    let available = false, models = 0, errors = 0;
    const marker = new Error('SYNTHETIC-PRIVATE-MODEL-URL');
    replace(t, 'FilesetResolver', { forVisionTasks: async () => ({}) });
    const factory = { createFromOptions: async () => { models++; if (!available) throw marker; return { close() {} }; } };
    replace(t, 'FaceLandmarker', factory); replace(t, 'ImageSegmenter', factory);
    const events = [];
    replace(t, 'WECOG_DEBUG', { enabled: true, log() {}, error: (...args) => events.push(args) });
    for (const [Analyzer, method] of [[PrecheckAnalyzer, 'analyzeFrame'], [FaceSegmenter, 'segmentFrame']]) {
        available = false;
        const analyzer = new Analyzer({ worker: false, onError(error) {
            assert.equal(this, analyzer); assert.equal(error, marker); errors++;
            return Promise.reject(new Error('SYNTHETIC-PRIVATE-OBSERVER'));
        } });
        const before = models;
        for (let i = 0; i < 100; i++) assert.ok((await analyzer[method]({ width: 2, height: 2 })).error);
        assert.equal(analyzer.backend, 'failed'); assert.equal(analyzer.isInitialized, false);
        assert.equal(models - before, 2); // One GPU attempt plus the existing CPU fallback.
        analyzer.reset(); available = true;
        assert.equal(await analyzer.initialize(), true);
        assert.equal(analyzer.initializationFailed, false);
        assert.equal(models - before, 3);
        analyzer.dispose();
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors, 2);
    assert.ok(!JSON.stringify(events).includes('SYNTHETIC-PRIVATE'));
});

test('repeated CPU mask failures release every mask but log one fixed code, not an exception', async t => {
    const events = [];
    replace(t, 'WECOG_DEBUG', { enabled: true, error: (...args) => events.push(args) });
    const analyzer = new FaceSegmenter({ worker: false }); analyzer.isInitialized = true;
    analyzer.inferenceDelegate = 'CPU';
    let closed = 0;
    analyzer.imageSegmenter = { segmentForVideo: () => ({ categoryMask: {
        getAsUint8Array() { throw new Error('SYNTHETIC-PRIVATE-MASK'); }, close() { closed++; } },
        confidenceMasks: [{ close() { closed++; } }] }), close() {} };
    for (let i = 0; i < 100; i++) {
        const result = await analyzer.segmentFrame({ width: 2, height: 2 });
        assert.equal(result.error, 'segment_inference_failed'); assert.equal(result.isComplete, false);
        assert.ok(!JSON.stringify(result).includes('SYNTHETIC-PRIVATE'));
    }
    assert.equal(closed, 200); assert.equal(events.length, 1);
    analyzer.dispose();
});
