import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { PrecheckAnalyzer } from '../../participant-web/js/precheck-analyzer/PrecheckAnalyzer.js?v=20261124-load2';
import { VisionWorkerClient } from '../../participant-web/js/session-runtime/vision-worker-client.mjs?v=20261124-load2';
import policy from '../security/payload-policy.js';

function replace(t, key, value) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
}

test('explicit output choice survives main model and CPU candidate without changing scientific options', async t => {
    replace(t, 'document', { createElement: () => ({ getContext: () => ({}) }) });
    replace(t, 'FilesetResolver', { forVisionTasks: async () => ({}) });
    const options = [];
    replace(t, 'FaceLandmarker', { createFromOptions: async (_vision, config) => {
        options.push(config); return { close() {} };
    } });
    for (const enabled of [true, false, undefined]) {
        const analyzer = new PrecheckAnalyzer({ worker: false, outputFaceBlendshapes: enabled });
        assert.equal(await analyzer.initialize(), true);
        const candidate = await analyzer.createCpuCandidate();
        for (const config of options.splice(0)) {
            assert.equal(config.outputFaceBlendshapes, enabled !== false);
            assert.equal(config.outputFacialTransformationMatrixes, true);
            assert.equal(config.numFaces, 1);
            assert.equal(config.minFaceDetectionConfidence, .5);
            assert.equal(config.minFacePresenceConfidence, .5);
            assert.equal(config.minTrackingConfidence, .5);
        }
        candidate.close(); analyzer.dispose();
    }
});

test('the worker gets the same explicit choice; default developer SDK scores remain enabled', async t => {
    const supported = VisionWorkerClient.supported, start = VisionWorkerClient.prototype.start,
        dispose = VisionWorkerClient.prototype.dispose;
    t.after(() => { VisionWorkerClient.supported = supported; VisionWorkerClient.prototype.start = start;
        VisionWorkerClient.prototype.dispose = dispose; });
    const received = [];
    VisionWorkerClient.supported = () => true;
    VisionWorkerClient.prototype.start = async options => { received.push(options.outputFaceBlendshapes); return {}; };
    VisionWorkerClient.prototype.dispose = () => {};
    for (const enabled of [false, undefined]) {
        const analyzer = new PrecheckAnalyzer({ outputFaceBlendshapes: enabled });
        assert.equal(await analyzer.initialize(), true); analyzer.dispose();
    }
    assert.deepEqual(received, [false, true]);
});

test('classic fallback keeps transformation matrices and respects the same explicit classifier switch', async t => {
    const Inline = createRequire(import.meta.url)('../../participant-web/js/precheck-analyzer.js');
    replace(t, 'FilesetResolver', { forVisionTasks: async () => ({}) });
    let config;
    replace(t, 'FaceLandmarker', { createFromOptions: async (_vision, options) => { config = options; return { close() {} }; } });
    for (const enabled of [false, undefined]) {
        const analyzer = new Inline({ outputFaceBlendshapes: enabled });
        assert.equal(await analyzer.initialize(), true);
        assert.equal(config.outputFaceBlendshapes, enabled !== false);
        assert.equal(config.outputFacialTransformationMatrixes, true);
        analyzer.dispose();
    }
});

test('production and protocol diagnostic use reduced outputs only for the new profile; telemetry is bounded', () => {
    for (const [file, definition] of [['../../participant-web/js/web-page/precheck-updated.js', 'state.runtime.invitationProtocolDefinition'],
        ['../../web/developer/protocol-diagnostic.mjs', 'this.definition']]) {
        const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
        assert.ok(source.includes(`outputFaceBlendshapes: resolveSignalProfile(${definition}).id !== 'protocol_signals.v2'`));
    }
    const packet = { schemaVersion: 'session_feature.v1', ids: { session: 'synthetic-policy' },
        lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, events: [],
        meta: { tech: { framePipeline: {} } } };
    for (const value of ['landmarks_matrix.v1', 'sdk_full.v1', null]) {
        packet.meta.tech.framePipeline.faceOutputPolicy = value;
        assert.deepEqual(policy.validateSessionFeaturePayload(packet), []);
    }
    packet.meta.tech.framePipeline.faceOutputPolicy = 'unvalidated_model';
    assert.ok(policy.validateSessionFeaturePayload(packet).length);
});
