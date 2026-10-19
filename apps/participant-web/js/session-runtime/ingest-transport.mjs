import { SESSION_CONTRACT_VERSION } from './contracts.mjs';
import { resolveParticipantApiBase } from './api-base.mjs';
import { fetchWithDeadline } from './http.mjs?v=20261019-5';

const DEFAULT_RETRIES = 4;
const DEFAULT_BACKOFF_MS = 1500;
const REQUEST_TIMEOUT_MS = 30000;
const retryCooldowns = new Map();

function cooldownKey(apiBase, payload) {
    return `wecog_ingest_retry:${apiBase}:${payload.ids.session}:${payload.ids.invitationCode || ''}`;
}

function readCooldown(key) {
    let cooldown = retryCooldowns.get(key);
    try { cooldown ||= JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) {}
    if (Number.isFinite(cooldown?.until) && cooldown.until > Date.now()) return cooldown;
    writeCooldown(key, null);
    return null;
}

function writeCooldown(key, cooldown) {
    if (cooldown) retryCooldowns.set(key, cooldown); else retryCooldowns.delete(key);
    try {
        if (cooldown) sessionStorage.setItem(key, JSON.stringify(cooldown));
        else sessionStorage.removeItem(key);
    } catch (_) {}
}

function getStaffToken() {
    try {
        return localStorage.getItem('emocog_api_token') || null;
    } catch (_) {
        return null;
    }
}

function ingestTokenStorageKey(sessionId, invitationCode) {
    return `wecog_ingest_token:${sessionId}:${invitationCode}`;
}

function readCachedIngestToken(sessionId, invitationCode) {
    try {
        return sessionStorage.getItem(ingestTokenStorageKey(sessionId, invitationCode));
    } catch (_) {
        return null;
    }
}

function cacheIngestToken(sessionId, invitationCode, token) {
    try {
        sessionStorage.setItem(ingestTokenStorageKey(sessionId, invitationCode), token);
    } catch (_) {}
}

export function clearParticipantIngestToken(sessionId, invitationCode) {
    try {
        sessionStorage.removeItem(ingestTokenStorageKey(sessionId, invitationCode));
    } catch (_) {}
}

async function fetchJsonWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
    return fetchWithDeadline(url, options, async response => {
        const body = await response.json().catch(() => null);
        return { response, body };
    }, timeoutMs);
}

function notify(callback, value) {
    try { callback?.(value)?.catch?.(() => {}); } catch (_) { /* Reporting must not change a durable acknowledgement. */ }
}

function parseRetryAfter(value, now = Date.now()) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(value);
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - now) : null;
}

async function issueParticipantIngestToken(apiBase, sessionId, invitationCode) {
    const { response, body } = await fetchJsonWithTimeout(
        `${apiBase}/invitations/by-code/${encodeURIComponent(invitationCode)}/ingest-token`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            credentials: 'omit',
            body: JSON.stringify({ session_id: sessionId })
        }
    );
    if (!response.ok || typeof body?.token !== 'string' || !body.token.trim()) {
        const error = new Error(body?.error || `Ingest token request failed: HTTP ${response.status}`);
        error.code = body?.code || 'admission_failed';
        error.httpStatus = response.ok ? 502 : response.status;
        error.retryAfterMs = parseRetryAfter(response.headers?.get?.('Retry-After'));
        throw error;
    }
    cacheIngestToken(sessionId, invitationCode, body.token);
    return body.token;
}

/** Reserve a participant run before the long experiment starts. */
export async function primeParticipantSession(options = {}) {
    const sessionId = options.sessionId;
    const invitationCode = options.invitationCode;
    if (!invitationCode) return { ok: true, skipped: true };
    if (!sessionId) throw new Error('sessionId is required for participant admission');
    const cached = readCachedIngestToken(sessionId, invitationCode);
    if (cached) return { ok: true, cached: true };
    const apiBase = options.apiBase || resolveParticipantApiBase();
    try {
        await issueParticipantIngestToken(apiBase, sessionId, invitationCode);
    } catch (error) {
        if (!isRetryable(error) || error.retryAfterMs > 1500) throw error;
        await wait(error.retryAfterMs ?? 500);
        await issueParticipantIngestToken(apiBase, sessionId, invitationCode);
    }
    return { ok: true, admitted: true };
}

async function resolveAuthorization(apiBase, payload, forceRefresh = false) {
    const sessionId = payload?.ids?.session;
    const invitationCode = payload?.ids?.invitationCode;
    if (invitationCode) {
        if (!sessionId) throw new Error('ids.session is required before participant ingest');
        if (!forceRefresh) {
            const cached = readCachedIngestToken(sessionId, invitationCode);
            if (cached) return `Bearer ${cached}`;
        }
        const token = await issueParticipantIngestToken(apiBase, sessionId, invitationCode);
        return `Bearer ${token}`;
    }

    const token = getStaffToken();
    if (!token) throw new Error('Authorization token is required for ingest without invitation');
    return `Bearer ${token}`;
}

