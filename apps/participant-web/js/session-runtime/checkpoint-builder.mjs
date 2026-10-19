import { createCheckpointRequest, isCheckpointRequest, isCheckpointResponse } from './checkpoint-messages.mjs?v=20261019-5';

const KEYS = ['ids', 'user', 'tech', 'consent', 'precheck', 'qcSummary', 'attentionMetrics', 'blinkSummary', 'perclosSummary',
    'bodyPoseSummary', 'audioSummary', 'multimodalSummary', 'multimodalHeatmap', 'emotionSummary', 'emotionAccumulator',
    'bpmSummary', 'bpmRuns', 'respirationRuns', 'rppgSession', 'experimentMeta', 'cognitiveResults', 'gazeValidation',
    'bpm', 'bpmData', 'rppg', 'rppgSummary', 'rppg_summary', 'bpm_summary', 'respirationSummary', 'respiration_summary', 'continuousSignalState',
    'heatmapState', 'heatmaps', 'emotion_summary', 'emotionEvents', 'eyeTracking', 'eyeSignals', 'emotionSamples', 'bodyPoseSamples', 'events', 'lifecycle', 'startTime', 'testHub', 'gazeTests'];

export class CheckpointBuilder {
    async build(sessionData, metrics = null) {
        const source = Object.fromEntries(KEYS.filter(key => sessionData[key] !== undefined).map(key => [key, sessionData[key]]));
        source.user = { interfaceLanguage: sessionData.user?.interfaceLanguage || null };
        source.checkpointViewport = { width: globalThis.innerWidth || 1920, height: globalThis.innerHeight || 1080 };
        if (metrics) source.qcSummary = metrics;
        if (typeof Worker === 'function') {
            try {
                const request = createCheckpointRequest(source);
                if (!isCheckpointRequest(request)) throw new Error('checkpoint_worker_invalid_request');
                const packet = await new Promise((resolve, reject) => {
                    this.worker = new Worker(new URL('./aggregate-worker.mjs?v=20261019-5', import.meta.url), { type: 'module' });
                    const timer = setTimeout(() => reject(new Error('checkpoint_worker_timeout')), 10000);
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
                return packet;
            } catch (_) { this.stop(); }
        }
        // Unsupported workers must not run full gaze/alignment calculations
        // on the active RT thread or fabricate empty-signal measurements.
        const { buildAggregatesPayload } = await import('../unified-aggregates-new.js?v=20261019-5');
        const packet = buildAggregatesPayload({ ...source, eyeTracking: [], eyeSignals: [], emotionSamples: [], bodyPoseSamples: [] }, { forIngest: true });
        delete packet.gaze_analytics;
        delete packet.rt_alignment;
        packet.experimentMeta = { ...packet.experimentMeta, backupScope: 'light_summary_without_signal_series' };
        return packet;
    }
    stop() {
        this.worker?.terminate(); this.worker = null;
        const cancel = this.cancel; this.cancel = null; cancel?.();
    }
}
