/**
 * Compatibility facade. Transport logic lives only in ingest-transport.mjs.
 */
import { buildAggregatesPayload } from '../unified-aggregates-new.js?v=20260919-1';
import { sendSessionFeature } from '../session-runtime/ingest-transport.mjs?v=20260807-1';

export async function sendSessionData(sessionData, options = {}) {
    const payload = sessionData?.schemaVersion === 'session_feature.v1'
        ? sessionData
        : buildAggregatesPayload(sessionData, { forIngest: true });
    const result = await sendSessionFeature(payload, options);
    return {
        success: result.ok,
        status: result.status,
        body: result.result || null,
        attempts: result.attempt || 0,
        error: result.error || null
    };
}

export function downloadSessionDataFallback(sessionData) {
    const json = JSON.stringify(sessionData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wecog_session_${sessionData?.ids?.session || 'unknown'}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

export async function handleSendWithFallback(sessionData, callbacks = {}) {
    callbacks.onSending?.();
    const result = await sendSessionData(sessionData, callbacks);
    if (result.success) {
        callbacks.onSuccess?.(result);
        return { sent: true, downloaded: false, attempts: result.attempts };
    }
    callbacks.onFallback?.(result);
    return { sent: false, downloaded: false, attempts: result.attempts };
}
