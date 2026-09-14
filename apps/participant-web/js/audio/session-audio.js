import {
    MODULE_VERSION as CORE_VERSION,
    analyzePcmSamples
} from '../../../../Audio_detection/browser/open-vocal-biomarkers.mjs';

export const AUDIO_SESSION_VERSION = 'audio_session.v1';
const DISCLAIMER = 'Исследовательские акустические признаки не являются диагнозом или медицинским заключением.';
const DEFAULT_WINDOW_SECONDS = 10;
const DEFAULT_WORKER_TIMEOUT_MS = 15_000;
const RETAINED_WINDOW_CAP = 360;

function finite(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function mean(values) {
    const valid = (values || []).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function phaseContext(state) {
    const task = state.runtime?.taskContext || {};
    return {
        phase: state.runtime?.currentPhase || null,
        blockId: task.blockId ?? null,
        attempt: task.attempt ?? null,
        trialId: task.trialId ?? null,
        stimulusId: task.stimulusId ?? null,
        presentationId: task.presentationId ?? null
    };
}

function signalQc(samples, sampleRate) {
    let squareSum = 0;
    let clipped = 0;
    for (let index = 0; index < samples.length; index += 1) {
        const value = Number(samples[index]) || 0;
        squareSum += value * value;
        if (Math.abs(value) >= 0.98) clipped += 1;
    }
    const durationSec = samples.length / Math.max(1, sampleRate);
    const rms = samples.length ? Math.sqrt(squareSum / samples.length) : 0;
    const clippingRatio = samples.length ? clipped / samples.length : 0;
    return {
        durationSec,
        rms,
        clippingRatio,
        silence: rms < 0.003,
        clipping: clippingRatio > 0.05,
        short: durationSec < 3,
        unsupportedSampleRate: sampleRate < 8000 || sampleRate > 192000
    };
}

function compactMarkers(markers, accepted) {
    if (!accepted || !Array.isArray(markers)) return [];
    return markers.slice(0, 16).map(marker => ({
        id: String(marker?.id || '').slice(0, 64),
        score: finite(marker?.score),
        level: String(marker?.level || 'unknown').slice(0, 32)
    }));
}

function compactBiomarkers(features, accepted) {
    if (!accepted || !features || typeof features !== 'object') return null;
    const allowed = [
        'pitch_mean_hz',
        'pitch_std_hz',
        'pitch_variability',
        'jitter_local',
        'shimmer_local',
        'hnr_db',
        'speech_fraction',
        'pause_rate',
        'avg_pause_duration',
        'max_pause_duration',
        'mean_utterance_duration'
    ];
    return Object.fromEntries(allowed.map(key => [key, finite(features[key])]));
}

const BLOCKING_ANALYSIS_REASONS = new Set([
    'quality_ood',
    'low_quality_score',
    'strict_low_quality',
    'strict_ood'
]);

export function audioWindowAcceptance(qc, analysis, analysisError = null) {
    const analysisReasons = (analysis?.decision?.reasons || []).map(String);
    const blockingAnalysisReasons = analysisReasons.filter(reason => (
        BLOCKING_ANALYSIS_REASONS.has(reason)
    ));
    const accepted = !analysisError
        && !qc.silence
        && !qc.clipping
        && !qc.short
        && !qc.unsupportedSampleRate
        && analysis?.quality?.is_ood !== true
        && blockingAnalysisReasons.length === 0;
    return {
        accepted,
        featureReliable: analysis?.decision?.status === 'ok',
        analysisReasons
    };
}

export function analyzeAudioWindow(samples, sampleRate, context = {}) {
    const qc = signalQc(samples, sampleRate);
    let analysis = null;
    let analysisError = null;
    try {
        analysis = analyzePcmSamples(samples, sampleRate, {
            strict_mode: false,
            max_audio_duration_sec: 0,
            abstain_confidence_threshold: 0.35,
            abstain_quality_threshold: 0.40
        });
    } catch (error) {
        analysisError = error?.message || String(error);
    }
    const acceptance = audioWindowAcceptance(qc, analysis, analysisError);
    const accepted = acceptance.accepted;
    const reasons = [
        ...(qc.silence ? ['silence'] : []),
        ...(qc.clipping ? ['clipping'] : []),
        ...(qc.short ? ['short_window'] : []),
        ...(qc.unsupportedSampleRate ? ['unsupported_sample_rate'] : []),
        ...acceptance.analysisReasons,
        ...(analysisError ? ['analysis_error'] : [])
    ];
    const coreQuality = finite(analysis?.quality?.score) ?? 0;
    const reliability = accepted && acceptance.featureReliable
        ? clamp01(coreQuality * (1 - Math.min(1, qc.clippingRatio * 5)))
        : null;
    return {
        schemaVersion: AUDIO_SESSION_VERSION,
        algorithmVersion: `open_vocal_biomarkers.${CORE_VERSION}`,
        startMonotonicMs: finite(context.startMonotonicMs),
        endMonotonicMs: finite(context.endMonotonicMs),
        sessionStartMs: finite(context.sessionStartMs),
        sessionEndMs: finite(context.sessionEndMs),
        ...context.scope,
        durationMs: Math.round(qc.durationSec * 1000),
        sampleRate,
        accepted,
        reliability,
        qc: {
            valid: accepted,
            reasons: [...new Set(reasons)].slice(0, 16),
            rms: Number(qc.rms.toFixed(6)),
            clippingRatio: Number(qc.clippingRatio.toFixed(6)),
            silence: qc.silence,
            clipping: qc.clipping,
            short: qc.short,
            isOod: analysis?.quality?.is_ood === true,
            qualityScore: finite(analysis?.quality?.score),
            snrProxyDb: finite(analysis?.quality?.snr_proxy_db),
            speechFraction: finite(analysis?.quality?.speech_fraction)
        },
        markers: compactMarkers(analysis?.markers, accepted && acceptance.featureReliable),
        biomarkers: compactBiomarkers(analysis?.raw_features, accepted),
        disclaimer: DISCLAIMER
    };
}

export function summarizeAudioWindows(windows, metadata = {}) {
    const list = Array.isArray(windows) ? windows : [];
    const accepted = list.filter(window => window?.accepted === true);
    const markerBuckets = new Map();
    for (const window of accepted) {
        for (const marker of window.markers || []) {
            if (!Number.isFinite(marker?.score)) continue;
            if (!markerBuckets.has(marker.id)) markerBuckets.set(marker.id, []);
            markerBuckets.get(marker.id).push(marker.score);
        }
    }
    return {
        schemaVersion: AUDIO_SESSION_VERSION,
        algorithmVersion: `open_vocal_biomarkers.${CORE_VERSION}`,
        status: metadata.status || 'completed',
        enabled: metadata.enabled === true,
        consentGranted: metadata.consentGranted === true,
        permission: metadata.permission || 'not_requested',
        rawAudioStored: false,
        rawAudioTransmitted: false,
        sampleRate: finite(metadata.sampleRate),
        windowDurationMs: finite(metadata.windowDurationMs),
        windowCount: list.length,
        acceptedWindowCount: accepted.length,
        rejectedWindowCount: Math.max(0, list.length - accepted.length),
        droppedWindowCount: Number(metadata.droppedWindowCount || 0),
        durationMs: list.reduce((sum, window) => sum + (finite(window?.durationMs) || 0), 0),
        qualityMean: mean(accepted.map(window => finite(window?.qc?.qualityScore))),
        reliabilityMean: mean(accepted.map(window => finite(window?.reliability))),
        markers: [...markerBuckets.entries()].map(([id, values]) => ({
            id,
            meanScore: mean(values),
            sampleCount: values.length
        })),
        windows: list.slice(-RETAINED_WINDOW_CAP),
        provenance: {
            coreLicense: 'MIT',
            analysisLocation: 'participant_browser',
            windowing: 'non_overlapping_pcm',
            debugCapture: false
        },
        disclaimer: DISCLAIMER
    };
}

export function summarizeAudioTaskWindows(windows, testType = 'reading', metadata = {}) {
    const list = Array.isArray(windows) ? windows : [];
    const accepted = list.filter(window => window?.accepted === true);
    const biomarkerMean = key => mean(accepted.map(window => finite(window?.biomarkers?.[key])));
    const qcMean = key => mean(accepted.map(window => finite(window?.qc?.[key])));
    const quality = qcMean('qualityScore');
    const reliability = mean(accepted.map(window => finite(window?.reliability)));
    const speechCoverage = mean(accepted.map(window => (
        finite(window?.qc?.speechFraction) ?? finite(window?.biomarkers?.speech_fraction)
    )));
    const scoreParts = [quality, reliability, speechCoverage].filter(Number.isFinite);
    const audioAvailable = metadata.audioAvailable === true;
    const status = !audioAvailable
        ? 'audio_unavailable'
        : (!list.length ? 'not_recorded' : (accepted.length ? 'completed' : 'insufficient_signal'));
    return {
        schemaVersion: 'audio_task.v1',
        blockId: String(metadata.blockId || '').slice(0, 128),
        title: String(metadata.title || '').slice(0, 255),
        testType: String(testType || 'reading').slice(0, 64),
        status,
        durationMs: finite(metadata.durationMs),
        audioAvailable,
        windowCount: list.length,
        acceptedWindowCount: accepted.length,
        rejectedWindowCount: Math.max(0, list.length - accepted.length),
        completedAt: finite(metadata.completedAt),
        metrics: {
            recordingQuality: quality,
            featureReliability: reliability,
            speechCoverage,
            completionScore: scoreParts.length ? clamp01(mean(scoreParts)) : null,
            rmsMean: qcMean('rms'),
            clippingRatioMean: qcMean('clippingRatio'),
            pitchMeanHz: biomarkerMean('pitch_mean_hz'),
            pitchStdHz: biomarkerMean('pitch_std_hz'),
            pitchVariability: biomarkerMean('pitch_variability'),
            jitterLocal: biomarkerMean('jitter_local'),
            shimmerLocal: biomarkerMean('shimmer_local'),
            hnrDb: biomarkerMean('hnr_db'),
            pauseRate: biomarkerMean('pause_rate'),
            averagePauseDuration: biomarkerMean('avg_pause_duration'),
            meanUtteranceDuration: biomarkerMean('mean_utterance_duration')
        },
        rawAudioStored: false,
        rawAudioTransmitted: false
    };
}

export class SessionAudioCollector {
    constructor(options = {}) {
        this.state = options.state;
        this.clock = options.clock;
        this.enabled = options.enabled === true;
        this.mediaDevices = options.mediaDevices || globalThis.navigator?.mediaDevices;
        this.AudioContextCtor = options.AudioContextCtor
            || globalThis.AudioContext
            || globalThis.webkitAudioContext;
        this.WorkerCtor = options.WorkerCtor === null
            ? null
            : (options.WorkerCtor || globalThis.Worker);
        this.AudioWorkletNodeCtor = options.AudioWorkletNodeCtor
            || globalThis.AudioWorkletNode;
        this.recordEvent = options.recordEvent || (() => {});
        this.windowSeconds = finite(options.windowSeconds) || DEFAULT_WINDOW_SECONDS;
        this.workerTimeoutMs = finite(options.workerTimeoutMs) || DEFAULT_WORKER_TIMEOUT_MS;
        this.stream = null;
        this.context = null;
        this.source = null;
        this.processor = null;
        this.mute = null;
        this.pendingChunks = [];
        this.pendingSamples = 0;
        this.windows = [];
        this.worker = null;
        this.workerSequence = 0;
        this.workerPending = new Map();
        this.droppedWindowCount = 0;
        this.analysisQueue = Promise.resolve();
        this.started = false;
        this.everStarted = false;
        this.stopRequested = false;
        this.paused = false;
        this.stopPromise = null;
        this.sampleRate = null;
        this.permission = 'not_requested';
        this.status = this.enabled ? 'idle' : 'disabled';
    }

    _consentGranted() {
        return this.state?.sessionData?.audioConsent?.granted === true;
    }

    async start() {
        if (this.started) return true;
        if (this.stopRequested) return false;
        if (!this.enabled) {
            this._storeSummary('disabled');
            return false;
        }
        if (!this._consentGranted()) {
            this.status = 'declined';
            this._storeSummary('declined');
            return false;
        }
        if (!this.mediaDevices?.getUserMedia || !this.AudioContextCtor) {
            this.status = 'unsupported';
            this.permission = 'unsupported';
            this._storeSummary('unsupported');
            return false;
        }
        try {
            this.permission = 'requested';
            this.status = 'requesting_permission';
            // Construct the context while still in the participant's user
            // gesture; permission prompts may otherwise consume activation.
            this.context = new this.AudioContextCtor({ latencyHint: 'interactive' });
            this.sampleRate = Number(this.context.sampleRate || 0);
            this.stream = await this.mediaDevices.getUserMedia({
                audio: {
                    channelCount: { ideal: 1 },
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false
                },
                video: false
            });
            if (this.stopRequested) {
                await this._teardownGraph();
                this.status = 'stopped';
                this._storeSummary(this.status);
                return false;
            }
            this.permission = 'granted';
            this.source = this.context.createMediaStreamSource(this.stream);
            if (this.context.audioWorklet?.addModule && this.AudioWorkletNodeCtor) {
                try {
                    await this.context.audioWorklet.addModule(
                        new URL('./pcm-capture-worklet.js', import.meta.url)
                    );
                    this.processor = new this.AudioWorkletNodeCtor(
                        this.context,
                        'wecog-pcm-capture',
                        { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 }
                    );
                    this.processor.port.onmessage = event => this._captureSamples(event.data);
                } catch (error) {
                    this.processor = null;
                    this.recordEvent('audio_worklet_fallback', {
                        reason: error?.name || 'worklet_unavailable'
                    });
                }
            }
            if (!this.processor) {
                const createProcessor = this.context.createScriptProcessor
                    || this.context.createJavaScriptNode;
                if (typeof createProcessor !== 'function') {
                    throw new Error('WebAudio PCM processor is unavailable');
                }
                this.processor = createProcessor.call(this.context, 2048, 1, 1);
                this.processor.onaudioprocess = event => this._capture(event);
            }
            this.mute = this.context.createGain();
            this.mute.gain.value = 0;
            this.source.connect(this.processor);
            this.processor.connect(this.mute);
            this.mute.connect(this.context.destination);
            await this.context.resume?.();
            this._startWorker();
            this.started = true;
            this.everStarted = true;
            this.status = 'running';
            this.state.runtime.audioStream = this.stream;
            this.recordEvent('audio_module_started', {
                sampleRate: this.sampleRate,
                rawAudioStored: false
            });
            return true;
        } catch (error) {
            this.permission = error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
                ? 'denied'
                : 'failed';
            this.status = this.permission === 'denied' ? 'permission_denied' : 'failed';
            await this._teardownGraph();
            this._storeSummary(this.status);
            this.recordEvent('audio_module_unavailable', {
                permission: this.permission,
                reason: error?.name || 'audio_start_failed'
            });
            return false;
        }
    }

    _capture(event) {
        if (!this.started || this.paused) return;
        const channel = event?.inputBuffer?.getChannelData?.(0);
        this._captureSamples(channel);
    }

    _captureSamples(channel) {
        if (!this.started || this.paused || !channel?.length) return;
        this.pendingChunks.push(new Float32Array(channel));
        this.pendingSamples += channel.length;
        const windowSize = Math.max(1, Math.round(this.sampleRate * this.windowSeconds));
        while (this.pendingSamples >= windowSize) {
            this._queueWindow(this._consume(windowSize));
        }
    }

    _consume(count) {
        const output = new Float32Array(count);
        let offset = 0;
        while (offset < count && this.pendingChunks.length) {
            const chunk = this.pendingChunks[0];
            const take = Math.min(chunk.length, count - offset);
            output.set(chunk.subarray(0, take), offset);
            offset += take;
            this.pendingChunks[0] = take === chunk.length ? null : chunk.subarray(take);
            if (this.pendingChunks[0] === null) this.pendingChunks.shift();
        }
        this.pendingSamples = Math.max(0, this.pendingSamples - offset);
        return offset === count ? output : output.subarray(0, offset);
    }

    _queueWindow(samples) {
        if (!samples.length) return;
        const end = this.clock.now();
        const durationMs = samples.length / Math.max(1, this.sampleRate) * 1000;
        const context = {
            startMonotonicMs: end.monotonicMs - durationMs,
            endMonotonicMs: end.monotonicMs,
            sessionStartMs: Math.max(0, end.sessionTimeMs - durationMs),
            sessionEndMs: end.sessionTimeMs,
            scope: phaseContext(this.state)
        };
        this.analysisQueue = this.analysisQueue.then(async () => {
            const result = await this._analyzeWindow(samples, context);
            if (result) {
                this.windows.push(result);
                if (this.windows.length > RETAINED_WINDOW_CAP) this.windows.shift();
            } else {
                this.droppedWindowCount += 1;
            }
            // `samples` is not retained after this callback returns.
        });
    }

    _startWorker() {
        if (!this.WorkerCtor || this.worker) return false;
        try {
            this.worker = new this.WorkerCtor(
                new URL('./audio-window-worker.js?v=20260914-1', import.meta.url),
                { type: 'module', name: 'wecog-audio-analysis' }
            );
            this.worker.onmessage = event => {
                const pending = this.workerPending.get(event?.data?.id);
                if (!pending) return;
                this.workerPending.delete(event.data.id);
                clearTimeout(pending.timeoutId);
                pending.resolve(event.data.ok ? event.data.result : null);
            };
            this.worker.onerror = () => this._disableWorker();
            return true;
        } catch (_) {
            this.worker = null;
            return false;
        }
    }

    _disableWorker() {
        for (const pending of this.workerPending.values()) {
            clearTimeout(pending.timeoutId);
            pending.resolve(null);
        }
        this.workerPending.clear();
        try { this.worker?.terminate?.(); } catch (_) {}
        this.worker = null;
    }

    _analyzeWindow(samples, context) {
        if (!this.worker) {
            return Promise.resolve(analyzeAudioWindow(samples, this.sampleRate, context));
        }
        const id = ++this.workerSequence;
        return new Promise(resolve => {
            const timeoutId = setTimeout(() => {
                const pending = this.workerPending.get(id);
                if (!pending) return;
                this.workerPending.delete(id);
                pending.resolve(null);
            }, this.workerTimeoutMs);
            this.workerPending.set(id, { resolve, timeoutId });
            try {
                this.worker.postMessage({
                    id,
                    samples,
                    sampleRate: this.sampleRate,
                    context
                }, [samples.buffer]);
            } catch (_) {
                const pending = this.workerPending.get(id);
                clearTimeout(pending?.timeoutId);
                this.workerPending.delete(id);
                resolve(analyzeAudioWindow(samples, this.sampleRate, context));
            }
        });
    }

    _flushPendingWindow() {
        if (this.pendingSamples <= 0) return;
        this._queueWindow(this._consume(this.pendingSamples));
    }

    async flushBoundary() {
        if (this.started) this._flushPendingWindow();
        await this.analysisQueue;
        this._storeSummary(this.status);
        return this.windows.length;
    }

    summarizeTaskWindows(windows, testType, metadata = {}) {
        return summarizeAudioTaskWindows(windows, testType, metadata);
    }

    async pause() {
        if (!this.started || this.paused) return false;
        this._flushPendingWindow();
        this.paused = true;
        await this.context?.suspend?.();
        this.status = 'paused';
        return true;
    }

    async resume() {
        if (!this.started || !this.paused) return false;
        await this.context?.resume?.();
        this.paused = false;
        this.status = 'running';
        return true;
    }

    _storeSummary(status = this.status) {
        const summary = summarizeAudioWindows(this.windows, {
            status,
            enabled: this.enabled,
            consentGranted: this._consentGranted(),
            permission: this.permission,
            sampleRate: this.sampleRate,
            windowDurationMs: this.windowSeconds * 1000,
            droppedWindowCount: this.droppedWindowCount
        });
        this.state.sessionData.audioSummary = summary;
        return summary;
    }

    async _teardownGraph() {
        if (this.processor) this.processor.onaudioprocess = null;
        if (this.processor?.port) this.processor.port.onmessage = null;
        for (const node of [this.source, this.processor, this.mute]) {
            try { node?.disconnect?.(); } catch (_) {}
        }
        for (const track of this.stream?.getTracks?.() || []) {
            try { track.stop(); } catch (_) {}
        }
        try {
            if (this.context && this.context.state !== 'closed') await this.context.close();
        } catch (_) {}
        this.stream = null;
        this.context = null;
        this.source = null;
        this.processor = null;
        this.mute = null;
        if (this.state?.runtime) this.state.runtime.audioStream = null;
    }

    async stop(reason = 'session_finish') {
        if (this.stopPromise) return this.stopPromise;
        this.stopRequested = true;
        this.stopPromise = (async () => {
            this.started = false;
            this._flushPendingWindow();
            this.pendingChunks = [];
            this.pendingSamples = 0;
            await this.analysisQueue;
            this._disableWorker();
            await this._teardownGraph();
            if (this.everStarted) this.status = 'completed';
            else if (this.status === 'requesting_permission') this.status = 'stopped';
            const summary = this._storeSummary(this.status);
            this.recordEvent('audio_module_stopped', {
                reason,
                windowCount: summary.windowCount,
                acceptedWindowCount: summary.acceptedWindowCount
            });
            return summary;
        })();
        return this.stopPromise;
    }

    dispose(reason = 'session_dispose') {
        return this.stop(reason);
    }
}
