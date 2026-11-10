import { PrecheckAnalyzer } from '../../participant-web/js/precheck-analyzer/PrecheckAnalyzer.js?v=20261104-4';
import { FaceSegmenter } from '../../participant-web/js/face-segmenter/FaceSegmenter.js?v=20261104-4';
import { QCMetrics } from '../../participant-web/js/qc-metrics/index.js?v=20261104-4';
import { SessionFramePipeline } from '../../participant-web/js/session-runtime/frame-pipeline.js?v=20261104-4';
import { MultimodalSessionCollector } from '../../participant-web/js/multimodal/session-collector.js';
import { createMonotonicClock } from '../../../packages/shared/multimodal/timebase.mjs';
import { PROTOCOL_PROFILE_ID, MODEL_ASSETS, FRAME_SCHEDULE, protocolCameraConstraints, frameBudget } from '../../participant-web/js/session-runtime/protocol-profile.mjs?v=20261104-4';
import { measureVideoFps } from '../../participant-web/js/session-runtime/video-frames.mjs?v=20261104-4';
import { resolveSessionFeatureFlags } from '../../participant-web/js/session-runtime/feature-flags.mjs';
import { getContentViewport } from '../../participant-web/js/gaze-tracker/viewport-coordinates.mjs';
import { DiagnosticRun, SerialDiagnosticStage, waitForDiagnosticVideo } from './diagnostic-run.mjs?v=20261028-1';

import { authorizeDiagnostic } from './diagnostic-access.mjs?v=20261104-4';
import { observeEmotionSamples } from '../../participant-web/js/emotion/public-api.js';
import { EmotionDiagnostics } from './emotion-diagnostics.mjs';

export class ProtocolDiagnostic {
    constructor({ video, onUpdate = () => {}, onStatus = () => {}, emotionDiagnostics = false }) {
        this.emotionDiagnosticsEnabled = emotionDiagnostics;
        this.emotionDiagnostics = null;
        this.video = video;
        this.onUpdate = onUpdate;
        this.onStatus = onStatus;
        this.run = null;
        this.pending = null;
        this.models = new SerialDiagnosticStage();
        this.camera = new SerialDiagnosticStage();
        this.blocked = false;
        this.state = null;
        this.pipeline = null;
        this.timer = null;
    }

    start() {
        if (this.pending) return this.pending;
        if (this.run || this.blocked) return Promise.resolve(false);
        this.issues = new Map();
        const run = this.run = new DiagnosticRun();
        const pending = this._start(run).finally(() => { if (this.pending === pending) this.pending = null; });
        this.pending = pending;
        return pending;
    }

