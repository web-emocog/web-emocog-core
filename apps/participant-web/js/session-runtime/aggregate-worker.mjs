import { buildAggregatesPayload } from '../unified-aggregates-new.js?v=20261019-4';
import { buildCheckpointHeatmaps } from './gaze-history.mjs?v=20261019-4';
import { buildAttentionMetrics } from '../gaze-tracker/attention-metrics.js?v=20261019-4';
self.onmessage = event => {
    try {
        const source = event.data;
        source.heatmaps = buildCheckpointHeatmaps(source, { gridWidth: 32, gridHeight: 18,
            screenWidth: source.checkpointViewport.width, screenHeight: source.checkpointViewport.height,
            validationRmsPx: source.gazeValidation?.metrics?.accuracyPx ?? null });
        source.attentionMetrics = buildAttentionMetrics(source);
        source.blinkSummary = source.attentionMetrics?.global?.blinkDynamics || source.blinkSummary;
        source.perclosSummary = source.attentionMetrics?.global?.perclos || source.perclosSummary;
        self.postMessage({ packet: buildAggregatesPayload(source, { forIngest: true }) });
    } catch (_) { self.postMessage({ error: 'checkpoint_prepare_failed' }); }
};
