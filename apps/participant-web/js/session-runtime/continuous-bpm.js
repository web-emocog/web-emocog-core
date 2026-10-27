import { BpmPublicationGate } from './bpm-publication-gate.mjs';

const SAMPLE_CAP = 7200;
const stats = () => ({ n: 0, sum: 0, min: null, max: null });
function addStat(acc, value) {
    if (!Number.isFinite(value)) return;
    acc.n++; acc.sum += value;
    acc.min = acc.min === null ? value : Math.min(acc.min, value);
    acc.max = acc.max === null ? value : Math.max(acc.max, value);
}
export function publishedRespiration(features = {}) {
    // Use the engine's existing 0.20 publication threshold, never its raw peak.
    return features.respPublished !== false && features.respHeld !== true
        && Number.isFinite(features.respConf) && features.respConf >= 0.20
        && Number.isFinite(features.respRate) && features.respRate >= 6 && features.respRate <= 24
        ? features.respRate : null;
}

const MODULE_URL = new URL(
    '../../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=20261025-1',
    import.meta.url
);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function updateDiagnostics(patch) {
    if (typeof window === 'undefined') return;
    window.__WECOG_BPM_DIAG__ = {
        ...(window.__WECOG_BPM_DIAG__ || {}),
        ...patch,
        updatedAt: Date.now()
    };
}

function copyLandmarks(landmarks, target) {
    target.length = landmarks.length;
    for (let index = 0; index < landmarks.length; index += 1) {
        const source = landmarks[index];
        const point = target[index] || {};
        point.x = Number(source?.x) || 0;
        point.y = Number(source?.y) || 0;
        point.z = Number(source?.z) || 0;
        point.visibility = Number.isFinite(source?.visibility)
            ? Number(source.visibility)
            : undefined;
        point.presence = Number.isFinite(source?.presence)
            ? Number(source.presence)
            : undefined;
        target[index] = point;
    }
    return target;
}

export class ContinuousBpmCollector {
    constructor(options = {}) {
        this.getFps = options.getFps || (() => 30);
        this.onError = options.onError || (() => {});
        this.onRecovered = options.onRecovered || (() => {});
        this.engine = null;
        this.reporter = null;
        this.canvas = null;
        this.context = null;
        this.samples = [];
        this.startedAt = null;
        this.ready = false;
        this.finalized = false;
        this.lastSample = null;
        this.landmarkBuffer = [];
        this.consecutiveErrors = 0;
        this.publicationGate = new BpmPublicationGate();
        this.rejectedSampleCount = 0;
        this.sampleCount = 0;
        this.lastFrameTimestamp = null;
        this.bpmStats = stats(); this.respStats = stats();
        updateDiagnostics({
            moduleLoaded: false,
            reporterAvailable: false,
            lastImportUrl: MODULE_URL.href,
            importAttempts: 0,
            lastError: null
        });
    }