    async _start(run) {
        try {
            this.onStatus('access');
            await authorizeDiagnostic(run);
            if (this.emotionDiagnosticsEnabled) {
                this.emotionDiagnostics = new EmotionDiagnostics();
                const diagnostics = this.emotionDiagnostics;
                run.onStop(observeEmotionSamples((sample, calibration) => {
                    if (this.run === run && !run.signal.aborted) diagnostics.record(sample, calibration);
                }));
            }
            this.onStatus('models');
            const vision = await run.wait(() => import('../../participant-web/js/vendor/mediapipe/vision_bundle.mjs'));
            run.check();
            Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker,
                ImageSegmenter: vision.ImageSegmenter, PoseLandmarker: vision.PoseLandmarker });
            const analyzer = new PrecheckAnalyzer(), segmenter = new FaceSegmenter();
            run.onStop(() => analyzer.dispose()); run.onStop(() => segmenter.dispose());
            await this.models.request(run, async () => {
                if (!await analyzer.initialize() || !await segmenter.initialize()) throw new Error('Diagnostic models unavailable');
            });
            run.check();
            this.onStatus('camera');
            const stream = await this.camera.request(run, () => {
                window.WecogStaffSession?.assertCurrent();
                return navigator.mediaDevices.getUserMedia(protocolCameraConstraints());
            },
                { release: value => value.getTracks().forEach(track => track.stop()) });
            run.check();
            this.video.srcObject = stream;
            run.onStop(() => {
                try { this.pipeline?.stop('developer_stop'); }
                finally {
                    this.state?.runtime.qcMetrics.stop();
                    this.multimodal?.stop();
                    if (this.state) this.state.runtime.lastPrecheckResult = null;
                    if (this.video.srcObject === stream) this.video.srcObject = null;
                }
            });
            await run.wait(() => this.video.play(), { timeoutMs: 10000 });
            await waitForDiagnosticVideo(this.video, run);
            this.onStatus('sampling');
            const camera = await measureVideoFps(this.video, 2000, { signal: run.signal });
            run.check();
            const clock = createMonotonicClock();
            const viewport = getContentViewport();
            const qc = new QCMetrics({ screenWidth: viewport.width, screenHeight: viewport.height });
            const flags = resolveSessionFeatureFlags();
            const state = this.state = { sessionData: { startTime: Date.now(), ids: { session: 'developer-' + crypto.randomUUID() },
                tech: { cameraFPS: camera.fps, cameraFPSDetails: camera }, events: [] }, runtime: {
                currentPhase: 'developer_diagnostic', taskContext: {}, localAnalyzer: analyzer, faceSegmenter: segmenter, qcMetrics: qc } };
            const multimodal = this.multimodal = new MultimodalSessionCollector({ state, clock, enabled: flags.multimodal,
                bodyEnabled: flags.bodyMovement, gamerMode: flags.gamerMode }); multimodal.start();
            const issues = new Map(); this.issues = issues;
            const controller = { featureFlags: flags, sessionClock: clock,
                setModuleStatus() {}, reportIssue: issue => issues.set(issue.code, { code: issue.code, kind: issue.kind }),
                resolveIssue: code => issues.delete(code), captureMultimodalFrame: input => multimodal.captureFrame(input) };
            const pipeline = this.pipeline = new SessionFramePipeline({ state, controller, video: this.video });
            qc.start();
            if (!await pipeline.start()) throw new Error('Diagnostic pipeline unavailable');
            run.check();
            this.onStatus('running');
            this.timer = setInterval(() => {
                if (this.run === run && !run.signal.aborted) this.onUpdate(this.snapshot());
            }, 200);
            run.onStop(() => { clearInterval(this.timer); this.timer = null; });
            this.onUpdate(this.snapshot());
            return true;
        } catch (error) {
            if (this.run !== run) return false;
            this.stop(); throw error;
        }
    }

    snapshot() {
        const state = this.state, pipeline = this.pipeline;
        const diagnostics = state?.sessionData.tech.framePipeline || null;
        const frame = state?.runtime.lastPrecheckResult;
        const settings = this.video.srcObject?.getVideoTracks?.()[0]?.getSettings?.();
        return { profileId: PROTOCOL_PROFILE_ID, models: MODEL_ASSETS, schedule: FRAME_SCHEDULE,
            camera: settings ? { width: settings.width, height: settings.height, frameRate: settings.frameRate, facingMode: settings.facingMode } : null,
            diagnostics, emotionDiagnostics: this.emotionDiagnostics?.snapshot() ?? null,
            budget: diagnostics?.budget || frameBudget(),
            frame: frame ? { faceDetected: frame.face?.detected === true, illumination: frame.illumination?.value } : null,
            bpm: pipeline?.bpm.lastSample || null,
            emotion: state?.runtime.lastEmotionSample || null, body: state?.runtime.lastBodyPoseSample || null,
            bodyBursts: state?.sessionData.bodyPoseAccumulator?.movementBurstCount ?? 0,
            qc: state?.runtime.qcMetrics.getCurrentMetrics() || null, issues: [...(this.issues?.values() || [])] };
    }

    stop() {
        const run = this.run; this.run = null;
        this.pending = null;
        run?.stop();
        this.pipeline = null;
        this.multimodal = null;
        this.state = null;
        this.issues?.clear();
        try { this.video.pause(); } catch (_) {}
        this.video.srcObject = null;
        this.onStatus('stopped');
    }
}
