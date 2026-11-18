/**
 * QC Metrics Module v3.5
 *
 * Основной класс для сбора и анализа QC метрик.
 * Публичный API синхронизирован с production-обёрткой qc-metrics.js v3.5.
 *
 * @version 3.5.0
 * @module qc-metrics/QCMetrics
 */

import { createThresholds, VIDEO_ELEMENT_IDS } from './constants.js';
import { VideoFpsMonitor } from './fps-monitor.js?v=20261118-1';
import { createGazeState, addGazePoint, accumulateGazeTime } from './gaze-tracking.js';
import { createInstrumentCounters, computeFrameFlags, updateInstrumentCounters } from './frame-analysis.js?v=20261025-1';
import { createValidationState, setValidationData, createTrackingDeviationState, setTrackingDeviationData } from './validation.js';
import { getCurrentMetrics, getSummary } from './metrics-calculator.js?v=20261118-1';
import { participantDebug as dbg } from '../session-runtime/participant-diagnostic.mjs?v=20261110-integration1';

class QCMetrics {
    constructor(options = {}) {
        this.thresholds = createThresholds(options);
        this.videoElementIdCandidates = options.videoElementIds || VIDEO_ELEMENT_IDS;

        // State
        this._counters = createInstrumentCounters();
        this._gazeState = createGazeState();
        this._validationState = createValidationState();
        this._trackingDeviationState = createTrackingDeviationState();
        this._fpsMonitor = new VideoFpsMonitor();

        this._startTime = 0;
        this._lastFrameTime = 0;
        this._isRunning = false;
        this._useRealCameraFps = options.useRealCameraFps || false;
        this._durationOffset = 0;
        this._segmentStartTime = performance.now();
        this._stoppedTime = this._segmentStartTime;
        this._gazeBaseline = null;
        this._continuity = { schemaVersion: 'qc_continuity.v1', segmentCount: 1, historyComplete: true };

        // Callbacks
        this.onMetricsUpdate = options.onMetricsUpdate || null;
    }

    start(options = {}) {
        if (this._isRunning) this.stop();
        this._startTime = Date.now();
        this._lastFrameTime = performance.now();
        this._segmentStartTime = this._lastFrameTime;
        this._isRunning = true;

        this._counters = createInstrumentCounters();
        this._gazeState = createGazeState();
        this._validationState = createValidationState();
        this._trackingDeviationState = createTrackingDeviationState();
        this._durationOffset = 0;
        this._stoppedTime = null;
        this._gazeBaseline = null;
        this._continuity = { schemaVersion: 'qc_continuity.v1', segmentCount: 1, historyComplete: true };

        const useRealFps = options.useRealCameraFps ?? this._useRealCameraFps;

        this._fpsMonitor.findVideoElement(this.videoElementIdCandidates);
        this._fpsMonitor.start(useRealFps, options.analysisFpsThreshold);

        const previous = options.previousSummary;
        if (previous) {
            const values = previous.counters;
            const keys = Object.keys(this._counters);
            const restorable = values && keys.every(key => Number.isFinite(values[key]) && values[key] >= 0)
                && keys.filter(key => !key.endsWith('Ms')).every(key => Number.isSafeInteger(values[key]))
                && ['faceVisible', 'faceOk', 'poseOk', 'illuminationOk', 'eyesOpen', 'occlusionDetected', 'lowFpsFrames']
                    .every(key => values[key] <= values.totalFrames)
                && values.gazeValid <= values.gazeTotal && values.gazeOnScreen <= values.gazeTotal
                && Number.isFinite(previous.durationMs) && previous.durationMs >= 0;
            const segmentCount = Number.isSafeInteger(previous.continuity?.segmentCount)
                && previous.continuity.segmentCount > 0 && previous.continuity.segmentCount < 1000000
                ? previous.continuity.segmentCount : 1;
            this._continuity = { schemaVersion: 'qc_continuity.v1', segmentCount: segmentCount + 1,
                historyComplete: Boolean(restorable) && previous.continuity?.historyComplete !== false
                    && (!previous.continuity || previous.continuity.schemaVersion === 'qc_continuity.v1'
                        && segmentCount === previous.continuity.segmentCount)
                    && [previous.gazeValidTimeMs, previous.gazeOnScreenTimeMs]
                        .every(value => Number.isFinite(value) && value >= 0) };
            if (restorable) {
                this._counters = Object.fromEntries(keys.map(key => [key, values[key]]));
                this._counters.consecutiveLowFpsMs = 0;
                this._durationOffset = previous.durationMs;
                for (const key of ['validTimeMs', 'onScreenTimeMs']) {
                    const value = previous[key === 'validTimeMs' ? 'gazeValidTimeMs' : 'gazeOnScreenTimeMs'];
                    this._gazeState[key] = Number.isFinite(value) && value >= 0 ? value : 0;
                }
                if (!this._fpsMonitor.restoreAnalysisSession(previous.fpsDiagnostics?.analysisSession)) {
                    this._continuity.historyComplete = false;
                }
            }
        }
        this._gazeBaseline = { gazeTotal: this._counters.gazeTotal, gazeValid: this._counters.gazeValid,
            gazeOnScreen: this._counters.gazeOnScreen, validTimeMs: this._gazeState.validTimeMs,
            onScreenTimeMs: this._gazeState.onScreenTimeMs };

        dbg('qc', 'metrics:start', { realCameraFps: useRealFps === true });
    }

