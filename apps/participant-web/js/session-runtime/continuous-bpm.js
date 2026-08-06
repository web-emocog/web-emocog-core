const MODULE_URL = new URL(
    '../../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js',
    import.meta.url
);

function mean(values) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export class ContinuousBpmCollector {
    constructor(options = {}) {
        this.getFps = options.getFps || (() => 30);
        this.onError = options.onError || (() => {});
        this.engine = null;
        this.reporter = null;
        this.canvas = null;
        this.context = null;
        this.samples = [];
        this.startedAt = null;
        this.ready = false;
        this.finalized = false;
        this.lastSample = null;
    }

    async start() {
        if (this.ready) return true;
        if (this.finalized) return false;
        try {
            const module = await import(MODULE_URL.href);
            if (this.finalized) return false;
            this.engine = new module.RppgEngine({ algorithm: 'pos', mode: 'safe' });
            this.reporter = module.SessionReporter ? new module.SessionReporter() : null;
            this.canvas = document.createElement('canvas');
            this.context = this.canvas.getContext('2d', { willReadFrequently: true });
            this.startedAt = Date.now();
            this.ready = true;
            return true;
        } catch (error) {
            if (!this.finalized) this.onError(error);
            return false;
        }
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
            const output = this.engine.update({
                timestampMs,
                frameW: width,
                frameH: height,
                imageData,
                landmarks,
                fps: this.getFps()
            });
            if (output && this.reporter) this.reporter.push(output, timestampMs);
            if (!output) return null;

            const features = output.features || {};
            const bpm = output.bpmPublished ?? output.bpmSmoothed ?? output.bpm;
            const sample = {
                t: Date.now(),
                bpm: Number.isFinite(bpm) ? Number(bpm) : null,
                published: output.published === true,
                confidence: Number.isFinite(output.confidence) ? output.confidence : null,
                respRate: Number.isFinite(features.respRate)
                    ? features.respRate
                    : (Number.isFinite(features.respRateRaw) ? features.respRateRaw : null),
                respConf: Number.isFinite(features.respConf) ? features.respConf : null
            };
            this.lastSample = sample;
            if (sample.bpm != null || sample.respRate != null) this.samples.push(sample);
            return sample;
        } catch (error) {
            this.onError(error);
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
            lastSample: this.lastSample ? { ...this.lastSample } : null
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
            validSampleCount: this.samples.filter(sample => Number.isFinite(sample.bpm)).length,
            bpmMean: Number.isFinite(summary.bpmMean) ? summary.bpmMean : null,
            respRateMean: Number.isFinite(summary.respRateMean) ? summary.respRateMean : null,
            rppgSession: this.reporter ? this.reporter.finalize() : null,
            samples: [...this.samples]
        };
    }
}
