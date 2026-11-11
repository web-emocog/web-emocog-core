// Transport/schema limits only, never scientific/QC thresholds. Never truncate accepted trials.
export class SessionBuildLimitError extends Error {
    constructor(code, details) { super(code); this.name = 'SessionBuildLimitError'; this.details = details; }
}

export function assertSessionSourceLimits(source, maxSamples = 1000000) {
    const samples = ['eyeTracking', 'eyeSignals', 'emotionSamples', 'bodyPoseSamples', 'emotionEvents', 'events']
        .reduce((sum, key) => sum + (Array.isArray(source[key]) ? source[key].length : 0), 0);
    if (samples > maxSamples) throw new SessionBuildLimitError('checkpoint_source_resource_limit', { samples, maxSamples });
    if (source.cognitiveResults?.length > 5000) throw new SessionBuildLimitError('session_cognitive_result_limit',
        { count: source.cognitiveResults.length, max: 5000 });
}

export function assertFinalPayloadLimits(packet, maxBytes = 2 * 1024 * 1024) {
    for (const [key, max] of [['cognitiveResults', 5000], ['blocks', 200], ['events', 250]]) {
        if (packet[key]?.length > max) throw new SessionBuildLimitError('session_payload_item_limit', { key, count: packet[key].length, max });
    }
    const bytes = new TextEncoder().encode(JSON.stringify(packet)).byteLength;
    if (bytes > maxBytes) throw new SessionBuildLimitError('session_payload_byte_limit', { bytes, maxBytes });
    return packet;
}
