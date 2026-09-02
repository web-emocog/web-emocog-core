import { BpmPublicationGate } from './bpm-publication-gate.mjs';

const MODULE_URL = new URL(
    '../../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js',
    import.meta.url
);

function mean(values) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

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
        updateDiagnostics({
            moduleLoaded: false,
            reporterAvailable: false,
            lastImportUrl: MODULE_URL.href,
            importAttempts: 0,
            lastError: null
        });
    }

    async start() {
        if (this.ready) return true;
        if (this.finalized) return false;
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const importUrl = attempt === 1
                ? MODULE_URL.href
                : `${MODULE_URL.href}?bpm_retry=${attempt}`;
            updateDiagnostics({
                lastImportUrl: importUrl,
                importAttempts: Number(globalThis.__WECOG_BPM_DIAG__?.importAttempts || 0) + 1,
                lastError: lastError?.message || null
            });
            try {
                const module = await import(importUrl);
                if (this.finalized) return false;
                this.engine = new module.RppgEngine({ algorithm: 'pos', mode: 'safe' });
                this.reporter = module.SessionReporter ? new module.SessionReporter() : null;
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

    process(video, landmarks, timestampMs = performance.now()) {
        if (!this.ready || !this.engine || !this.context || !Array.isArray(landmarks)) return null;
        const width = video?.videoWidth || 0;
        const height = video?.videoHeight || 0;
        if (!width || !height || landmarks.length < 468) return null;

        try {
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }
            this.context.drawImage(video, 0, 0, width, height);
            const imageData = this.context.getImageData(0, 0, width, height);
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
            if (!publication.accepted) this.rejectedSampleCount += 1;
            if (this.reporter) {
                this.reporter.push({
                    ...output,
                    published: publication.accepted,
                    bpmPublished: publication.bpm,
                    publishReason: publication.reason
                }, timestampMs);
            }
            const sample = {
                t: Date.now(),
                bpm: publication.bpm,
                published: publication.accepted,
                publicationReason: publication.reason,
                classification: publication.classification || null,
                confidence: Number.isFinite(output.confidence) ? output.confidence : null,
                respRate: Number.isFinite(features.respRate)
                    ? features.respRate
                    : (Number.isFinite(features.respRateRaw) ? features.respRateRaw : null),
                respConf: Number.isFinite(features.respConf) ? features.respConf : null
            };
            this.lastSample = sample;
            if (sample.bpm != null || sample.respRate != null) this.samples.push(sample);
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
        const bpmValues = this.samples.map(sample => sample.bpm).filter(Number.isFinite);
        const respValues = this.samples.map(sample => sample.respRate).filter(Number.isFinite);
        return {
            ready: this.ready,
            sampleCount: this.samples.length,
            bpmMean: mean(bpmValues),
            respRateMean: mean(respValues),
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
            reason,
            startedAt: this.startedAt,
            completedAt: Date.now(),
            durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
            sampleCount: summary.sampleCount,
            validSampleCount: this.samples.filter(sample => sample.published === true && Number.isFinite(sample.bpm)).length,
            rejectedSampleCount: summary.rejectedSampleCount,
            bpmMean: Number.isFinite(summary.bpmMean) ? summary.bpmMean : null,
            respRateMean: Number.isFinite(summary.respRateMean) ? summary.respRateMean : null,
            rppgSession: this.reporter ? this.reporter.finalize() : null,
            samples: [...this.samples]
        };
    }
}
