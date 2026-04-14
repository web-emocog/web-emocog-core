/**
 * QC Metrics Module v3.4
 * 
 * Основной класс для сбора и анализа QC метрик
 * 
 * ИЗМЕНЕНИЯ v3.4:
 * - Renamed currentFps → analysisFps in report output for clarity
 *   (this is the processFrame() call rate, not camera FPS)
 * - QC Score now returns 0-1 (LEGACY-compatible) with hard penalties
 * - QC_WEIGHTS updated to include dropout/fps components
 * - Added fps_absolute_min threshold
 * 
 * @version 3.4.0
 * @module qc-metrics/QCMetrics
 */

import { createThresholds, VIDEO_ELEMENT_IDS } from './constants.js';
import { VideoFpsMonitor } from './fps-monitor.js';
import { createGazeState, setGazeScreenState, addGazePoint, accumulateGazeTime } from './gaze-tracking.js';
import { createInstrumentCounters, computeFrameFlags, updateInstrumentCounters } from './frame-analysis.js';
import { createValidationState, setValidationData } from './validation.js';
import { getCurrentMetrics, getSummary } from './metrics-calculator.js';

class QCMetrics {
    constructor(options = {}) {
        this.thresholds = createThresholds(options);
        this.videoElementIdCandidates = options.videoElementIds || VIDEO_ELEMENT_IDS;
        
        // State
        this._counters = createInstrumentCounters();
        this._gazeState = createGazeState();
        this._validationState = createValidationState();
        this._fpsMonitor = new VideoFpsMonitor();
        
        this._startTime = 0;
        this._lastFrameTime = 0;
        this._isRunning = false;
        this._useRealCameraFps = options.useRealCameraFps || false;
        
        // Callbacks
        this.onMetricsUpdate = options.onMetricsUpdate || null;
    }

    /**
     * Начало сбора метрик
     * @param {Object} options - опции запуска
     * @param {boolean} options.useRealCameraFps - использовать requestVideoFrameCallback для реального FPS
     */
    start(options = {}) {
        this._startTime = Date.now();
        this._lastFrameTime = performance.now();
        this._isRunning = true;
        
        this._counters = createInstrumentCounters();
        this._gazeState = createGazeState();
        this._validationState = createValidationState();
        
        const useRealFps = options.useRealCameraFps ?? this._useRealCameraFps;
        
        this._fpsMonitor.findVideoElement(this.videoElementIdCandidates);
        this._fpsMonitor.start(useRealFps);
        
        console.log(`[QCMetrics] Started (realCameraFps: ${useRealFps})`);
    }

    /**
     * Остановка сбора метрик
     */
    stop() {
        this._isRunning = false;
        this._fpsMonitor.stop();
        console.log('[QCMetrics] Stopped');
    }

    /**
     * Обработка кадра (вызывать из основного цикла)
     * 
     * @param {Object} precheckResult - результат PrecheckAnalyzer
     * @param {Object} segmenterResult - результат FaceSegmenter (опционально)
     */
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
            this.thresholds.fps_low_abs_floor
        );
        
        // Frame flags
        const flags = computeFrameFlags(precheckResult, segmenterResult);
        
        // Update gaze state with occlusion info
        // If face is occluded, gaze cannot be valid
        if (flags.occlusionDetected) {
            this._gazeState = setGazeScreenState(
                this._gazeState, 
                false,  // not valid
                null,   // unknown onScreen
                true    // occluded
            );
        }
        
        // Update counters
        this._counters = updateInstrumentCounters(
            this._counters, 
            flags, 
            this._gazeState, 
            isLowFps, 
            deltaMs
        );
        
        // Accumulate gaze time
        this._gazeState = accumulateGazeTime(this._gazeState, deltaMs);
        
        // Callback
        if (this.onMetricsUpdate) {
            this.onMetricsUpdate(this.getCurrentMetrics());
        }
    }

    /**
     * Установка состояния gaze от внешнего трекера
     * API для gaze-tracker.js
     * 
     * @param {boolean} valid - валидность gaze
     * @param {boolean|null} onScreen - на экране или нет
     * @param {boolean} occluded - флаг окклюзии (опционально)
     */
    setGazeScreenState(valid, onScreen, occluded = false) {
        this._gazeState = setGazeScreenState(this._gazeState, valid, onScreen, occluded);
    }

    /**
     * Добавление gaze точки (LEGACY - для WebGazer)
     * 
     * @param {Object} gazeData - данные gaze
     * @param {Object} poseData - данные позы
     * @param {boolean} occluded - флаг окклюзии (опционально)
     */
    addGazePoint(gazeData, poseData, occluded = false) {
        this._counters.gazeTotal++;
        this._gazeState = addGazePoint(this._gazeState, gazeData, poseData, this.thresholds, occluded);
    }

    /**
     * Установка данных валидации gaze
     * 
     * @param {Array} validationData - данные валидации
     */
    setValidationData(validationData) {
        this._validationState = setValidationData(this._validationState, validationData);
    }

    /**
     * Получение текущих метрик
     * 
     * @returns {Object} текущие метрики
     */
    getCurrentMetrics() {
        return getCurrentMetrics(
            this._counters,
            this._gazeState,
            this._fpsMonitor,
            this._startTime,
            this.thresholds
        );
    }

    /**
     * Получение итогового summary
     * 
     * @returns {Object} итоговый summary
     */
    getSummary() {
        return getSummary(
            this._counters,
            this._gazeState,
            this._validationState,
            this._fpsMonitor,
            this._startTime,
            this.thresholds
        );
    }

    /**
     * Сброс всех метрик
     */
    reset() {
        this._counters = createInstrumentCounters();
        this._gazeState = createGazeState();
        this._validationState = createValidationState();
        this._fpsMonitor.reset();
        this._startTime = 0;
        this._lastFrameTime = 0;
        this._isRunning = false;
    }

    /**
     * Проверка, запущен ли сбор метрик
     */
    isRunning() {
        return this._isRunning;
    }

    /**
     * Установка видео элемента для FPS мониторинга
     * @param {HTMLVideoElement} video - видео элемент
     */
    setVideoElement(video) {
        this._fpsMonitor.setVideoElement(video);
    }

    /**
     * Установка FPS камеры напрямую (для внешнего мониторинга)
     * @param {number} fps - текущий FPS
     */
    setCameraFps(fps) {
        this._fpsMonitor.setCameraFps(fps);
    }

    /**
     * Получение текущего FPS камеры
     * @returns {number}
     */
    getCameraFps() {
        return this._fpsMonitor.getCameraFps();
    }

    /**
     * Получение среднего FPS камеры
     * @returns {number}
     */
    getAverageCameraFps() {
        return this._fpsMonitor.getAverageFps();
    }
}

export default QCMetrics;
export { QCMetrics };
