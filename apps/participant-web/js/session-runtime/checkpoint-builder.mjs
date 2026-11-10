import { createCheckpointRequest, isCheckpointRequest, isCheckpointResponse } from './checkpoint-messages.mjs?v=20261025-1';
import { CHECKPOINT_SERIES, describeSeries } from './long-session-retention.mjs';
import { assertSessionSourceLimits, assertFinalPayloadLimits, SessionBuildLimitError } from './long-session-build-limits.mjs';

const KEYS = ['ids', 'user', 'tech', 'consent', 'precheck', 'qcSummary', 'attentionMetrics', 'blinkSummary', 'perclosSummary',
    'bodyPoseSummary', 'bodyPoseAccumulator', 'audioSummary', 'multimodalSummary', 'multimodalHeatmap', 'emotionSummary', 'emotionAccumulator',
    'bpmSummary', 'bpmRuns', 'respirationRuns', 'physiologyIntervals', 'rppgSession', 'experimentMeta', 'cognitiveResults', 'gazeValidation',
    'bpm', 'bpmData', 'rppg', 'rppgSummary', 'rppg_summary', 'bpm_summary', 'respirationSummary', 'respiration_summary', 'continuousSignalState',
    'heatmapState', 'heatmaps', 'emotion_summary', 'emotionEvents', 'eyeTracking', 'eyeSignals', 'emotionSamples', 'bodyPoseSamples', 'events', 'lifecycle', 'startTime', 'testHub', 'gazeTests'];

export class CheckpointBuilder {
    constructor({ maxSourceSamples = 1000000, timeoutMs = 10000, maxPayloadBytes = 2 * 1024 * 1024 } = {}) {
        this.maxSourceSamples = maxSourceSamples;
        this.timeoutMs = timeoutMs;
        this.maxPayloadBytes = maxPayloadBytes;
        this.pending = null;
    }
    build(sessionData, metrics = null) {
        if (this.pending) {
            if (this.sessionId !== sessionData.ids?.session) return Promise.reject(new Error('checkpoint_builder_session_changed'));
            return this.pending;
        }
        this.sessionId = sessionData.ids?.session;
        this.pending = this._build(sessionData, metrics).finally(() => { this.pending = null; });
        return this.pending;
    }
    async _build(sessionData, metrics) {
        const source = Object.fromEntries(KEYS.filter(key => sessionData[key] !== undefined).map(key => [key, sessionData[key]]));
        const series = Object.fromEntries(CHECKPOINT_SERIES.filter(key => Array.isArray(source[key]))
            .map(key => [key, describeSeries(source[key])]));
        // Refuse an unsafe clone explicitly. Do not turn a resource limit into a valid empty-signal backup.
        assertSessionSourceLimits(source, this.maxSourceSamples);
        source.user = { interfaceLanguage: sessionData.user?.interfaceLanguage || null };
        source.checkpointViewport = { width: globalThis.innerWidth || 1920, height: globalThis.innerHeight || 1080 };
        if (metrics) source.qcSummary = metrics;
        let failureReason = 'worker_unavailable';
        if (typeof Worker === 'function') {
            try {
                const request = createCheckpointRequest(source);
                if (!isCheckpointRequest(request)) throw new Error('checkpoint_worker_invalid_request');
                const packet = await new Promise((resolve, reject) => {
                    this.worker = new Worker(new URL('./aggregate-worker.mjs?v=20261109-issues2', import.meta.url), { type: 'module' });
                    const timer = setTimeout(() => reject(new Error('checkpoint_worker_timeout')), this.timeoutMs);
                    this.cancel = () => { clearTimeout(timer); reject(new Error('checkpoint_worker_cancelled')); };
                    this.worker.onmessage = event => {
                        if (event.isTrusted !== true || (event.origin !== '' && event.origin !== globalThis.location.origin)
                            || !isCheckpointResponse(event.data, request)) return;
                        clearTimeout(timer);
                        event.data.error ? reject(new Error('checkpoint_worker_failed')) : resolve(event.data.packet);
                    };
                    this.worker.onerror = () => { clearTimeout(timer); reject(new Error('checkpoint_worker_failed')); };
                    this.worker.onmessageerror = () => { clearTimeout(timer); reject(new Error('checkpoint_worker_failed')); };
                    this.worker.postMessage(request);
                });
                this.stop();
                return assertFinalPayloadLimits(packet, this.maxPayloadBytes);
            } catch (error) {
                this.stop();
                if (error instanceof SessionBuildLimitError) throw error;
                failureReason = error.message;
            }
        }
        // Unsupported workers must not run full gaze/alignment calculations
        // on the active RT thread or fabricate empty-signal measurements.
        const { buildAggregatesPayload } = await import('../unified-aggregates-new.js?v=20261109-issues2');
        if (source.heatmapState) {
            const { buildCheckpointHeatmaps } = await import('./gaze-history.mjs?v=20261102-1');
            source.heatmaps = buildCheckpointHeatmaps(source);
        }
        const packet = buildAggregatesPayload({ ...source, eyeTracking: [], eyeSignals: [], emotionSamples: [], bodyPoseSamples: [] }, { forIngest: true });
        if (!source.heatmapState && !source.heatmaps) delete packet.gaze_analytics;
        delete packet.rt_alignment;
        packet.experimentMeta = { ...packet.experimentMeta, backupScope: 'light_summary_without_signal_series',
            checkpointBuild: { schemaVersion: 'checkpoint_build.v1', signalSeriesIncomplete: true,
                reason: failureReason, omittedSeries: series, aggregatePolicy: 'preserved_without_recomputation' } };
        return assertFinalPayloadLimits(packet, this.maxPayloadBytes);
    }
    stop() {
        this.worker?.terminate(); this.worker = null;
        const cancel = this.cancel; this.cancel = null; cancel?.();
    }
}
