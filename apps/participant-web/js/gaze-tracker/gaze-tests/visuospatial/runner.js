import { state, setSessionPhase, setTaskContext, clearTaskContext, recordSessionEvent } from '../../../web-page/state.js?v=20260919-1';
import { TEST_PHASES, VISUOSPATIAL_CONFIG } from '../constants.js';
import { pickRandomPrompt } from './prompts.js';
import { computeVisuospatialMetrics } from './metrics.js';
import { pushVisuospatialSessionRun } from '../session-schema.js';

function dbg(scope, event, data) {
    try {
        const d = window.WECOG_DEBUG;
        if (d && d.enabled) d.log(scope, event, data);
    } catch (_) { /* ignore */ }
}

let _visDrawLogN = 0;

function text(t, key, fallback) {
    if (typeof t === 'function') {
        const value = t(key);
        if (value) return value;
    }
    return fallback;
}

function show(el, mode = 'block') {
    if (el) el.style.display = mode;
}

function hide(el) {
    if (el) el.style.display = 'none';
}

function clearCanvas(canvas, ctx) {
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setupCanvas(canvas) {
    if (!canvas) return { width: 1, height: 1, ratio: 1 };
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    return { width, height, ratio };
}

export async function runVisuospatialDrawingTest(options = {}) {
    dbg('visuospatial', 'screen:opened', {});
    const t = options.t;
    const runId = `visuospatial_run_${Date.now()}`;
    const startedAt = Date.now();

    const container = document.getElementById('gazeTestsContainer');
    const introCard = document.getElementById('visuospatialTestScreen');
    const drawingOverlay = document.getElementById('visuospatialDrawingOverlay');
    const promptTitle = document.getElementById('visuospatialPromptTitle');
    const promptText = document.getElementById('visuospatialPromptText');
    const promptHudText = document.getElementById('visuospatialPromptHudText');
    const penStatus = document.getElementById('visuospatialPenStatus');
    const canvas = document.getElementById('visuospatialCanvas');
    const startBtn = document.getElementById('visuospatialStartBtn');
    const finishBtn = document.getElementById('visuospatialFinishBtn');
    const gazeDot = document.getElementById('visuospatialGazeDot');

    // Intro-карточка показывается ВСЕГДА в обычном flow карточки тестов.
    show(container, 'block');
    show(introCard, 'block');
    hide(drawingOverlay);
    if (finishBtn) finishBtn.disabled = true;

    const prompt = pickRandomPrompt();
    const trialId = `${prompt.id}_${Date.now()}`;
    const promptTitleText = text(t, prompt.i18nTitleKey, prompt.fallbackTitle);
    const promptBodyText = text(t, prompt.i18nTextKey, prompt.fallbackText);

    if (promptTitle) promptTitle.textContent = promptTitleText;
    if (promptText) promptText.textContent = promptBodyText;

    setTaskContext({
        blockId: 'visuospatial',
        trialId,
        stimulusId: prompt.id,
        stimulusType: 'drawing_prompt',
        expectedResponse: null
    });
    setSessionPhase(TEST_PHASES.VISUOSPATIAL_INSTRUCTION, { source: 'visuospatial_prompt' });

    recordSessionEvent('visuospatial_run_start', { runId, trialId, promptId: prompt.id });
    recordSessionEvent('visuospatial_prompt_selected', { runId, trialId, promptId: prompt.id });

    // 1. Ждём клика "Начать рисование" в intro-карточке.
    await new Promise(resolve => {
        if (!startBtn) {
            resolve();
            return;
        }
        const onClick = () => {
            startBtn.removeEventListener('click', onClick);
            resolve();
        };
        startBtn.addEventListener('click', onClick);
    });

    if (typeof options.onStart === 'function') options.onStart();

    // 2. Переключаемся в fullscreen drawing overlay.
    hide(introCard);
    show(drawingOverlay, 'block');

    const active = document.activeElement;
    if (active && (active.tagName === 'BUTTON' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        try { active.blur(); } catch (_) { /* ignore */ }
        dbg('visuospatial', 'focus:cleared', { tag: active.tagName, id: active.id || null });
    }
    if (drawingOverlay && !drawingOverlay.hasAttribute('tabindex')) {
        drawingOverlay.setAttribute('tabindex', '-1');
        try { drawingOverlay.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }

    if (promptHudText) promptHudText.textContent = promptTitleText;
    if (penStatus) {
        penStatus.textContent = text(t, 'visuospatial_status_pen_up', 'Пауза (Пробел отпущен)');
    }

    // setupCanvas() читает getBoundingClientRect canvas'а — теперь это весь viewport
    // (canvas внутри fixed overlay 100vw × 100vh). Канвас должен быть видим до setupCanvas,
    // иначе rect = 0×0, поэтому setupCanvas вызываем ПОСЛЕ show(drawingOverlay).
    const canvasInfo = setupCanvas(canvas);
    const ctx = canvas ? canvas.getContext('2d') : null;
    dbg('visuospatial', 'canvas:setup', {
        canvasFound: !!canvas,
        canvasSize: canvasInfo,
        contextExists: !!ctx,
        overlayVisible: drawingOverlay ? drawingOverlay.style.display : null
    });
    if (ctx) {
        ctx.setTransform(canvasInfo.ratio, 0, 0, canvasInfo.ratio, 0, 0);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0f766e';
    }
    clearCanvas(canvas, ctx);

    if (startBtn) startBtn.disabled = true;
    if (finishBtn) finishBtn.disabled = false;

    setSessionPhase(TEST_PHASES.VISUOSPATIAL_DRAWING, { source: 'visuospatial_draw_start' });
    recordSessionEvent('visuospatial_draw_start', { runId, trialId, promptId: prompt.id });

    const points = [];
    let rafId = null;
    let timeoutId = null;
    let stopped = false;
    let lastPoint = null;
    let penDown = false;
    let onKeyDown = null;
    let onKeyUp = null;
    const drawStartMs = Date.now();
    const requireSpace = VISUOSPATIAL_CONFIG.requireSpaceToDraw !== false;

    const stopPromise = new Promise(resolve => {
        const stopRun = (reason = 'manual') => {
            if (stopped) return;
            stopped = true;
            if (rafId) cancelAnimationFrame(rafId);
            if (timeoutId) clearTimeout(timeoutId);
            if (onKeyDown) document.removeEventListener('keydown', onKeyDown, { capture: true });
            if (onKeyUp) document.removeEventListener('keyup', onKeyUp, { capture: true });
            globalThis.__WECOG_ACTIVE_LISTENERS__ = 0;
            if (gazeDot) gazeDot.classList.remove('is-pen-down');
            if (finishBtn) {
                finishBtn.removeEventListener('click', onFinishClick);
                finishBtn.disabled = true;
            }
            resolve(reason);
        };

        const onFinishClick = () => stopRun('manual');
        if (finishBtn) finishBtn.addEventListener('click', onFinishClick);

        timeoutId = setTimeout(() => stopRun('timeout'), VISUOSPATIAL_CONFIG.maxDurationMs);

        // Pen-down/pen-up через Пробел. При отпускании lastPoint = null,
        // чтобы следующий pen-down не соединил линии через "разрыв".
        onKeyDown = (e) => {
            if (e.code === 'Space' && !penDown) {
                penDown = true;
                dbg('visuospatial', 'keydown:Space', { drawingActive: true });
                e.preventDefault();
                if (gazeDot) gazeDot.classList.add('is-pen-down');
                if (penStatus) {
                    penStatus.textContent = text(t, 'visuospatial_status_pen_down', 'Рисование (Пробел зажат)');
                }
            }
        };
        onKeyUp = (e) => {
            if (e.code === 'Space' && penDown) {
                penDown = false;
                dbg('visuospatial', 'keyup:Space', { drawingActive: false });
                e.preventDefault();
                if (gazeDot) gazeDot.classList.remove('is-pen-down');
                if (penStatus) {
                    penStatus.textContent = text(t, 'visuospatial_status_pen_up', 'Пауза (Пробел отпущен)');
                }
                lastPoint = null;
            }
        };
        document.addEventListener('keydown', onKeyDown, { capture: true });
        document.addEventListener('keyup', onKeyUp, { capture: true });
        globalThis.__WECOG_ACTIVE_LISTENERS__ = 2;

        const drawTick = () => {
            if (stopped) return;

            const gaze = state.runtime.currentGaze || { x: null, y: null };
            const rect = canvas.getBoundingClientRect();
            const tNow = Date.now();
            const gazeValid = Number.isFinite(gaze.x) && Number.isFinite(gaze.y);
            globalThis.__WECOG_VIS_DIAG__ = {
                spaceDown: penDown,
                penDown,
                canvasWidth: canvasInfo.width,
                canvasHeight: canvasInfo.height,
                canvasPixelWidth: canvas?.width ?? 0,
                canvasPixelHeight: canvas?.height ?? 0,
                currentGazeValid: gazeValid,
                focusTag: globalThis.__WECOG_VIS_DIAG__?.focusTag ?? null
            };

            if (Number.isFinite(gaze.x) && Number.isFinite(gaze.y)) {
                const x = gaze.x - rect.left;
                const y = gaze.y - rect.top;
                const onScreen = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;

                const point = { x, y, t: tNow, onScreen, penDown };
                points.push(point);

                // Keep participant gaze prediction hidden. The point still
                // contributes to the drawing and is available in diagnostics.
                if (gazeDot) gazeDot.style.display = 'none';

                // Линия рисуется только в пределах canvas И только при удерживаемом Space
                // (если requireSpace=false, рисуется всегда — для legacy/смены поведения).
                const drawingActive = !requireSpace || penDown;
                if (ctx && onScreen && drawingActive) {
                    if (lastPoint && lastPoint.onScreen && (!requireSpace || lastPoint.penDown)) {
                        ctx.beginPath();
                        ctx.moveTo(lastPoint.x, lastPoint.y);
                        ctx.lineTo(x, y);
                        ctx.stroke();
                        if (window.WECOG_DEBUG?.enabled && _visDrawLogN % 45 === 0) {
                            dbg('visuospatial', 'draw:call', { x, y, penDown, drawingActive });
                        }
                    }
                    lastPoint = point;
                } else {
                    if (window.WECOG_DEBUG?.enabled && _visDrawLogN % 60 === 0) {
                        let reason = 'unknown';
                        if (!ctx) reason = 'no_ctx';
                        else if (!onScreen) reason = 'offscreen';
                        else if (!drawingActive) reason = 'not_drawing';
                        dbg('visuospatial', 'draw:skipped', { reason, penDown, requireSpace });
                    }
                    // Pen-up или off-screen — линия не идёт; сбрасываем lastPoint
                    // чтобы при возобновлении не соединить через "разрыв".
                    lastPoint = null;
                }
                if (window.WECOG_DEBUG?.enabled && _visDrawLogN % 30 === 0) {
                    dbg('visuospatial', 'gaze:sample', {
                        gazeX: gaze.x,
                        gazeY: gaze.y,
                        penDown,
                        drawingActive,
                        onScreen
                    });
                }
            } else if (window.WECOG_DEBUG?.enabled && _visDrawLogN % 60 === 0) {
                dbg('visuospatial', 'draw:skipped', { reason: 'no_gaze' });
            }
            _visDrawLogN += 1;

            rafId = requestAnimationFrame(drawTick);
        };

        rafId = requestAnimationFrame(drawTick);
    });

    const endReason = await stopPromise;
    const drawEndMs = Date.now();

    hide(gazeDot);
    if (startBtn) startBtn.disabled = false;
    hide(drawingOverlay);

    const metrics = computeVisuospatialMetrics(points, VISUOSPATIAL_CONFIG, {
        width: canvasInfo.width,
        height: canvasInfo.height
    });

    recordSessionEvent('visuospatial_draw_end', {
        runId,
        trialId,
        reason: endReason,
        pointCount: metrics.pointCount,
        pathLengthPx: metrics.pathLengthPx,
        durationMs: metrics.drawingDurationMs,
        coveragePct: metrics.coveragePct,
        onScreenPct: metrics.onScreenPct,
        penDownPct: metrics.penDownPct,
        pathLengthDiagPct: metrics.pathLengthDiagPct
    });

    if (endReason === 'timeout') {
        recordSessionEvent('visuospatial_timeout', {
            runId,
            trialId,
            timeoutMs: VISUOSPATIAL_CONFIG.maxDurationMs
        });
    }

    const runPayload = {
        runId,
        trialId,
        prompt,
        startedAt,
        endedAt: drawEndMs,
        durationMs: drawEndMs - startedAt,
        drawingWindow: {
            startMs: drawStartMs,
            endMs: drawEndMs,
            durationMs: drawEndMs - drawStartMs,
            reason: endReason
        },
        config: { ...VISUOSPATIAL_CONFIG },
        rawPath: points,
        metrics
    };

    pushVisuospatialSessionRun(state.sessionData, runPayload);
    dbg('visuospatial', 'finish:clicked', {
        endReason,
        savedDrawingSampleCount: metrics.pointCount
    });

    recordSessionEvent('visuospatial_run_end', {
        runId,
        trialId,
        reason: endReason,
        pointCount: metrics.pointCount,
        pathLengthPx: metrics.pathLengthPx,
        drawingDurationMs: metrics.drawingDurationMs,
        coveragePct: metrics.coveragePct,
        penDownPct: metrics.penDownPct
    });

    clearTaskContext();
    hide(drawingOverlay);
    hide(introCard);
    hide(container);

    return runPayload;
}