function isRetryable(error) {
    const status = error?.httpStatus;
    if (!Number.isFinite(status)) return true;
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function assertSessionFeature(payload) {
    if (!payload || payload.schemaVersion !== SESSION_CONTRACT_VERSION) {
        throw new TypeError(`Expected ${SESSION_CONTRACT_VERSION} payload`);
    }
    if (!payload.ids?.session || !payload.lifecycle || !Array.isArray(payload.events)) {
        throw new TypeError('SessionFeature requires ids.session, lifecycle and events');
    }
}

export function validIngestAcknowledgement(body, payload, idempotencyKey) {
    const completed = payload.lifecycle?.status === 'completed';
    return !!body && body.ingested === true && body.session_id === payload.ids.session
        && typeof body.idempotent === 'boolean' && typeof body.proxy_ready === 'boolean'
        && (body.qc_validity === null || typeof body.qc_validity === 'string')
        && (body.idempotency_key === null || typeof body.idempotency_key === 'string')
        && (!idempotencyKey || body.idempotency_key === idempotencyKey)
        && body.lifecycle_status === (completed ? 'completed' : 'in_progress')
        && (completed ? typeof body.completed_at === 'string' && Number.isFinite(Date.parse(body.completed_at)) : body.completed_at === null);
}

/**
 * The only browser transport for participant/session aggregate ingestion.
 */
export async function sendSessionFeature(payload, options = {}) {
    assertSessionFeature(payload);
    const apiBase = options.apiBase || resolveParticipantApiBase();
    const retryKey = cooldownKey(apiBase, payload);
    const cooldown = readCooldown(retryKey);
    if (cooldown) return { ok: false, attempt: 0, status: cooldown.status, code: 'retry_after',
        error: 'The server asked to retry later', retryAfterMs: cooldown.until - Date.now() };
    const retries = Number.isFinite(options.retries)
        ? Math.min(10, Math.max(1, Math.floor(options.retries)))
        : DEFAULT_RETRIES;
    const backoffMs = Number.isFinite(options.backoffMs)
        ? Math.max(0, options.backoffMs)
        : DEFAULT_BACKOFF_MS;
    const maxRetryDelayMs = Number.isFinite(options.maxRetryDelayMs)
        ? Math.max(0, options.maxRetryDelayMs)
        : 60_000;
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const sleep = typeof options.sleep === 'function' ? options.sleep : wait;
    const body = JSON.stringify(payload);
    const timeoutMs = Number.isFinite(options.requestTimeoutMs)
        ? Math.max(50, Math.min(REQUEST_TIMEOUT_MS, options.requestTimeoutMs)) : REQUEST_TIMEOUT_MS;
    let lastError = null;
    let forceTokenRefresh = false;
    let lastAttempt = 0;

    for (let attempt = 1; attempt <= retries; attempt++) {
        lastAttempt = attempt;
        notify(options.onAttempt, { attempt, retries, endpoint: '/ingest' });
        try {
            const refreshedThisAttempt = forceTokenRefresh;
            const authorization = await resolveAuthorization(apiBase, payload, refreshedThisAttempt);
            forceTokenRefresh = false;
            const { response, body: responseBody } = await fetchJsonWithTimeout(`${apiBase}/ingest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: authorization,
                    ...(options.idempotencyKey
                        ? { 'Idempotency-Key': options.idempotencyKey }
                        : {})
                },
                credentials: 'omit',
                body
            }, timeoutMs);
            if (response.ok) {
                if (![200, 201].includes(response.status) || !validIngestAcknowledgement(responseBody, payload, options.idempotencyKey)) {
                    const error = new Error('The server did not confirm saving this session');
                    error.code = 'ingest_ack_invalid';
                    error.httpStatus = 502;
                    throw error;
                }
                if (
                    payload.lifecycle?.status === 'completed'
                    && payload.ids?.invitationCode
                ) {
                    clearParticipantIngestToken(
                        payload.ids.session,
                        payload.ids.invitationCode
                    );
                }
                notify(options.onSuccess, { attempt, status: response.status, body: responseBody });
                writeCooldown(retryKey, null);
                return {
                    ok: true,
                    attempt,
                    status: response.status,
                    result: responseBody
                };
            }

            const error = new Error(responseBody?.error || `HTTP ${response.status}`);
            error.httpStatus = response.status;
            error.payload = responseBody;
            error.retryAfterMs = parseRetryAfter(response.headers?.get?.('Retry-After'));
            if (response.status === 401 && payload.ids?.invitationCode && !refreshedThisAttempt) {
                clearParticipantIngestToken(payload.ids.session, payload.ids.invitationCode);
                forceTokenRefresh = true;
            } else {
                throw error;
            }
            lastError = error;
        } catch (error) {
            lastError = error;
            if (attempt >= retries || !isRetryable(error)) break;
        }

        if (attempt >= retries) break;
        // Do not replay early when the server asks for a longer cooldown than
        // this foreground retry cycle can reasonably wait.
        if (lastError?.retryAfterMs > maxRetryDelayMs) break;
        const exponentialMs = backoffMs * (2 ** (attempt - 1));
        const randomValue = Math.min(1, Math.max(0, Number(random()) || 0));
        const jitteredMs = exponentialMs * (0.5 + randomValue);
        const delayMs = Math.min(
            maxRetryDelayMs,
            Math.max(jitteredMs, lastError?.retryAfterMs || 0)
        );
        notify(options.onRetry, { attempt, retries, delayMs, error: lastError });
        await sleep(delayMs);
    }

    if (lastError?.retryAfterMs > 0) writeCooldown(retryKey, {
        until: Date.now() + lastError.retryAfterMs, status: lastError.httpStatus || 429
    });
    notify(options.onFailure, lastError);
    return {
        ok: false,
        attempt: lastAttempt,
        status: lastError?.httpStatus || null,
        code: lastError?.payload?.code || lastError?.code || null,
        error: lastError?.message || 'Upload failed',
        retryAfterMs: lastError?.retryAfterMs || null
    };
}

export const __test = {
    assertSessionFeature,
    ingestTokenStorageKey,
    isRetryable,
    parseRetryAfter
};
