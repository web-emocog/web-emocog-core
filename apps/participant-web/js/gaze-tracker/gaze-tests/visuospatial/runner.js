import { state, setSessionPhase, setTaskContext, clearTaskContext, recordSessionEvent } from '../../../web-page/state.js';
import { TEST_PHASES, VISUOSPATIAL_CONFIG } from '../constants.js';
import { pickRandomPrompt } from './prompts.js';
import { computeVisuospatialMetrics } from './metrics.js';
import { pushVisuospatialSessionRun } from '../session-schema.js';

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
    if (!canvas) return { width: 1, height: 1 };
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    return { width, height, ratio };
}

export async function runVisuospatialDrawingTest(options = {}) {
    const t = options.t;
    const runId = `visuospatial_run_${Date.now()}`;
    const startedAt = Date.now();

    const container = document.getElementById('gazeTestsContainer');
    const screen = document.getElementById('visuospatialTestScreen');
    const promptTitle = document.getElementById('visuospatialPromptTitle');
    const promptText = document.getElementById('visuospatialPromptText');
    const statusText = document.getElementById('visuospatialStatusText');
    const canvas = document.getElementById('visuospatialCanvas');
    const startBtn = document.getElementById('visuospatialStartBtn');
    const finishBtn = document.getElementById('visuospatialFinishBtn');
    const gazeDot = document.getElementById('visuospatialGazeDot');

    show(container, 'block');
    show(screen, 'block');
    if (finishBtn) finishBtn.disabled = true;

    const canvasInfo = setupCanvas(canvas);
    const ctx = canvas ? canvas.getContext('2d') : null;
    if (ctx) {
        ctx.setTransform(canvasInfo.ratio, 0, 0, canvasInfo.ratio, 0, 0);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#0f766e';
    }
    clearCanvas(canvas, ctx);

    const prompt = pickRandomPrompt();
    const trialId = `${prompt.id}_${Date.now()}`;

    if (promptTitle) promptTitle.textContent = text(t, prompt.i18nTitleKey, prompt.fallbackTitle);
    if (promptText) promptText.textContent = text(t, prompt.i18nTextKey, prompt.fallbackText);
    if (statusText) statusText.textContent = text(t, 'visuospatial_status_wait_start', 'Нажмите «Начать рисование», чтобы начать.');

    setTaskContext({
        blockId: 'visuospatial',
        trialId,
        stimulusId: prompt.id,
        stimulusType: 'drawing_prompt',
        expectedResponse: null
    });
    setSessionPhase(TEST_PHASES.VISUOSPATIAL_INSTRUCTION, { source: 'visuospatial_prompt' });

    recordSessionEvent('visuospatial_run_start', {
        runId,
        trialId,
        promptId: prompt.id
    });
    recordSessionEvent('visuospatial_prompt_selected', {
        runId,
        trialId,
        promptId: prompt.id
    });

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

    if (startBtn) startBtn.disabled = true;
    if (finishBtn) finishBtn.disabled = false;

    setSessionPhase(TEST_PHASES.VISUOSPATIAL_DRAWING, { source: 'visuospatial_draw_start' });
    recordSessionEvent('visuospatial_draw_start', {
        runId,
        trialId,
        promptId: prompt.id
    });

    if (statusText) statusText.textContent = text(t, 'visuospatial_status_drawing', 'Рисование активно. Следите взглядом и завершите, когда будете готовы.');

    const points = [];
    let rafId = null;
    let timeoutId = null;
    let stopped = false;
    let lastPoint = null;
    const drawStartMs = Date.now();

    const stopPromise = new Promise(resolve => {
        const stopRun = (reason = 'manual') => {
            if (stopped) return;
            stopped = true;
            if (rafId) cancelAnimationFrame(rafId);
            if (timeoutId) clearTimeout(timeoutId);
            if (finishBtn) {
                finishBtn.removeEventListener('click', onFinishClick);
                finishBtn.disabled = true;
            }
            resolve(reason);
        };

        const onFinishClick = () => stopRun('manual');
        if (finishBtn) {
            finishBtn.addEventListener('click', onFinishClick);
        }

        timeoutId = setTimeout(() => stopRun('timeout'), VISUOSPATIAL_CONFIG.maxDurationMs);

        const drawTick = () => {
            if (stopped) return;

            const gaze = state.runtime.currentGaze || { x: null, y: null };
            const rect = canvas.getBoundingClientRect();
            const tNow = Date.now();

            if (Number.isFinite(gaze.x) && Number.isFinite(gaze.y)) {
                const x = gaze.x - rect.left;
                const y = gaze.y - rect.top;
                const onScreen = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;

                const point = {
                    x,
                    y,
                    t: tNow,
                    onScreen
                };
                points.push(point);

                if (gazeDot) {
                    gazeDot.style.display = 'block';
                    gazeDot.style.left = `${Math.max(0, Math.min(rect.width, x))}px`;
                    gazeDot.style.top = `${Math.max(0, Math.min(rect.height, y))}px`;
                }

                if (ctx && onScreen) {
                    if (lastPoint && lastPoint.onScreen) {
                        ctx.beginPath();
                        ctx.moveTo(lastPoint.x, lastPoint.y);
                        ctx.lineTo(x, y);
                        ctx.stroke();
                    }
                    lastPoint = point;
                } else {
                    lastPoint = point;
                }
            }

            rafId = requestAnimationFrame(drawTick);
        };

        rafId = requestAnimationFrame(drawTick);
    });

    const endReason = await stopPromise;
    const drawEndMs = Date.now();

    hide(gazeDot);
    if (startBtn) startBtn.disabled = false;

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
        onScreenPct: metrics.onScreenPct
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
        config: {
            ...VISUOSPATIAL_CONFIG
        },
        rawPath: points,
        metrics
    };

    pushVisuospatialSessionRun(state.sessionData, runPayload);

    recordSessionEvent('visuospatial_run_end', {
        runId,
        trialId,
        reason: endReason,
        pointCount: metrics.pointCount,
        pathLengthPx: metrics.pathLengthPx,
        drawingDurationMs: metrics.drawingDurationMs,
        coveragePct: metrics.coveragePct
    });

    clearTaskContext();
    hide(screen);
    hide(container);

    return runPayload;
}
