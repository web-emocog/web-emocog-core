import { buildAggregatesPayload } from '../unified-aggregates-new.js?v=20261019-5';
import { buildCheckpointHeatmaps } from './gaze-history.mjs?v=20261019-5';
import { buildAttentionMetrics } from '../gaze-tracker/attention-metrics.js?v=20261019-5';
import { isCheckpointRequest, isLegacyCheckpointRequest } from './checkpoint-messages.mjs?v=20261019-5';

// This module must never install a window-level message handler.
if (typeof DedicatedWorkerGlobalScope !== 'undefined' && self instanceof DedicatedWorkerGlobalScope) {
    self.onmessage = event => {
        // Dedicated-worker messages use an empty origin; a nonempty one must be local.
        if (event.isTrusted !== true || (event.origin !== '' && event.origin !== self.location.origin)) return;
        const request = isCheckpointRequest(event.data) ? event.data
            : isLegacyCheckpointRequest(event.data) ? { source: event.data, requestId: null } : null;
        if (!request) return;
        const { source, requestId } = request;
        const reply = { schemaVersion: 'checkpoint_response.v1', requestId };
        try {
            source.heatmaps = buildCheckpointHeatmaps(source, { gridWidth: 32, gridHeight: 18,
                screenWidth: source.checkpointViewport.width, screenHeight: source.checkpointViewport.height,
                validationRmsPx: source.gazeValidation?.metrics?.accuracyPx ?? null });
            source.attentionMetrics = buildAttentionMetrics(source);
            source.blinkSummary = source.attentionMetrics?.global?.blinkDynamics || source.blinkSummary;
            source.perclosSummary = source.attentionMetrics?.global?.perclos || source.perclosSummary;
            self.postMessage({ ...reply, packet: buildAggregatesPayload(source, { forIngest: true }) });
        } catch (_) { self.postMessage({ ...reply, error: 'checkpoint_prepare_failed' }); }
    };
}
