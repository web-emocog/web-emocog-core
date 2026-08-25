export const SESSION_CONTRACT_VERSION = 'session_feature.v1';
export const SESSION_EVENT_VERSION = 'session_event.v1';
export const SESSION_LIFECYCLE_VERSION = 'session_lifecycle.v1';

export const SESSION_STATES = Object.freeze({
    IDLE: 'idle',
    STARTING: 'starting',
    INSTRUCTION: 'instruction',
    RUNNING: 'running',
    PAUSED: 'paused',
    QUALITY_ERROR: 'quality_error',
    TECHNICAL_ERROR: 'technical_error',
    FINISHING: 'finishing',
    COMPLETED: 'completed',
    FAILED: 'failed'
});

export const ERROR_KINDS = Object.freeze({
    QUALITY: 'quality',
    TECHNICAL: 'technical'
});

export const EVENT_CATEGORIES = Object.freeze({
    LIFECYCLE: 'lifecycle',
    QUALITY: 'quality',
    TECHNICAL: 'technical',
    BLOCK: 'block',
    INPUT: 'input',
    UPLOAD: 'upload',
    MODULE: 'module'
});

let fallbackEventSequence = 0;

function createEventId(timestamp) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    fallbackEventSequence += 1;
    return `evt-${timestamp}-${fallbackEventSequence}`;
}

function inferEventCategory(type) {
    if (/quality|illumination|light|pose|face|occlusion/i.test(type)) return EVENT_CATEGORIES.QUALITY;
    if (/error|offline|online|camera|module/i.test(type)) return EVENT_CATEGORIES.TECHNICAL;
    if (/block|trial|stimulus|test_hub/i.test(type)) return EVENT_CATEGORIES.BLOCK;
    if (/upload|ingest/i.test(type)) return EVENT_CATEGORIES.UPLOAD;
    if (/input|response|click|key/i.test(type)) return EVENT_CATEGORIES.INPUT;
    return EVENT_CATEGORIES.LIFECYCLE;
}

/**
 * Creates the canonical event stored in SessionFeature.events.
 * Existing payload fields remain top-level for backward compatibility.
 */
export function createSessionEvent(input) {
    const timestamp = Number.isFinite(input?.timestamp) ? input.timestamp : Date.now();
    const type = String(input?.type || 'unknown');
    return {
        ...input,
        schemaVersion: SESSION_EVENT_VERSION,
        eventId: input?.eventId || createEventId(timestamp),
        sessionId: input?.sessionId || null,
        type,
        category: input?.category || inferEventCategory(type),
        severity: input?.severity || 'info',
        phase: input?.phase || null,
        timestamp,
        tRelMs: Number.isFinite(input?.tRelMs) ? input.tRelMs : null,
        blockId: input?.blockId ?? null,
        trialId: input?.trialId ?? null
    };
}

export function createSessionIssue(input) {
    const kind = input?.kind === ERROR_KINDS.TECHNICAL
        ? ERROR_KINDS.TECHNICAL
        : ERROR_KINDS.QUALITY;
    const timestamp = Number.isFinite(input?.timestamp) ? input.timestamp : Date.now();
    return {
        issueId: input?.issueId || createEventId(timestamp),
        kind,
        code: String(input?.code || 'unknown'),
        message: String(input?.message || ''),
        severity: input?.severity || (kind === ERROR_KINDS.TECHNICAL ? 'error' : 'warning'),
        recoverable: input?.recoverable !== false,
        invalidatesBlock: input?.invalidatesBlock !== false,
        timestamp,
        details: input?.details && typeof input.details === 'object' ? { ...input.details } : {}
    };
}

export function buildLifecycleContract(snapshot, patch = {}) {
    const state = snapshot?.state || SESSION_STATES.IDLE;
    const status = state === SESSION_STATES.COMPLETED
        ? 'completed'
        : (state === SESSION_STATES.FAILED ? 'failed' : 'in_progress');
    return {
        startedAt: snapshot?.startedAt || null,
        lastTransitionAt: snapshot?.lastTransitionAt || null,
        completedAt: snapshot?.completedAt || null,
        currentBlock: snapshot?.currentBlock ? { ...snapshot.currentBlock } : null,
        repeatQueue: Array.isArray(snapshot?.repeatQueue)
            ? snapshot.repeatQueue.map(item => ({ ...item }))
            : [],
        activeIssues: Array.isArray(snapshot?.activeIssues)
            ? snapshot.activeIssues.map(item => ({ ...item }))
            : [],
        ...patch,
        schemaVersion: SESSION_LIFECYCLE_VERSION,
        state,
        status
    };
}

export function buildSessionFeatureEnvelope(sessionData, features) {
    return {
        schemaVersion: SESSION_CONTRACT_VERSION,
        ids: { ...(sessionData?.ids || {}) },
        lifecycle: sessionData?.lifecycle ? { ...sessionData.lifecycle } : null,
        events: Array.isArray(sessionData?.events) ? [...sessionData.events] : [],
        features: features && typeof features === 'object' ? { ...features } : {}
    };
}