    stop() {
        if (this._isRunning) this._stoppedTime = performance.now();
        this._isRunning = false;
        this._fpsMonitor.stop();
        dbg('qc', 'metrics:stop');
    }

    processFrame(precheckResult, segmenterResult = null) {
        if (!this._isRunning) return;

        const now = performance.now();
        const deltaMs = now - this._lastFrameTime;
        this._lastFrameTime = now;

        // FPS
        this._fpsMonitor.tick(this.thresholds.fps_baseline_warmup_ms);
        const isLowFps = this._fpsMonitor.isLowFps(
            this.thresholds.fps_low_factor,
            this.thresholds.fps_low_abs_cap,
            this.thresholds.fps_low_abs_floor,
            this.thresholds.fps_absolute_min
        );

        // Frame flags
        const flags = computeFrameFlags(precheckResult, segmenterResult);

        // Update counters (без gazeValid/gazeOnScreen — они считаются в addGazePoint)
        this._counters = updateInstrumentCounters(
            this._counters,
            flags,
            this._gazeState,
            isLowFps,
            deltaMs
        );

        // Накопление времени gaze (только если уже был хотя бы один addGazePoint)
        this._gazeState = accumulateGazeTime(this._gazeState, deltaMs);

        if (this.onMetricsUpdate) {
            this.onMetricsUpdate(this.getCurrentMetrics());
        }
    }

    /**
     * Добавление gaze точки.
     * Инкрементирует gazeTotal, gazeValid, gazeOnScreen счётчики (см. P0-2 фикс).
     */
    addGazePoint(gazeData, poseData, occluded = false) {
        this._counters.gazeTotal++;
        const result = addGazePoint(this._gazeState, gazeData, poseData, this.thresholds, occluded);
        this._gazeState = result.state;
        if (result.gazeValidInc) this._counters.gazeValid++;
        if (result.gazeOnScreenInc) this._counters.gazeOnScreen++;
    }

    setValidationData(validationData) {
        this._validationState = setValidationData(this._validationState, validationData);
        if (this._validationState.errors && this._validationState.errors.length > 0) {
            dbg('qc', 'validation:set', () => ({ pointCount: this._validationState.errors.length }));
        }
    }

    resetGazeAvailability() {
        for (const key of ['gazeTotal', 'gazeValid', 'gazeOnScreen']) this._counters[key] = this._gazeBaseline?.[key] || 0;
        this._gazeState = createGazeState();
        this._gazeState.validTimeMs = this._gazeBaseline?.validTimeMs || 0;
        this._gazeState.onScreenTimeMs = this._gazeBaseline?.onScreenTimeMs || 0;
    }

    setTrackingDeviationData(samples) {
        const next = setTrackingDeviationData(this._trackingDeviationState, samples);
        if (next.isComplete) {
            this._trackingDeviationState = next;
            dbg('qc', 'tracking:set', () => ({ validSampleCount: next.validSampleCount, sampleCount: next.sampleCount }));
        }
    }

    getCurrentMetrics() {
        return { ...getCurrentMetrics(
            this._counters,
            this._gazeState,
            this._fpsMonitor,
            this._startTime,
            this.thresholds,
            this._validationState,
            this._elapsedMs()
        ), continuity: { ...this._continuity } };
    }

    getSummary() {
        const summary = getSummary(
            this._counters,
            this._gazeState,
            this._validationState,
            this._trackingDeviationState,
            this._fpsMonitor,
            this._startTime,
            this.thresholds,
            this._elapsedMs()
        );
        const checks = this._continuity.historyComplete ? summary.checks : { ...summary.checks, historyComplete: false };
        return { ...summary, continuity: { ...this._continuity }, checks,
            passedChecks: Object.values(checks).filter(value => value === true).length,
            totalChecks: Object.keys(checks).length,
            overallPass: summary.overallPass && this._continuity.historyComplete };
    }

    _elapsedMs() {
        return this._durationOffset + Math.max(0, (this._stoppedTime ?? performance.now()) - this._segmentStartTime);
    }

    reset() {
        this._counters = createInstrumentCounters();
        this._gazeState = createGazeState();
        this._validationState = createValidationState();
        this._trackingDeviationState = createTrackingDeviationState();
        this._fpsMonitor.reset();
        this._startTime = 0;
        this._lastFrameTime = 0;
        this._isRunning = false;
        this._durationOffset = 0;
        this._gazeBaseline = null;
        this._segmentStartTime = performance.now();
        this._stoppedTime = this._segmentStartTime;
        this._continuity = { schemaVersion: 'qc_continuity.v1', segmentCount: 1, historyComplete: true };
    }

    isRunning() {
        return this._isRunning;
    }

    /**
     * Установка видео элемента для FPS мониторинга (расширенный API, нет в обёртке)
     */
    setVideoElement(video) {
        this._fpsMonitor.setVideoElement(video);
    }

    /**
     * Установка реального FPS камеры. Совместимо с обёрткой.
     */
    setCameraFps(fps, details) {
        if (typeof fps !== 'number' || fps < 0) return;
        this._fpsMonitor.setCameraFps(fps, details);
    }

    /**
     * Расширенный API: получить текущий FPS камеры.
     */
    getCameraFps() {
        return this._fpsMonitor.getCameraFps();
    }

    /**
     * Расширенный API: средний FPS за измеренный период.
     */
    getAverageCameraFps() {
        return this._fpsMonitor.getAverageFps();
    }
}

export default QCMetrics;
export { QCMetrics };
