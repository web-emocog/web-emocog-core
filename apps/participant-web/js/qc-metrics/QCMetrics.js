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
import { VideoFpsMonitor } from './fps-monitor.js';
import { createGazeState, addGazePoint, accumulateGazeTime } from './gaze-tracking.js';
import { createInstrumentCounters, computeFrameFlags, updateInstrumentCounters } from './frame-analysis.js';
import { createValidationState, setValidationData, createTrackingDeviationState, setTrackingDeviationData } from './validation.js';
import { getCurrentMetrics, getSummary } from './metrics-calculator.js';

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

        // Callbacks
        this.onMetricsUpdate = options.onMetricsUpdate || null;
    }

    start(options = {}) {
        this._startTime = Date.now();
        this._lastFrameTime = performance.now();
        this._isRunning = true;

        this._counters = createInstrumentCounters();
        this._gazeState = createGazeState();
        this._validationState = createValidationState();
        this._trackingDeviationState = createTrackingDeviationState();

        const useRealFps = options.useRealCameraFps ?? this._useRealCameraFps;

        this._fpsMonitor.findVideoElement(this.videoElementIdCandidates);
        this._fpsMonitor.start(useRealFps);

        console.log(`[QCMetrics] Started (realCameraFps: ${useRealFps})`);
    }

    stop() {
        this._isRunning = false;
        this._fpsMonitor.stop();
        console.log('[QCMetrics] Stopped');
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
            console.log(`[QCMetrics] Validation data set: ${this._validationState.errors.length} points`);
        }
    }

    setTrackingDeviationData(samples) {
        const next = setTrackingDeviationData(this._trackingDeviationState, samples);
        if (next.isComplete) {
            this._trackingDeviationState = next;
            console.log(`[QCMetrics] Tracking deviation data set: ${next.validSampleCount} valid samples of ${next.sampleCount}`);
        }
    }

    getCurrentMetrics() {
        return getCurrentMetrics(
            this._counters,
            this._gazeState,
            this._fpsMonitor,
            this._startTime,
            this.thresholds,
            this._validationState
        );
    }

    getSummary() {
        return getSummary(
            this._counters,
            this._gazeState,
            this._validationState,
            this._trackingDeviationState,
            this._fpsMonitor,
            this._startTime,
            this.thresholds
        );
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
    setCameraFps(fps) {
        if (typeof fps !== 'number' || fps < 0) return;
        this._fpsMonitor.setCameraFps(fps);
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