    async start() {
        if (this.finalized) return false;
        if (this.ready) return true;
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const retryUrl = new URL(MODULE_URL);
            if (attempt > 1) retryUrl.searchParams.set('bpm_retry', String(attempt));
            const importUrl = retryUrl.href;
            updateDiagnostics({
                lastImportUrl: importUrl,
                importAttempts: Number(globalThis.__WECOG_BPM_DIAG__?.importAttempts || 0) + 1,
                lastError: lastError?.message || null
            });
            try {
                const module = await import(importUrl);
                if (this.finalized) return false;
                this.engine = new module.RppgEngine({ algorithm: 'pos', mode: 'safe' });
                this.reporter = module.SessionReporter ? new module.SessionReporter({ maxSamples: SAMPLE_CAP }) : null;
                this.canvas = document.createElement('canvas');
                this.context = this.canvas.getContext('2d', { willReadFrequently: true });
                this.startedAt = Date.now();
                this.ready = true;
                updateDiagnostics({
                    moduleLoaded: true,
                    reporterAvailable: !!this.reporter,
                    consecutiveErrors: 0,
                    lastError: null
                });
                return true;
            } catch (error) {
                lastError = error;
                updateDiagnostics({
                    moduleLoaded: false,
                    lastError: error?.message || String(error)
                });
                if (attempt < 3 && !this.finalized) await delay(attempt * 200);
            }
        }
        if (!this.finalized) this.onError(lastError);
        return false;
    }

    process(video, landmarks, timestampMs = performance.now(), sharedPixels = null, captureWallTime = null) {
        if (this.finalized || !this.ready || !this.engine || !this.context || !Array.isArray(landmarks)) return null;
        if (!Number.isFinite(timestampMs) || (this.lastFrameTimestamp !== null && timestampMs <= this.lastFrameTimestamp)) return null;
        const wallTime = Number.isFinite(captureWallTime) ? captureWallTime : Date.now();
        const width = sharedPixels?.width || video?.videoWidth || 0;
        const height = sharedPixels?.height || video?.videoHeight || 0;
        if (!width || !height || landmarks.length < 468) return null;
        this.lastFrameTimestamp = timestampMs;

        try {
            let imageData = sharedPixels;
            if (!imageData || imageData.width !== width || imageData.height !== height) {
                if (this.canvas.width !== width || this.canvas.height !== height) {
                    this.canvas.width = width;
                    this.canvas.height = height;
                }
                this.context.drawImage(video, 0, 0, width, height);
                imageData = this.context.getImageData(0, 0, width, height);
            }
            // MediaPipe may expose immutable landmark objects (notably in WebKit).
            // rPPG receives an owned plain-data snapshot so downstream processing
            // cannot trip over readonly host objects.
            const output = this.engine.update({
                timestampMs,
                frameW: width,
                frameH: height,
                imageData,
                landmarks: copyLandmarks(landmarks, this.landmarkBuffer),
                fps: this.getFps()
            });
            const recovered = this.consecutiveErrors > 0;
            this.consecutiveErrors = 0;
            if (recovered) this.onRecovered();
            if (!output) {
                updateDiagnostics({ consecutiveErrors: 0, lastError: null });
                return null;
            }

            const features = output.features || {};
            const publication = this.publicationGate.evaluate(output);
            const measuredBpm = publication.accepted && publication.held !== true;
            const respiration = publishedRespiration(features);
            if (!publication.accepted) this.rejectedSampleCount += 1;
            if (this.reporter) {
                this.reporter.push({
                    ...output,
                    published: measuredBpm,
                    bpmPublished: measuredBpm ? publication.bpm : null,
                    features: { ...features, respRate: respiration },
                    publishReason: publication.reason
                }, timestampMs);
            }
            const sample = {
                t: wallTime,
                monotonicMs: performance.timeOrigin + timestampMs,
                bpm: publication.bpm,
                published: measuredBpm,
                held: publication.held === true,
                publicationReason: publication.reason,
                classification: publication.classification || null,
                confidence: Number.isFinite(output.confidence) ? output.confidence : null,
                respRate: respiration,
                respConf: Number.isFinite(features.respConf) ? features.respConf : null
            };
            this.lastSample = sample;
            this.sampleCount++;
            if (measuredBpm) addStat(this.bpmStats, sample.bpm);
            addStat(this.respStats, respiration);
            if (sample.bpm != null || sample.respRate != null) {
                this.samples.push(sample);
                if (this.samples.length > SAMPLE_CAP) this.samples.splice(0, this.samples.length - SAMPLE_CAP);
            }
            const roiDiagnostics = output.roiDiagnostics || {};
            updateDiagnostics({
                moduleLoaded: true,
                roiDetected: Object.values(roiDiagnostics).some(roi => roi?.active),
                signalQuality: Number.isFinite(output.confidence) ? output.confidence : null,
                confidence: Number.isFinite(output.confidence) ? output.confidence : null,
                bpmEstimate: sample.bpm,
                bpmRejectedReason: publication.accepted ? null : publication.reason,
                bufferLength: this.samples.length,
                sampleCount: this.samples.length,
                consecutiveErrors: 0,
                lastError: null
            });
            return sample;
        } catch (error) {
            this.consecutiveErrors += 1;
            updateDiagnostics({
                lastError: error?.message || String(error),
                consecutiveErrors: this.consecutiveErrors
            });
            if (this.consecutiveErrors >= 3) this.onError(error);
            return null;
        }
    }

    snapshot() {
        return {
            ready: this.ready,
            methodVersion: 'continuous_signals.v2',
            sampleCount: this.sampleCount,
            retainedSampleCount: this.samples.length,
            validSampleCount: this.bpmStats.n,
            bpmMin: this.bpmStats.min,
            bpmMax: this.bpmStats.max,
            bpmMean: this.bpmStats.n ? this.bpmStats.sum / this.bpmStats.n : null,
            respRateMean: this.respStats.n ? this.respStats.sum / this.respStats.n : null,
            validRespSampleCount: this.respStats.n,
            respRateMin: this.respStats.min,
            respRateMax: this.respStats.max,
            lastSample: this.lastSample ? { ...this.lastSample } : null,
            rejectedSampleCount: this.rejectedSampleCount
        };
    }

    finalize(reason = 'session_finish') {
        if (this.finalized) return null;
        this.finalized = true;
        const summary = this.snapshot();
        return {
            mode: 'continuous_session',
            methodVersion: 'continuous_signals.v2',
            reason,
            startedAt: this.startedAt,
            completedAt: Date.now(),
            durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
            sampleCount: summary.sampleCount,
            validSampleCount: summary.validSampleCount,
            retainedSampleCount: summary.retainedSampleCount,
            rejectedSampleCount: summary.rejectedSampleCount,
            bpmMean: Number.isFinite(summary.bpmMean) ? summary.bpmMean : null,
            respRateMean: Number.isFinite(summary.respRateMean) ? summary.respRateMean : null,
            validRespSampleCount: summary.validRespSampleCount,
            respRateMin: summary.respRateMin,
            respRateMax: summary.respRateMax,
            bpmMin: this.bpmStats.min,
            bpmMax: this.bpmStats.max,
            rppgSession: this.reporter ? this.reporter.finalize() : null,
            samples: [...this.samples]
        };
    }
}
