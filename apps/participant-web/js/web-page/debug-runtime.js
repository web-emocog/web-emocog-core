/**
 * Temporary participant-web debug runtime (diagnostics only).
 * Enable: localStorage.setItem('wecog_debug', '1') or ?debug=1
 * Does not change algorithms, payloads, or server behavior.
 */
(function initWecogDebugRuntime(global) {
    'use strict';

    const RING_MAX = 2000;
    const TIMELINE_MAX = 600;
    const PAGE_LOAD_MS = (typeof performance !== 'undefined' && performance.timeOrigin)
        ? performance.timeOrigin
        : Date.now();
    const SENSITIVE_KEYS = /^(landmarks|imageData|video|canvas|srcObject|stream|pixels|frame|buffer|rawPath|samples|rppgSession)$/i;
    const LANDMARK_KEYS = /landmark/i;

    function isEnabled() {
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
    const seen = new WeakSet();

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
        calibrationStatus: null
    };

    let eventLossCount = 0;
    let activeListenerCount = 0;
    let lastRuntimeSnapshot = null;

    function relMs() {
        return Math.round(Date.now() - PAGE_LOAD_MS);
    }

    function summarizeLandmarks(v) {
        if (!v) return { count: 0, finiteCount: 0 };
        if (Array.isArray(v)) {
            let finiteCount = 0;
            let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
            for (let i = 0; i < v.length; i++) {
                const p = v[i];
                if (!p) continue;
                const x = p.x; const y = p.y;
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    finiteCount++;
                    minX = Math.min(minX, x); minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                }
            }
            const bounds = finiteCount > 0
                ? { minX, minY, maxX, maxY }
                : null;
            return { count: v.length, finiteCount, bounds };
        }
        if (typeof v === 'object' && typeof v.length === 'number') {
            return { count: v.length, finiteCount: null, note: 'array-like' };
        }
        return { count: 0, finiteCount: 0 };
    }

    function sanitize(value, depth, keyHint) {
        if (depth > 8) return '[MaxDepth]';
        if (value === null || value === undefined) return value;
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
            if (typeof value === 'string' && value.length > 500) {
                return value.slice(0, 500) + '…[truncated]';
            }
            return value;
        }
        if (typeof value === 'function') return '[Function]';
        if (typeof value === 'bigint') return String(value);

        if (value instanceof Error) {
            return {
                name: value.name,
                message: value.message,
                stack: typeof value.stack === 'string' ? value.stack.slice(0, 2000) : undefined
            };
        }

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
        if (Array.isArray(value) && keyHint && LANDMARK_KEYS.test(keyHint)) {
            return summarizeLandmarks(value);
        }

        if (Array.isArray(value)) {
            if (value.length > 50) {
                return {
                    length: value.length,
                    preview: value.slice(0, 5).map((item, i) => sanitize(item, depth + 1, String(i)))
                };
            }
            return value.map((item, i) => sanitize(item, depth + 1, String(i)));
        }

        if (typeof value === 'object') {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
            const out = {};
            const keys = Object.keys(value).slice(0, 80);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (SENSITIVE_KEYS.test(k)) {
                    if (LANDMARK_KEYS.test(k) || k === 'landmarks') {
                        out[k] = summarizeLandmarks(value[k]);
                    } else if (k === 'samples' && Array.isArray(value[k])) {
                        out[k] = { length: value[k].length };
                    } else if (k === 'rawPath' && Array.isArray(value[k])) {
                        out[k] = { length: value[k].length };
                    } else {
                        out[k] = `[Omitted:${k}]`;
                    }
                    continue;
                }
                try {
                    out[k] = sanitize(value[k], depth + 1, k);
                } catch (e) {
                    out[k] = `[SanitizeError:${e.message}]`;
                }
            }
            if (Object.keys(value).length > keys.length) {
                out['…'] = `+${Object.keys(value).length - keys.length} keys`;
            }
            seen.delete(value);
            return out;
        }

        try {
            return String(value);
        } catch (_) {
            return '[Unserializable]';
        }
    }

    function makeEntry(level, scope, event, data) {
        seq += 1;
        const entry = {
            seq,
            level,
            ts: new Date().toISOString(),
            relMs: relMs(),
            scope: scope || 'app',
            event: event || 'log',
            data: data === undefined ? undefined : sanitize(data, 0, null)
        };
        buffer.push(entry);
        if (buffer.length > RING_MAX) buffer.shift();
        return entry;
    }

    function consoleOut(level, entry) {
        const tag = `[WECOG_DEBUG:${entry.scope}] ${entry.event}`;
        const payload = entry.data;
        if (level === 'error') {
            console.error(tag, payload !== undefined ? payload : '');
        } else if (level === 'warn') {
            console.warn(tag, payload !== undefined ? payload : '');
        } else if (level === 'mark') {
            console.info(tag, payload !== undefined ? payload : '');
        } else {
            console.log(tag, payload !== undefined ? payload : '');
        }
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
        const rows = filter
            ? buffer.filter((e) =>
                (e.scope && String(e.scope).includes(filter)) ||
                (e.event && String(e.event).includes(filter)))
            : buffer.slice();
        console.table(rows.map((e) => ({
            seq: e.seq,
            relMs: e.relMs,
            level: e.level,
            scope: e.scope,
            event: e.event,
            data: e.data
        })));
        return rows;
    }

    function find(needle) {
        const n = String(needle || '').toLowerCase();
        return buffer.filter((e) =>
            String(e.scope || '').toLowerCase().includes(n) ||
            String(e.event || '').toLowerCase().includes(n));
    }

    function clear() {
        buffer.length = 0;
        log('debug', 'buffer:cleared');
    }

    function pushTimeline(name, data) {
        if (!isEnabled()) return;
        const key = timelines[name] ? name : 'events';
        const row = {
            ts: new Date().toISOString(),
            relMs: relMs(),
            ...(data && typeof data === 'object' ? data : { value: data })
        };
        const arr = timelines[key];
        arr.push(row);
        if (arr.length > TIMELINE_MAX) arr.shift();
    }

    function recordOverlayTransition(action, reason, extra) {
        if (!isEnabled()) return;
        const row = { action, reason: reason || null, ...(extra || {}) };
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
        if (!patch || typeof patch !== 'object') return;
        Object.assign(gazeDiagnostics, patch);
    }

    function setRuntimeSnapshot(snapshot) {
        lastRuntimeSnapshot = snapshot;
    }

    function incrementEventLoss(n) {
        eventLossCount += (Number.isFinite(n) ? n : 1);
    }

    function setActiveListenerCount(n) {
        if (Number.isFinite(n)) activeListenerCount = n;
    }

    function getGazeDiagnostics() {
        const t = gazeDiagnostics.totalSamples || 1;
        return {
            ...gazeDiagnostics,
            onScreenFalsePct: Math.round((gazeDiagnostics.onScreenFalseCount / t) * 1000) / 10,
            clippedPct: Math.round((gazeDiagnostics.clippedCount / t) * 1000) / 10,
            offScreenCorrectedPct: Math.round((gazeDiagnostics.offScreenCorrectedCount / t) * 1000) / 10
        };
    }

    function exportJson() {
        return {
            enabled: isEnabled(),
            exportedAt: new Date().toISOString(),
            relMs: relMs(),
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            href: typeof location !== 'undefined' ? location.href : null,
            count: buffer.length,
            events: buffer.slice()
        };
    }

    function exportDebugBundle() {
        const sessionEvents = (() => {
            try {
                return global.__WECOG_STATE__?.sessionData?.events?.slice(-200) || null;
            } catch (_) {
                return null;
            }
        })();
        return {
            schema: 'wecog-debug-bundle-v1',
            exportedAt: new Date().toISOString(),
            relMs: relMs(),
            debug: exportJson(),
            timelines: {
                qc: timelines.qc.slice(),
                gaze: timelines.gaze.slice(),
                bpm: timelines.bpm.slice(),
                overlay: timelines.overlay.slice(),
                keys: timelines.keys.slice()
            },
            gazeDiagnostics: getGazeDiagnostics(),
            bpmDiagnostics: global.__WECOG_BPM_DIAG__ || null,
            visuospatialDiagnostics: global.__WECOG_VIS_DIAG__ || null,
            runtime: lastRuntimeSnapshot,
            sessionEvents,
            overlayTransitions: timelines.overlay.slice(),
            calibrationMetrics: {
                gazeValidation: global.__WECOG_STATE__?.sessionData?.gazeValidation || null
            },
            browser: {
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
                language: typeof navigator !== 'undefined' ? navigator.language : null,
                platform: typeof navigator !== 'undefined' ? navigator.platform : null,
                deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory : null,
                hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null,
                screen: typeof screen !== 'undefined'
                    ? { width: screen.width, height: screen.height, pixelRatio: global.devicePixelRatio }
                    : null
            },
            flags: {
                eventLossCount,
                activeListenerCount,
                entrypoint: 'mvp_with_precheck_1-updated.html'
            }
        };
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
        find
    };

    Object.defineProperty(api, 'enabled', {
        enumerable: true,
        configurable: true,
        get: isEnabled
    });

    global.WECOG_DEBUG = api;

    try {
        console.info('[WECOG_DEBUG] runtime loaded; enabled=%s (localStorage.wecog_debug=1 or ?debug=1)', isEnabled());
    } catch (_) { /* ignore */ }

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

    global.addEventListener('error', function onWindowError(ev) {
        if (!isEnabled()) return;
        error('global', 'error', {
            message: ev.message,
            source: ev.filename,
            lineno: ev.lineno,
            colno: ev.colno,
            stack: ev.error && ev.error.stack ? String(ev.error.stack) : undefined
        });
    });

    global.addEventListener('unhandledrejection', function onUnhandledRejection(ev) {
        if (!isEnabled()) return;
        const reason = ev.reason;
        error('global', 'unhandledrejection', {
            message: reason && reason.message ? reason.message : String(reason),
            stack: reason && reason.stack ? String(reason.stack) : undefined,
            name: reason && reason.name ? reason.name : undefined
        });
    });
})(typeof window !== 'undefined' ? window : globalThis);
