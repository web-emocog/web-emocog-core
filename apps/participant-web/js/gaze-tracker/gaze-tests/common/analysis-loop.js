import { state } from '../../../web-page/state.js';
import { extractEyeSignalSample } from '../../../web-page/eye-signal.js';
import { ANALYSIS_LOOP } from '../constants.js';

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
    if (localState.timeoutId) {
        clearTimeout(localState.timeoutId);
        localState.timeoutId = null;
    }
}

function scheduleNext(delayMs = 0) {
    if (!localState.active) return;
    localState.timeoutId = setTimeout(runTick, delayMs);
    state.runtime.gazeTestsAnalysisInterval = localState.timeoutId;
}

async function runTick() {
    if (!localState.active) return;
    if (!localState.video || !state.runtime.localAnalyzer) {
        scheduleNext(100);
        return;
    }

    const started = performance.now();

    try {
        const videoTime = getVideoTime(localState.video);
        if (videoTime < 0 || videoTime === localState.lastVideoTime) {
            scheduleNext(ANALYSIS_LOOP.sameFrameRetryMs);
            return;
        }
        localState.lastVideoTime = videoTime;

        const precheckResult = await state.runtime.localAnalyzer.analyzeFrame(localState.video);

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

        localState.segmenterThrottle++;
        if (localState.segmenterThrottle >= ANALYSIS_LOOP.segmenterStride) {
            localState.segmenterThrottle = 0;
            if (!localState.segmenterInFlight && state.runtime.faceSegmenter && precheckResult?.landmarks) {
                localState.segmenterInFlight = true;
                state.runtime.faceSegmenter.segmentFrame(localState.video, precheckResult.landmarks)
                    .then(result => {
                        localState.lastSegmenterResult = result;
                    })
                    .catch(error => {
                        console.warn('[GazeTests] Ошибка сегментации:', error);
                    })
                    .finally(() => {
                        localState.segmenterInFlight = false;
                    });
            }
        }

        if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
            state.runtime.qcMetrics.processFrame(precheckResult, localState.lastSegmenterResult);
        }
    } catch (error) {
        console.warn('[GazeTests] Ошибка анализа кадра:', error);
    }

    const elapsed = performance.now() - started;
    const nextDelay = Math.max(0, ANALYSIS_LOOP.targetIntervalMs - elapsed);
    scheduleNext(nextDelay);
}

export function startGazeTestsAnalysisLoop() {
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
    localState.active = false;
    clearLoopTimeout();
    localState.video = null;

    state.runtime._gazeTestsLoopActive = false;
    if (state.runtime.gazeTestsAnalysisInterval) {
        clearTimeout(state.runtime.gazeTestsAnalysisInterval);
        state.runtime.gazeTestsAnalysisInterval = null;
    }
}

export function isGazeTestsAnalysisLoopRunning() {
    return localState.active === true;
}
