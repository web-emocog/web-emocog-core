import { state } from '../../../web-page/state.js?v=20261025-1';
import { extractEyeSignalSample } from '../../../web-page/eye-signal.js';
import { ANALYSIS_LOOP } from '../constants.js';
import { isContinuousSessionAnalysisRunning } from '../../../session-runtime/index.js?v=20261108-143l';

function getVideoTime(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return -1;
    const t = videoElement.currentTime;
    return Number.isFinite(t) ? t : -1;
}

let localState = {
    active: false,
    timeoutId: null,
    video: null,
    lastVideoTime: -1,
    segmenterThrottle: 0,
    segmenterInFlight: false,
    lastSegmenterResult: null
};

function clearLoopTimeout() {
    if (localState.timeoutId !== null) {
        clearTimeout(localState.timeoutId);
        localState.timeoutId = null;
    }
}

function canRun(run) {
    if (run !== localState || !run.active) return false;
    if (isContinuousSessionAnalysisRunning()) {
        stopGazeTestsAnalysisLoop();
        return false;
    }
    return true;
}

function scheduleNext(delayMs = 0, run = localState) {
    if (!canRun(run)) return;
    clearLoopTimeout();
    run.timeoutId = setTimeout(() => runTick(run), delayMs);
    state.runtime.gazeTestsAnalysisInterval = run.timeoutId;
}

async function runTick(run) {
    if (!canRun(run)) return;
    run.timeoutId = null;
    state.runtime.gazeTestsAnalysisInterval = null;
    if (!run.video || !state.runtime.localAnalyzer) {
        scheduleNext(100, run);
        return;
    }

    const started = performance.now();

    try {
        const videoTime = getVideoTime(run.video);
        if (videoTime < 0 || videoTime === run.lastVideoTime) {
            scheduleNext(ANALYSIS_LOOP.sameFrameRetryMs, run);
            return;
        }
        run.lastVideoTime = videoTime;

        const precheckResult = await state.runtime.localAnalyzer.analyzeFrame(run.video);
        if (!canRun(run)) return;
        state.runtime.lastPrecheckResult = precheckResult;

        if (precheckResult && precheckResult.pose) {
            state.runtime.lastPoseData = {
                yaw: precheckResult.pose.yaw ?? null,
                pitch: precheckResult.pose.pitch ?? null,
                roll: precheckResult.pose.roll ?? null
            };
        } else {
            state.runtime.lastPoseData = null;
        }

        if (
            state.runtime.gazeTracker &&
            state.runtime.gazeTracker.isCalibrated() &&
            precheckResult &&
            precheckResult.landmarks
        ) {
            const gaze = state.runtime.gazeTracker.predict(precheckResult.landmarks);
            if (gaze && window.handleGazeUpdate) {
                window.handleGazeUpdate(gaze);
            }
        }

        const eyeSignal = extractEyeSignalSample(precheckResult, Date.now());
        if (eyeSignal && window.handleEyeSignalUpdate) {
            window.handleEyeSignalUpdate(eyeSignal);
        }

        run.segmenterThrottle++;
        if (run.segmenterThrottle >= ANALYSIS_LOOP.segmenterStride) {
            run.segmenterThrottle = 0;
            if (!run.segmenterInFlight && state.runtime.faceSegmenter && precheckResult?.landmarks) {
                run.segmenterInFlight = true;
                state.runtime.faceSegmenter.segmentFrame(run.video, precheckResult.landmarks)
                    .then(result => {
                        if (canRun(run)) run.lastSegmenterResult = result;
                    })
                    .catch(error => {
                        if (canRun(run)) console.warn('[GazeTests] Ошибка сегментации:', error);
                    })
                    .finally(() => {
                        run.segmenterInFlight = false;
                    });
            }
        }

        if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
            state.runtime.qcMetrics.processFrame(precheckResult, localState.lastSegmenterResult);
        }
    } catch (error) {
        if (canRun(run)) console.warn('[GazeTests] Ошибка анализа кадра:', error);
    }

    const elapsed = performance.now() - started;
    const nextDelay = Math.max(0, ANALYSIS_LOOP.targetIntervalMs - elapsed);
    scheduleNext(nextDelay, run);
}

export function startGazeTestsAnalysisLoop() {
    if (isContinuousSessionAnalysisRunning()) return true;
    if (localState.active) return true;

    const video = document.getElementById('precheckVideo');
    if (!(video && video.srcObject && state.runtime.localAnalyzer)) {
        console.warn('[GazeTests] analysis loop не запущен: нет video/localAnalyzer');
        return false;
    }

    localState = {
        active: true,
        timeoutId: null,
        video,
        lastVideoTime: -1,
        segmenterThrottle: 0,
        segmenterInFlight: false,
        lastSegmenterResult: null
    };

    state.runtime._gazeTestsLoopActive = true;
    state.runtime.gazeTestsAnalysisInterval = null;

    scheduleNext(0);
    return true;
}

export function stopGazeTestsAnalysisLoop() {
    if (isContinuousSessionAnalysisRunning() && !localState.active) return;
    localState.active = false;
    clearLoopTimeout();
    localState.video = null;

    state.runtime._gazeTestsLoopActive = false;
    if (state.runtime.gazeTestsAnalysisInterval != null) {
        clearTimeout(state.runtime.gazeTestsAnalysisInterval);
        state.runtime.gazeTestsAnalysisInterval = null;
    }

    // Сбрасываем smoothing-буфер EMA и last-known gaze, чтобы следующая фаза
    // не наследовала «прилипшую» точку у края canvas (drawing-test) или
    // вообще последнюю позицию текущего теста. Без этого первые ~16 кадров
    // (~480 мс при s=0.25) следующего predict'а плывут к старой точке.
    if (!isContinuousSessionAnalysisRunning()) {
        if (state.runtime.gazeTracker && typeof state.runtime.gazeTracker.resetSmoothingState === 'function') {
            state.runtime.gazeTracker.resetSmoothingState();
        }
        state.runtime.currentGaze = { x: null, y: null };
    }
}

export function isGazeTestsAnalysisLoopRunning() {
    return localState.active === true;
}
