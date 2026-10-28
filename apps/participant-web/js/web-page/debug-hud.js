/**
 * Debug HUD overlay + runtime snapshot collector (diagnostics only).
 * Requires debug-runtime.js and debug mode (?debug=1 or localStorage wecog_debug=1).
 */
(function initWecogDebugHud(global) {
    'use strict';

    global.WECOG_DEBUG_HUD?.dispose?.();
    let running = false;
    let disposed = false;
    let generation = 0;
    const ownedListeners = [];
    const lifetimeListeners = [];

    function listen(target, type, callback, options, lifetime = false) {
        const current = generation;
        const handler = event => {
            if (disposed || (!lifetime && (!running || generation !== current))) return;
            callback(event);
        };
        target.addEventListener(type, handler, options);
        (lifetime ? lifetimeListeners : ownedListeners).push(() => target.removeEventListener(type, handler, options));
    }

    const HUD_ID = 'wecog-debug-hud';
    const BTN_ID = 'wecog-debug-download-btn';
    const TOGGLE_BTN_ID = 'wecog-debug-toggle-btn';
    /** Ниже fullscreen-калибровки (style.css ~2000–2002), чтобы не перекрывать точки. */
    const HUD_Z = 1500;
    const AUTO_HIDE_PHASES = new Set([
        'calibration',
        'validation',
        'visuospatial_drawing',
        'visuospatial_instruction'
    ]);
    const KEY_DIAGNOSTIC_PHASES = new Set(['cognitive_stimulus', 'cognitive_fixation', 'visuospatial_drawing']);

    let userDismissed = false;
    let expanded = false;

    function dbg() {
        return global.WECOG_DEBUG;
    }

    function isOn() {
        const d = dbg();
        return !!(d && d.isEnabled && d.isEnabled());
    }

    function fmt(v, digits) {
        if (v === null || v === undefined) return '—';
        if (typeof v === 'number' && Number.isFinite(v)) {
            return digits != null ? v.toFixed(digits) : String(v);
        }
        if (typeof v === 'boolean') return v ? 'yes' : 'no';
        return String(v);
    }

    function deriveFrameReasonCodes(precheckResult) {
        if (!precheckResult) return [];
        const codes = [];
        if (!precheckResult.face || precheckResult.face.detected !== true) codes.push('face_missing');
        const fs = precheckResult.face?.status;
        if (fs && fs !== 'ok' && fs !== 'detected') codes.push('face:' + fs);
        if (precheckResult.pose) {
            const poseOk = precheckResult.pose.status === 'stable' ||
                (precheckResult.pose.isStable === true && precheckResult.pose.isTilted !== true);
            if (!poseOk) codes.push('pose:' + (precheckResult.pose.status || 'unstable'));
        }
        if (precheckResult.illumination && precheckResult.illumination.status !== 'optimal') {
            codes.push('light:' + precheckResult.illumination.status);
        }
        return codes;
    }

    function frameAcceptable(precheckResult) {
        const ov = global.qcPauseOverlay;
        if (ov && typeof ov.isCurrentFrameAcceptable === 'function') {
            return ov.isCurrentFrameAcceptable(precheckResult);
        }
        return deriveFrameReasonCodes(precheckResult).length === 0;
    }

    function validityClass(precheckResult, metrics) {
        if (!precheckResult) return 'unknown';
        if (!frameAcceptable(precheckResult)) return 'unacceptable';
        if (metrics && typeof metrics.qcScore === 'number' && metrics.qcScore < 0.6) return 'session_qc_low';
        return 'acceptable';
    }

    function collectSnapshot() {
        if (!isOn()) return null;
        const state = global.__WECOG_STATE__;
        const rt = state?.runtime || {};
        const flags = state?.flags || {};
        const video = document.getElementById('precheckVideo') || document.getElementById('bpmVideo');
        const fpsState = state?.cameraFpsState || {};
        const metrics = rt.qcMetrics?.isRunning?.() ? rt.qcMetrics.getCurrentMetrics() : null;
        const precheck = rt.precheckData || rt.lastPrecheckResult || null;
        const gaze = rt.currentGaze || { x: null, y: null };
        const gazeVal = state?.sessionData?.gazeValidation || null;
        const gt = rt.gazeTracker;
        const bpmDiag = global.__WECOG_BPM_DIAG__ || {};
        const visDiag = global.__WECOG_VIS_DIAG__ || {};
        const overlay = global.qcPauseOverlay;
        const gazeDiagApi = dbg();

        const lastGaze = (() => {
            const arr = state?.sessionData?.eyeTracking;
            if (!Array.isArray(arr) || !arr.length) return null;
            return arr[arr.length - 1];
        })();

        const postCorr = gt?._postCalibrationCorrection || gazeVal?.postCalibrationCorrection || null;

        return {
            camera: {
                fps: fpsState.currentFps ?? metrics?.cameraFps ?? null,
                analysisFps: metrics?.analysisFps ?? null,
                resolution: video
                    ? { w: video.videoWidth || 0, h: video.videoHeight || 0 }
                    : { w: 0, h: 0 },
                droppedFrames: null
            },
            face: {
                detected: flags.faceDetected ?? (precheck?.face?.detected === true),
                confidence: precheck?.face?.confidence ?? null,
                pose: precheck?.pose?.status ?? null,
                faceVisiblePercent: metrics?.faceVisiblePct ?? null
            },
            gaze: {
                rawX: lastGaze?.modelX ?? null,
                rawY: lastGaze?.modelY ?? null,
                correctedX: lastGaze?.correctedX ?? gaze.x,
                correctedY: lastGaze?.correctedY ?? gaze.y,
                onScreen: lastGaze?.onScreen ?? null,
                validationRmsPx: gazeVal?.metrics?.validationRmsPx ?? gazeVal?.metrics?.accuracyPx ?? null,
                calibrationStatus: gt?._isCalibrated ? 'calibrated' : 'not_calibrated',
                loocvPass: gazeVal?.postCalibrationCorrection?.applied === true
                    ? 'applied'
                    : (gazeVal?.postCalibrationCorrection?.applied === false ? 'rejected' : null),
                postCalibrationApplied: !!(postCorr && (postCorr.applied || gazeVal?.postCalibrationCorrection?.applied)),
                clipped: lastGaze?.clipped ?? null
            },
            qc: {
                qc_score: metrics?.qcScore ?? null,
                validityClass: validityClass(precheck, metrics),
                reasonCodes: deriveFrameReasonCodes(precheck),
                frameAcceptable: frameAcceptable(precheck)
            },
            bpm: {
                moduleLoaded: !!bpmDiag.moduleLoaded,
                roiDetected: bpmDiag.roiDetected ?? null,
                signalQuality: bpmDiag.signalQuality ?? bpmDiag.confidence ?? null,
                bpmEstimate: bpmDiag.bpmEstimate ?? null,
                bufferLength: bpmDiag.bufferLength ?? bpmDiag.sampleCount ?? null,
                reporterAvailable: !!bpmDiag.reporterAvailable,
                importAttempts: Array.isArray(bpmDiag.importAttempts) ? bpmDiag.importAttempts.length : null
            },
            visuospatial: {
                spaceDown: !!visDiag.spaceDown,
                penDown: !!visDiag.penDown,
                canvasWidth: visDiag.canvasWidth ?? null,
                canvasHeight: visDiag.canvasHeight ?? null,
                currentGazeValid: !!visDiag.currentGazeValid,
                focusTag: visDiag.focusTag ?? null
            },
            runtime: {
                currentTest: rt.currentPhase ?? null,
                activeOverlay: overlay?.isVisible?.()
                    ? 'qc-pause'
                    : (document.getElementById('visuospatialDrawingOverlay')
                        && document.getElementById('visuospatialDrawingOverlay').style.display !== 'none'
                        ? 'visuospatial'
                        : 'none'),
                activeListeners: global.__WECOG_ACTIVE_LISTENERS__ ?? null,
                currentState: rt.currentPhase ?? null,
                eventLossCount: gazeDiagApi?.getEventLossCount?.() ?? null
            }
        };
    }

    function renderHud(el, snap) {
        if (!el || !snap) return;
        const g = snap.gaze || {};
        const gd = dbg()?.getGazeDiagnostics?.() || {};
        const lines = [
            '=== CAMERA ===',
            'FPS: ' + fmt(snap.camera.fps, 1) + ' | res: ' + snap.camera.resolution.w + 'x' + snap.camera.resolution.h,
            '',
            '=== FACE ===',
            'detected: ' + fmt(snap.face.detected) + ' | conf: ' + fmt(snap.face.confidence, 2),
            'pose: ' + fmt(snap.face.pose) + ' | faceVis%: ' + fmt(snap.face.faceVisiblePercent, 1),
            '',
            '=== GAZE ===',
            'raw: ' + fmt(g.rawX, 0) + ',' + fmt(g.rawY, 0) + ' | corr: ' + fmt(g.correctedX, 0) + ',' + fmt(g.correctedY, 0),
            'onScreen: ' + fmt(g.onScreen) + ' | RMS: ' + fmt(g.validationRmsPx, 1),
            'calib: ' + fmt(g.calibrationStatus) + ' | LOOCV: ' + fmt(g.loocvPass),
            'post-cal: ' + fmt(g.postCalibrationApplied),
            'off-screen corr%: ' + fmt(gd.offScreenCorrectedPct, 1) + ' | clip%: ' + fmt(gd.clippedPct, 1),
            '',
            '=== QC ===',
            'qc_score: ' + fmt(snap.qc.qc_score, 3) + ' | class: ' + fmt(snap.qc.validityClass),
            'reasons: ' + (snap.qc.reasonCodes.length ? snap.qc.reasonCodes.join(',') : '—'),
            'frame OK: ' + fmt(snap.qc.frameAcceptable),
            '',
            '=== BPM ===',
            'loaded: ' + fmt(snap.bpm.moduleLoaded) + ' | ROI: ' + fmt(snap.bpm.roiDetected),
            'BPM: ' + fmt(snap.bpm.bpmEstimate, 1) + ' | qual: ' + fmt(snap.bpm.signalQuality, 2),
            'buf: ' + fmt(snap.bpm.bufferLength) + ' | reporter: ' + fmt(snap.bpm.reporterAvailable),
            '',
            '=== VISUOSPATIAL ===',
            'SpaceDown: ' + fmt(snap.visuospatial.spaceDown) + ' | PenDown: ' + fmt(snap.visuospatial.penDown),
            'canvas: ' + fmt(snap.visuospatial.canvasWidth, 0) + 'x' + fmt(snap.visuospatial.canvasHeight, 0),
            'gaze valid: ' + fmt(snap.visuospatial.currentGazeValid) + ' | focus: ' + fmt(snap.visuospatial.focusTag),
            '',
            '=== RUNTIME ===',
            'phase: ' + fmt(snap.runtime.currentState),
            'overlay: ' + fmt(snap.runtime.activeOverlay),
            'listeners: ' + fmt(snap.runtime.activeListeners)
        ];
        el.textContent = lines.join('\n');
    }

    function isFullscreenCalibrationActive() {
        const el = document.getElementById('fullscreenCalibration');
        return !!(el && el.classList.contains('active'));
    }

    function shouldAutoHideHud() {
        if (isFullscreenCalibrationActive()) return true;
        const phase = global.__WECOG_STATE__?.runtime?.currentPhase;
        if (phase && AUTO_HIDE_PHASES.has(phase)) return true;
        return false;
    }

    function applyHudVisibility(root) {
        const toggle = document.getElementById(TOGGLE_BTN_ID);
        const autoHide = shouldAutoHideHud();

        if (autoHide || userDismissed) {
            if (root) root.style.display = 'none';
            if (toggle) toggle.style.display = autoHide ? 'none' : 'block';
            return;
        }

        if (toggle) toggle.style.display = 'block';

        if (!expanded) {
            if (root) root.style.display = 'none';
            return;
        }

        if (root) root.style.display = 'block';
    }

    function setExpanded(on) {
        expanded = !!on;
        userDismissed = !expanded;
        const root = document.getElementById(HUD_ID);
        const toggle = document.getElementById(TOGGLE_BTN_ID);
        if (toggle) {
            toggle.textContent = expanded ? 'DEBUG ▾' : 'DEBUG ▸';
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
        applyHudVisibility(root);
    }

    function toggleExpanded() {
        if (shouldAutoHideHud()) return;
        setExpanded(!expanded);
    }

    function ensureHud() {
        let root = document.getElementById(HUD_ID);
        if (root) return root;
        const current = generation;

        const btnStyle = 'font-size:11px;padding:4px 10px;cursor:pointer;border-radius:6px;border:1px solid #64748b;background:#334155;color:#f8fafc;';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.id = TOGGLE_BTN_ID;
        toggle.textContent = expanded ? 'DEBUG ▾' : 'DEBUG ▸';
        toggle.setAttribute('aria-label', 'Toggle debug HUD');
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggle.style.cssText = btnStyle + 'position:fixed;bottom:12px;right:12px;z-index:' + HUD_Z + ';opacity:0.92;';
        toggle.addEventListener('click', (ev) => {
            if (!running || current !== generation) return;
            ev.preventDefault();
            ev.stopPropagation();
            toggleExpanded();
        });
        document.body.appendChild(toggle);

        root = document.createElement('div');
        root.id = HUD_ID;
        root.setAttribute('aria-hidden', 'true');
        root.style.cssText = [
            'position:fixed;bottom:48px;right:12px;z-index:' + HUD_Z + ';',
            'max-width:min(380px,88vw);max-height:min(55vh,480px);overflow:auto;',
            'padding:8px 10px;margin:0;display:none;',
            'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;',
            'color:#e2e8f0;background:rgba(15,23,42,0.92);',
            'border:1px solid rgba(148,163,184,0.35);border-radius:8px;',
            'pointer-events:auto;white-space:pre;box-shadow:0 4px 24px rgba(0,0,0,0.35);'
        ].join('');

        const pre = document.createElement('pre');
        pre.id = HUD_ID + '-body';
        pre.style.margin = '0 0 8px 0';
        root.appendChild(pre);

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '6px';
        row.style.flexWrap = 'wrap';

        const dl = document.createElement('button');
        dl.type = 'button';
        dl.id = BTN_ID;
        dl.textContent = 'Download debug bundle';
        dl.style.cssText = btnStyle;
        dl.addEventListener('click', () => {
            if (!running || current !== generation) return;
            const d = dbg();
            if (d && d.downloadDebugBundle) d.downloadDebugBundle();
        });

        const hideBtn = document.createElement('button');
        hideBtn.type = 'button';
        hideBtn.textContent = 'Collapse';
        hideBtn.style.cssText = btnStyle;
        hideBtn.addEventListener('click', () => { if (running && current === generation) setExpanded(false); });

        const hint = document.createElement('span');
        hint.style.cssText = 'font-size:10px;color:#94a3b8;align-self:center;';
        hint.textContent = '` toggle';

        row.appendChild(dl);
        row.appendChild(hideBtn);
        row.appendChild(hint);
        root.appendChild(row);
        document.body.appendChild(root);
        return root;
    }

    let rafId = null;
    let lastQcPush = 0;
    let lastSnapshotAt = null;

    function tick(current) {
        if (!running || disposed || current !== generation) return;
        if (!isOn()) {
            stop();
            return;
        }
        ensureHud();
        const hud = document.getElementById(HUD_ID);
        applyHudVisibility(hud);

        const now = global.performance.now();
        if (lastSnapshotAt !== null && now - lastSnapshotAt < 200) {
            rafId = global.requestAnimationFrame(() => tick(current));
            return;
        }
        lastSnapshotAt = now;
        let snap;
        try { snap = collectSnapshot(); }
        catch (_) {
            // Diagnostics must not interrupt the measurement loop or spin on a broken collector.
            stop();
            dbg()?.mark?.('debug', 'hud:collector_unavailable');
            return;
        }
        const pre = document.getElementById(HUD_ID + '-body');
        if (expanded && hud && hud.style.display !== 'none') {
            renderHud(pre, snap);
        }
        const d = dbg();
        if (d && d.setRuntimeSnapshot) d.setRuntimeSnapshot(snap);

        if (d && d.pushTimeline && now - lastQcPush > 500) {
            lastQcPush = now;
            d.pushTimeline('qc', {
                qcScore: snap.qc.qc_score,
                validityClass: snap.qc.validityClass,
                frameAcceptable: snap.qc.frameAcceptable,
                phase: snap.runtime.currentState
            });
        }

        if (running && current === generation) rafId = global.requestAnimationFrame(() => tick(current));
    }

    function start() {
        if (disposed || running || !isOn()) return;
        running = true;
        generation++;
        lastSnapshotAt = null;
        lastQcPush = 0;
        wireKeyboardToggle();
        wireFocusDiagnostics();
        const d = dbg();
        if (d && d.mark) d.mark('debug', 'hud:started');
        tick(generation);
    }

    function stop() {
        running = false;
        generation++;
        if (rafId !== null) global.cancelAnimationFrame(rafId);
        rafId = null;
        ownedListeners.splice(0).forEach(remove => remove());
        document.getElementById(HUD_ID)?.remove();
        document.getElementById(TOGGLE_BTN_ID)?.remove();
    }

    function dispose() {
        stop();
        disposed = true;
        lifetimeListeners.splice(0).forEach(remove => remove());
    }

    function wireKeyboardToggle() {
        listen(document, 'keydown', (ev) => {
            if (!isOn()) return;
            if (ev.key !== '`' && ev.code !== 'Backquote') return;
            if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
            if (!diagnosticKeySurface(ev) || editableEvent(ev)) return;
            if (KEY_DIAGNOSTIC_PHASES.has(global.__WECOG_STATE__?.runtime?.currentPhase)) return;
            ev.preventDefault();
            toggleExpanded();
        }, true);
    }

    function wireFocusDiagnostics() {
        listen(document, 'focusin', (ev) => {
            if (!isOn()) return;
            const t = ev.target;
            const rawTag = String(t?.tagName || '').toLowerCase();
            const tag = ['input', 'textarea', 'select', 'button', 'canvas', 'body'].includes(rawTag) ? rawTag : 'other';
            const d = dbg();
            if (d) {
                d.pushTimeline('keys', { type: 'focusin', tag });
            }
            if (!global.__WECOG_VIS_DIAG__) global.__WECOG_VIS_DIAG__ = {};
            global.__WECOG_VIS_DIAG__.focusTag = tag;
        }, true);
        function recordKey(type, ev) {
            if (!isOn() || !diagnosticKeySurface(ev) || editableEvent(ev) || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
            const phase = global.__WECOG_STATE__?.runtime?.currentPhase;
            if (!KEY_DIAGNOSTIC_PHASES.has(phase)) return;
            if (!/^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Space|Enter|Escape|Backquote|Arrow(?:Left|Right|Up|Down)|Comma|Period)$/.test(ev.code)) return;
            const d = dbg();
            if (d) d.pushTimeline('keys', { type, physicalCode: ev.code });
        }
        listen(document, 'keydown', ev => recordKey('keydown', ev), true);
        listen(document, 'keyup', ev => recordKey('keyup', ev), true);
    }

    function diagnosticKeySurface(event) {
        const target = event.composedPath?.()[0] || event.target;
        // Unknown/retargeted component hosts may contain a closed shadow input.
        return ['BODY', 'HTML', 'BUTTON', 'CANVAS'].includes(target?.tagName);
    }

    function editableEvent(event) {
        try {
            const nodes = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
            let active = document.activeElement;
            for (let i = 0; active && i < 8; i++) {
                nodes.push(active);
                active = active.shadowRoot?.activeElement;
            }
            return nodes.some(node => node && (node.isContentEditable
                || node.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')));
        } catch (_) { return true; }
    }

    global.WECOG_DEBUG_HUD = {
        start,
        stop,
        dispose,
        isRunning: () => running,
        collectSnapshot,
        isOn,
        toggle: toggleExpanded,
        setExpanded,
        collapse: () => setExpanded(false)
    };

    function boot() {
        if (isOn()) start();
    }

    if (document.readyState === 'loading') {
        listen(document, 'DOMContentLoaded', boot, { once: true }, true);
    } else {
        boot();
    }

    listen(global, 'storage', (ev) => {
        if (ev.key === 'wecog_debug') {
            if (isOn()) start();
            else { stop(); dbg()?.clear?.(); }
        }
    }, undefined, true);
    listen(global, 'pagehide', stop, undefined, true);
    listen(global, 'pageshow', boot, undefined, true);
})(typeof window !== 'undefined' ? window : globalThis);
