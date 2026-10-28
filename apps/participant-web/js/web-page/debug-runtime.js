/**
 * Temporary participant-web debug runtime (diagnostics only).
 * Enable only in an explicitly debug-enabled build:
 * window.WECOG_ALLOW_DEBUG = true + localStorage wecog_debug=1 or ?debug=1
 * Does not change algorithms, payloads, or server behavior.
 */
(function initWecogDebugRuntime(global) {
    'use strict';

    global.WECOG_DEBUG?.dispose?.();
    let disposed = false;

    const RING_MAX = 2000;
    const TIMELINE_MAX = 600;
    const PAGE_LOAD_MS = (typeof performance !== 'undefined' && performance.timeOrigin)
        ? performance.timeOrigin
        : Date.now();
    const SENSITIVE_KEYS = /^(landmarks|imageData|image|video|audio|canvas|srcObject|stream|pixels|frame|buffer|raw|rawData|rawMask|mask|waveform|signal|rawPath|samples|rppgSession|email|phone|phoneNumber|ip|ipAddress|userAgent|authorization|accessToken|refreshToken|ingestToken|cookie|invitationCode|code|password|currentPassword|newPassword|confirmPassword|token|secret|csrfToken|sessionId|participantId|participantAlias|alias|displayName|fullName|name|id|key|text|message|stack|answer|answers|response|responses|filename|fileName|className)$/i;
    const LANDMARK_KEYS = /landmark/i;
    const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~-]+/i;
    const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
        'AbortError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'NotSupportedError',
        'SecurityError', 'TimeoutError', 'NetworkError', 'QuotaExceededError', 'InvalidStateError', 'DataError']);

    function cleanText(value, limit = 240) {
        if (typeof value !== 'string') return '[Text omitted]';
        value = value.slice(0, 4096);
        if (EMAIL_VALUE.test(value) || BEARER_VALUE.test(value)
            || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)
            || /(?:\+?\d[\s().-]*){10,}/.test(value)) return '[Redacted]';
        return value.replace(/(?:https?:|file:|blob:|data:)[^\s<>"']*/gi, '[URL omitted]')
            .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s<>"']+/g, '[Path omitted]')
            .replace(/[?&](?:code|token|key|secret|password)=[^\s&]*/gi, '[Credential omitted]')
            .slice(0, limit);
    }

    function isEnabled() {
        if (disposed || global.WECOG_ALLOW_DEBUG !== true) return false;
        try {
            if (global.localStorage && global.localStorage.getItem('wecog_debug') === '1') return true;
        } catch (_) { /* ignore */ }
        try {
            const q = new URLSearchParams(global.location.search);
            if (q.get('debug') === '1') return true;
        } catch (_) { /* ignore */ }
        return false;
    }

    const buffer = [];
    let seq = 0;

    const timelines = {
        qc: [],
        gaze: [],
        bpm: [],
        overlay: [],
        keys: [],
        events: []
    };

    const gazeDiagnostics = {
        totalSamples: 0,
        onScreenFalseCount: 0,
        clippedCount: 0,
        offScreenCorrectedCount: 0,
        edgeClips: { left: 0, right: 0, top: 0, bottom: 0 },
        postCalibrationApplied: null,
        loocvPass: null,
        loocvRejectedReason: null,
        accuracyPx: null,
        validationRmsPx: null,
        affineStatus: null,
        biasCorrectionStatus: null,
        calibrationStatus: null
    };

    let eventLossCount = 0;
    let activeListenerCount = 0;
    let lastRuntimeSnapshot = null;

    function relMs() {
        return Math.round(Date.now() - PAGE_LOAD_MS);
    }

    function summarizeLandmarks(v) {
        return { count: Array.isArray(v) ? Object.getOwnPropertyDescriptor(v, 'length').value : null };
    }

    function sanitize(value, depth = 0, keyHint = null, budget = { nodes: 400, chars: 8000, seen: new WeakSet() }) {
        if (--budget.nodes < 0 || budget.chars <= 0) return '[Budget exceeded]';
        if (depth > 6) return '[MaxDepth]';
        if (value === null || value === undefined) return value;
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
            if (typeof value === 'number') return Number.isFinite(value) ? value : null;
            if (typeof value !== 'string') return value;
            const safe = cleanText(value, Math.min(240, budget.chars));
            budget.chars -= safe.length;
            return safe;
        }
        if (typeof value === 'function') return '[Function]';
        if (typeof value === 'bigint') return '[BigInt omitted]';

        try {
            if (value instanceof Error) {
                const descriptor = Object.getOwnPropertyDescriptor(value, 'name')
                    || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), 'name');
                const name = descriptor && 'value' in descriptor ? descriptor.value : 'Error';
                return { errorType: ERROR_NAMES.has(name) ? name : 'Error' };
            }

            if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return { bytes: value.byteLength };

            if (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) {
                return { type: 'HTMLVideoElement', videoWidth: value.videoWidth, videoHeight: value.videoHeight };
            }
            if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) {
                return { type: 'HTMLCanvasElement', width: value.width, height: value.height };
            }
            if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
                return { type: 'ImageData', width: value.width, height: value.height };
            }
            if (typeof MediaStream !== 'undefined' && value instanceof MediaStream) {
                return { type: 'MediaStream', trackCount: value.getTracks ? value.getTracks().length : null };
            }

            if (keyHint && LANDMARK_KEYS.test(keyHint)) {
                return summarizeLandmarks(value);
            }
            if (typeof value === 'object') {
                if (budget.seen.has(value)) return '[Circular]';
                budget.seen.add(value);
                try {
                    if (Array.isArray(value)) {
                        const items = [];
                        const max = Math.min(value.length, value.length > 50 ? 5 : 50);
                        for (let i = 0; i < max && budget.nodes > 0 && budget.chars > 0; i++) {
                            const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
                            items.push(descriptor && 'value' in descriptor
                                ? sanitize(descriptor.value, depth + 1, String(i), budget) : '[Accessor omitted]');
                        }
                        return value.length > 50 ? { length: value.length, preview: items } : items;
                    }
                    const out = {};
                    for (const k of Object.keys(value).slice(0, 80)) {
                        if (budget.nodes <= 0 || budget.chars <= 0) break;
                        const safeKey = cleanText(k, 80);
                        budget.chars -= safeKey.length;
                        const descriptor = Object.getOwnPropertyDescriptor(value, k);
                        let safe;
                        if (!descriptor || !('value' in descriptor)) safe = '[Accessor omitted]';
                        else if (SENSITIVE_KEYS.test(k.replace(/[^a-z0-9]/gi, ''))) safe = '[Omitted]';
                        else safe = sanitize(descriptor.value, depth + 1, k, budget);
                        Object.defineProperty(out, safeKey, { value: safe, enumerable: true, configurable: true });
                    }
                    return out;
                } catch (_) {
                    return '[Uninspectable]';
                } finally {
                    budget.seen.delete(value);
                }
            }

            return '[Unsupported]';
        } catch (_) {
            return '[Uninspectable]';
        }
    }

    function makeEntry(level, scope, event, data) {
        seq += 1;
        const entry = {
            seq,
            level,
            ts: new Date().toISOString(),
            relMs: relMs(),
            scope: cleanText(typeof scope === 'string' ? scope : 'app', 96),
            event: cleanText(typeof event === 'string' ? event : 'log', 96),
            data: data === undefined ? undefined : sanitize(data, 0, null)
        };
        buffer.push(entry);
        if (buffer.length > RING_MAX) buffer.shift();
        return entry;
    }

    function consoleOut(level, entry) {
        const tag = `[WECOG_DEBUG:${entry.scope}] ${entry.event}`;
        const method = level === 'mark' ? 'info' : level;
        try { console[method](tag, entry.data !== undefined ? copy(entry.data) : ''); }
        catch (_) { /* Optional console transport; the bounded diagnostic ring remains available. */ }
    }

    function log(scope, event, data) {
        if (!isEnabled()) return;
        const entry = makeEntry('log', scope, event, data);
        consoleOut('log', entry);
    }

    function warn(scope, event, data) {
        if (!isEnabled()) return;
        const entry = makeEntry('warn', scope, event, data);
        consoleOut('warn', entry);
    }

    function error(scope, event, data) {
        if (!isEnabled()) return;
        const entry = makeEntry('error', scope, event, data);
        consoleOut('error', entry);
    }

    function mark(scope, event, data) {
        if (!isEnabled()) return;
        const entry = makeEntry('mark', scope, event, data);
        consoleOut('mark', entry);
    }

    function dump(filter) {
        if (!isEnabled()) { clear(); return []; }
        const rows = filter
            ? buffer.filter((e) =>
                (e.scope && String(e.scope).includes(filter)) ||
                (e.event && String(e.event).includes(filter)))
            : buffer.slice();
        try { console.table(copy(rows)); }
        catch (_) { /* Optional DevTools presentation, not session persistence. */ }
        return copy(rows);
    }

    function find(needle) {
        if (!isEnabled()) { clear(); return []; }
        const n = String(needle || '').toLowerCase();
        return copy(buffer.filter((e) =>
            String(e.scope || '').toLowerCase().includes(n) ||
            String(e.event || '').toLowerCase().includes(n)));
    }

    function clear() {
        buffer.length = 0;
        Object.values(timelines).forEach(rows => { rows.length = 0; });
        lastRuntimeSnapshot = null;
        Object.keys(gazeDiagnostics).forEach(key => {
            if (key === 'edgeClips') gazeDiagnostics[key] = { left: 0, right: 0, top: 0, bottom: 0 };
            else gazeDiagnostics[key] = ['totalSamples', 'onScreenFalseCount', 'clippedCount',
                'offScreenCorrectedCount'].includes(key) ? 0 : null;
        });
        eventLossCount = 0;
    }

    function pushTimeline(name, data) {
        if (!isEnabled()) return;
        const key = typeof name === 'string' && Object.hasOwn(timelines, name) ? name : 'events';
        const safe = sanitize(data);
        const row = {
            ...(safe && typeof safe === 'object' && !Array.isArray(safe) ? safe : { value: safe }),
            ts: new Date().toISOString(),
            relMs: relMs()
        };
        const arr = timelines[key];
        arr.push(row);
        if (arr.length > TIMELINE_MAX) arr.shift();
    }

    function recordOverlayTransition(action, reason, extra) {
        if (!isEnabled()) return;
        const row = { ...sanitize(extra || {}), action: cleanText(action), reason: cleanText(reason || '') };
        pushTimeline('overlay', row);
        mark('qc', 'overlay:' + action, row);
    }

    function recordGazeSample(sample) {
        if (!isEnabled() || !sample) return;
        gazeDiagnostics.totalSamples += 1;
        const sw = sample.screenWidth || global.innerWidth || 1;
        const sh = sample.screenHeight || global.innerHeight || 1;
        if (sample.onScreen === false) gazeDiagnostics.onScreenFalseCount += 1;
        if (sample.clipped === true) gazeDiagnostics.clippedCount += 1;
        const cx = sample.correctedX;
        const cy = sample.correctedY;
        if (Number.isFinite(cx) && Number.isFinite(cy)) {
            if (cx < 0 || cx > sw || cy < 0 || cy > sh) {
                gazeDiagnostics.offScreenCorrectedCount += 1;
                if (cx < 0) gazeDiagnostics.edgeClips.left += 1;
                if (cx > sw) gazeDiagnostics.edgeClips.right += 1;
                if (cy < 0) gazeDiagnostics.edgeClips.top += 1;
                if (cy > sh) gazeDiagnostics.edgeClips.bottom += 1;
            }
        }
        if (gazeDiagnostics.totalSamples % 45 === 0) {
            pushTimeline('gaze', {
                onScreen: sample.onScreen,
                clipped: sample.clipped,
                correctedX: Number.isFinite(cx) ? Math.round(cx) : null,
                correctedY: Number.isFinite(cy) ? Math.round(cy) : null,
                offScreenPct: gazeDiagnostics.totalSamples
                    ? Math.round((gazeDiagnostics.offScreenCorrectedCount / gazeDiagnostics.totalSamples) * 1000) / 10
                    : null
            });
        }
    }

    function setGazeCalibrationDiagnostics(patch) {
        if (!isEnabled() || !patch || typeof patch !== 'object') return;
        const safe = sanitize(patch);
        if (!safe || typeof safe !== 'object' || Array.isArray(safe)) return;
        for (const key of ['postCalibrationApplied', 'loocvPass', 'loocvRejectedReason', 'accuracyPx',
            'validationRmsPx', 'affineStatus', 'biasCorrectionStatus', 'calibrationStatus']) {
            if (Object.hasOwn(safe, key)) gazeDiagnostics[key] = safe[key];
        }
    }

    function setRuntimeSnapshot(snapshot) {
        if (isEnabled()) lastRuntimeSnapshot = sanitize(snapshot);
    }

    function incrementEventLoss(n) {
        if (isEnabled()) eventLossCount += (Number.isFinite(n) && n >= 0 ? n : 1);
    }

    function setActiveListenerCount(n) {
        if (isEnabled() && Number.isFinite(n) && n >= 0) activeListenerCount = n;
    }

    function getGazeDiagnostics() {
        if (!isEnabled()) clear();
        const t = gazeDiagnostics.totalSamples || 1;
        return copy({
            ...gazeDiagnostics,
            onScreenFalsePct: Math.round((gazeDiagnostics.onScreenFalseCount / t) * 1000) / 10,
            clippedPct: Math.round((gazeDiagnostics.clippedCount / t) * 1000) / 10,
            offScreenCorrectedPct: Math.round((gazeDiagnostics.offScreenCorrectedCount / t) * 1000) / 10
        });
    }

    function exportJson() {
        if (!isEnabled()) clear();
        return {
            enabled: isEnabled(),
            privacyVersion: 'technical_only.v2',
            exportedAt: new Date().toISOString(),
            relMs: relMs(),
            page: 'participant-web',
            count: buffer.length,
            events: copy(buffer)
        };
    }

    function exportDebugBundle() {
        if (!isEnabled()) clear();
        const sessionEvents = (() => {
            try {
                if (!isEnabled()) return [];
                return (global.__WECOG_STATE__?.sessionData?.events || []).slice(-200).map(event => {
                    const out = {};
                    for (const key of ['type', 'schemaVersion', 'tRelMs', 'rtMs', 'valid', 'confidence']) {
                        const descriptor = event && Object.getOwnPropertyDescriptor(event, key);
                        if (descriptor && 'value' in descriptor) out[key] = sanitize(descriptor.value);
                    }
                    return out;
                });
            } catch (_) {
                return null;
            }
        })();
        return {
            schema: 'wecog-debug-bundle-v1',
            privacyVersion: 'technical_only.v2',
            exportedAt: new Date().toISOString(),
            relMs: relMs(),
            debug: exportJson(),
            timelines: {
                qc: copy(timelines.qc),
                gaze: copy(timelines.gaze),
                bpm: copy(timelines.bpm),
                overlay: copy(timelines.overlay),
                keys: copy(timelines.keys),
                events: copy(timelines.events)
            },
            gazeDiagnostics: getGazeDiagnostics(),
            bpmDiagnostics: optionalDiagnostics('__WECOG_BPM_DIAG__'),
            visuospatialDiagnostics: optionalDiagnostics('__WECOG_VIS_DIAG__'),
            runtime: sanitize(lastRuntimeSnapshot, 0, 'runtime'),
            sessionEvents,
            overlayTransitions: copy(timelines.overlay),
            calibrationMetrics: {
                gazeValidation: validationDiagnostics()
            },
            browser: {
                language: typeof navigator !== 'undefined' ? navigator.language : null,
                mobile: typeof navigator !== 'undefined'
                    ? /Android|iPhone|iPad|Mobile/i.test(String(navigator.userAgent || ''))
                    : null,
                viewport: {
                    width: global.innerWidth || null,
                    height: global.innerHeight || null,
                    pixelRatio: global.devicePixelRatio || null
                }
            },
            flags: {
                eventLossCount,
                activeListenerCount,
                entrypoint: 'mvp_with_precheck_1-updated.html'
            }
        };
    }

    function copy(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function validationDiagnostics() {
        if (!isEnabled()) return null;
        try {
            const value = global.__WECOG_STATE__?.sessionData?.gazeValidation;
            if (!value || typeof value !== 'object') return null;
            const selected = {};
            for (const key of ['passed', 'metrics', 'sampling', 'coverage', 'postCalibrationCorrection']) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (descriptor && 'value' in descriptor) selected[key] = descriptor.value;
            }
            return sanitize(selected);
        } catch (_) { return { unavailable: true }; }
    }

    function optionalDiagnostics(key) {
        if (!isEnabled()) return null;
        try { return sanitize(global[key] || null); }
        catch (_) { return { unavailable: true }; }
    }

    function downloadDebugBundle(filename) {
        const bundle = exportDebugBundle();
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || ('wecog-debug-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
        a.click();
        URL.revokeObjectURL(url);
        mark('debug', 'bundle:downloaded', { bytes: blob.size });
        return bundle;
    }

    const api = {
        isEnabled,
        log,
        warn,
        error,
        mark,
        dump,
        clear,
        exportJson,
        exportDebugBundle,
        downloadDebugBundle,
        pushTimeline,
        recordOverlayTransition,
        recordGazeSample,
        setGazeCalibrationDiagnostics,
        setRuntimeSnapshot,
        getGazeDiagnostics,
        incrementEventLoss,
        setActiveListenerCount,
        getEventLossCount: () => eventLossCount,
        getActiveListenerCount: () => activeListenerCount,
        find,
        dispose
    };

    Object.defineProperty(api, 'enabled', {
        enumerable: true,
        configurable: true,
        get: isEnabled
    });

    global.WECOG_DEBUG = api;

    if (isEnabled()) {
        log('debug', 'runtime:enabled', {
            source: (function detectSource() {
                try {
                    if (global.localStorage && global.localStorage.getItem('wecog_debug') === '1') return 'localStorage';
                } catch (_) { /* ignore */ }
                try {
                    if (new URLSearchParams(global.location.search).get('debug') === '1') return 'query';
                } catch (_) { /* ignore */ }
                return 'unknown';
            })(),
            ringMax: RING_MAX
        });
    }

    function onWindowError(ev) {
        if (!isEnabled()) return;
        error('global', 'error', {
            error: ev.error instanceof Error ? ev.error : new Error(),
            lineno: ev.lineno,
            colno: ev.colno
        });
    }

    function onUnhandledRejection(ev) {
        if (!isEnabled()) return;
        const reason = ev.reason;
        error('global', 'unhandledrejection', {
            error: reason instanceof Error ? reason : new Error()
        });
    }

    function dispose() {
        disposed = true;
        clear();
        global.removeEventListener('error', onWindowError);
        global.removeEventListener('unhandledrejection', onUnhandledRejection);
    }
    global.addEventListener('error', onWindowError);
    global.addEventListener('unhandledrejection', onUnhandledRejection);
})(typeof window !== 'undefined' ? window : globalThis);
