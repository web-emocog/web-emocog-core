const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonce = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

export function createCheckpointRequest(source) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return { schemaVersion: 'checkpoint_request.v1',
        requestId: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), source };
}

export function isCheckpointRequest(value) {
    if (!record(value) || value.schemaVersion !== 'checkpoint_request.v1' || !nonce(value.requestId)
        || Object.keys(value).some(key => !['schemaVersion', 'requestId', 'source'].includes(key))) return false;
    return isCheckpointSource(value.source);
}

export function isCheckpointSource(source) {
    if (!record(source) || !record(source.ids) || typeof source.ids.session !== 'string'
        || !source.ids.session.length || source.ids.session.length > 256 || !record(source.checkpointViewport)) return false;
    return ['width', 'height'].every(key => Number.isFinite(source.checkpointViewport[key])
        && source.checkpointViewport[key] > 0 && source.checkpointViewport[key] <= 32768);
}

export function isLegacyCheckpointRequest(value) {
    return isCheckpointSource(value) && !['schemaVersion', 'requestId', 'source'].some(key => Object.hasOwn(value, key));
}

export function isCheckpointResponse(value, request) {
    if (!record(value) || value.schemaVersion !== 'checkpoint_response.v1' || value.requestId !== request.requestId
        || !nonce(value.requestId)
        || Object.keys(value).some(key => !['schemaVersion', 'requestId', 'packet', 'error'].includes(key))) return false;
    if (Object.hasOwn(value, 'error')) return value.error === 'checkpoint_prepare_failed' && !Object.hasOwn(value, 'packet');
    const packet = value.packet;
    return record(packet) && packet.schemaVersion === 'session_feature.v1' && record(packet.ids)
        && ['session', 'participant', 'invitationCode'].every(key => request.source.ids[key] === undefined
            || packet.ids[key] === request.source.ids[key]);
}
