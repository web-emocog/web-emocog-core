function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function isLoopback(hostname) {
    return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '[::1]'
        || hostname === '::1';
}

function normalizeAllowedOrigins(value) {
    const entries = Array.isArray(value)
        ? value
        : String(value || '').split(',');
    return new Set(entries.map((entry) => {
        try {
            return new URL(String(entry).trim()).origin;
        } catch (_) {
            return null;
        }
    }).filter(Boolean));
}

function parseCandidate(value, pageUrl) {
    if (!value || !String(value).trim()) return null;
    try {
        return new URL(String(value).trim(), pageUrl);
    } catch (_) {
        return null;
    }
}

export function isAllowedApiBase(candidate, options = {}) {
    if (!candidate) return false;
    const pageUrl = options.pageUrl instanceof URL
        ? options.pageUrl
        : new URL(options.pageUrl || globalThis.location?.href || 'http://localhost/');
    if (!['http:', 'https:'].includes(candidate.protocol)) return false;
    if (candidate.origin === pageUrl.origin) return true;
    if (
        isLoopback(pageUrl.hostname)
        && isLoopback(candidate.hostname)
        && candidate.protocol === pageUrl.protocol
    ) {
        return true;
    }
    if (candidate.protocol !== 'https:') return false;
    return normalizeAllowedOrigins(options.allowedOrigins).has(candidate.origin);
}

/**
 * Resolves the participant API without accepting arbitrary localStorage origins.
 * Cross-origin API deployment must be explicitly allowlisted by the page config.
 */
export function resolveParticipantApiBase(options = {}) {
    const runtime = options.runtime || globalThis;
    const pageUrl = options.pageUrl instanceof URL
        ? options.pageUrl
        : new URL(options.pageUrl || runtime.location?.href || 'http://localhost/');
    const defaultBase = trimTrailingSlash(new URL('/api', pageUrl.origin).href);
    const allowedOrigins = options.allowedOrigins
        ?? runtime.WECOG_API_ORIGINS
        ?? [];
    const candidates = [
        options.configuredBase,
        runtime.WECOG_API_BASE,
        runtime.PROTOCOL_RUN_API_BASE,
        runtime.API_BASE
    ];

    const allowLocalOverride = options.allowLocalOverride === true
        || runtime.WECOG_ALLOW_API_OVERRIDE === true
        || isLoopback(pageUrl.hostname);
    if (allowLocalOverride) {
        try {
            candidates.push(runtime.localStorage?.getItem('emocog_api_base'));
        } catch (_) {}
    }

    for (const value of candidates) {
        const candidate = parseCandidate(value, pageUrl);
        if (isAllowedApiBase(candidate, { pageUrl, allowedOrigins })) {
            return trimTrailingSlash(candidate.href);
        }
    }
    return defaultBase;
}

export const __test = {
    isLoopback,
    normalizeAllowedOrigins,
    parseCandidate
};
