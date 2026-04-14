/**
 * FPS Monitor
 * 
 * Мониторинг реального FPS видеопотока камеры
 * Использует requestVideoFrameCallback для точного измерения (если доступен)
 * 
 * @module qc-metrics/fps-monitor
 */

import { VIDEO_ELEMENT_IDS } from './constants.js';

/**
 * Класс для мониторинга FPS видео
 */
export class VideoFpsMonitor {
    constructor() {
        this._video = null;
        this._lastFrameTime = 0;
        this._frameCount = 0;
        this._fpsHistory = [];
        this._currentFps = 0;
        this._cameraFps = 0;
        this._baselineFps = null;
        this._warmupComplete = false;
        this._startTime = 0;
        
        // Для requestVideoFrameCallback
        this._useVideoFrameCallback = false;
        this._videoFrameCallbackId = null;
        this._isRunning = false;
        this._lastVideoTime = 0;
        this._rafId = null;
    }

    /**
     * Поиск видео элемента
     */
    findVideoElement(candidateIds = VIDEO_ELEMENT_IDS) {
        for (const id of candidateIds) {
            const el = document.getElementById(id);
            if (el && el.tagName === 'VIDEO' && el.srcObject) {
                this._video = el;
                return el;
            }
        }
        // Поиск любого video с srcObject
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
            if (v.srcObject) {
                this._video = v;
                return v;
            }
        }
        return null;
    }

    /**
     * Установка видео элемента напрямую
     */
    setVideoElement(video) {
        this._video = video;
    }

    /**
     * Запуск мониторинга
     * @param {boolean} useRealFps - использовать requestVideoFrameCallback для реального FPS
     */
    start(useRealFps = false) {
        this._startTime = performance.now();
        this._lastFrameTime = this._startTime;
        this._frameCount = 0;
        this._fpsHistory = [];
        this._warmupComplete = false;
        this._baselineFps = null;
        this._isRunning = true;
        
        // Если запрошено измерение реального FPS камеры
        if (useRealFps && this._video) {
            this._useVideoFrameCallback = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
            
            if (this._useVideoFrameCallback) {
                console.log('[FpsMonitor] Using requestVideoFrameCallback for accurate camera FPS');
                this._startVideoFrameCallback();
            } else {
                console.log('[FpsMonitor] Using fallback (currentTime check) for camera FPS');
                this._lastVideoTime = this._video.currentTime;
                this._startFallback();
            }
        }
    }

    /**
     * Запуск через requestVideoFrameCallback
     * @private
     */
    _startVideoFrameCallback() {
        if (!this._video || !this._isRunning) return;
        
        const onFrame = (now, metadata) => {
            if (!this._isRunning) return;
            
            this._frameCount++;
            
            // Вычисляем FPS каждую секунду
            const elapsed = now - this._lastFrameTime;
            if (elapsed >= 1000) {
                this._currentFps = Math.round((this._frameCount * 1000) / elapsed);
                this._fpsHistory.push(this._currentFps);
                if (this._fpsHistory.length > 60) {
                    this._fpsHistory.shift();
                }
                
                this._frameCount = 0;
                this._lastFrameTime = now;
                
                // Определение baseline после warmup
                this._checkWarmup(now);
            }
            
            // Запрашиваем следующий кадр
            this._videoFrameCallbackId = this._video.requestVideoFrameCallback(onFrame);
        };
        
        this._videoFrameCallbackId = this._video.requestVideoFrameCallback(onFrame);
    }

    /**
     * Fallback через проверку currentTime
     * @private
     */
    _startFallback() {
        if (!this._video || !this._isRunning) return;
        
        const checkFrame = () => {
            if (!this._isRunning) return;
            
            const now = performance.now();
            
            // Проверяем, изменился ли кадр видео
            if (this._video.currentTime !== this._lastVideoTime) {
                this._frameCount++;
                this._lastVideoTime = this._video.currentTime;
            }
            
            // Вычисляем FPS каждую секунду
            const elapsed = now - this._lastFrameTime;
            if (elapsed >= 1000) {
                this._currentFps = Math.round((this._frameCount * 1000) / elapsed);
                this._fpsHistory.push(this._currentFps);
                if (this._fpsHistory.length > 60) {
                    this._fpsHistory.shift();
                }
                
                this._frameCount = 0;
                this._lastFrameTime = now;
                
                // Определение baseline после warmup
                this._checkWarmup(now);
            }
            
            this._rafId = requestAnimationFrame(checkFrame);
        };
        
        this._rafId = requestAnimationFrame(checkFrame);
    }

    /**
     * Проверка warmup периода
     * @private
     */
    _checkWarmup(now, warmupMs = 2000) {
        if (!this._warmupComplete && (now - this._startTime) >= warmupMs) {
            this._warmupComplete = true;
            if (this._fpsHistory.length >= 2) {
                const sorted = [...this._fpsHistory].sort((a, b) => b - a);
                this._baselineFps = sorted[Math.floor(sorted.length * 0.2)] || sorted[0];
                console.log(`[FpsMonitor] Baseline FPS: ${this._baselineFps}`);
            }
        }
    }

    /**
     * Остановка мониторинга
     */
    stop() {
        this._isRunning = false;
        
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        
        if (this._videoFrameCallbackId && this._video && this._video.cancelVideoFrameCallback) {
            this._video.cancelVideoFrameCallback(this._videoFrameCallbackId);
            this._videoFrameCallbackId = null;
        }
    }

    /**
     * Обновление FPS (вызывать на каждом кадре) — LEGACY API
     * Используется когда не запущен реальный мониторинг через start(true)
     */
    tick(warmupMs = 2000) {
        // Если используем реальный мониторинг, tick не нужен
        if (this._useVideoFrameCallback || this._rafId) {
            return this._currentFps;
        }
        
        const now = performance.now();
        this._frameCount++;

        const elapsed = now - this._lastFrameTime;
        if (elapsed >= 1000) {
            this._currentFps = Math.round((this._frameCount * 1000) / elapsed);
            this._fpsHistory.push(this._currentFps);
            if (this._fpsHistory.length > 60) {
                this._fpsHistory.shift();
            }
            this._frameCount = 0;
            this._lastFrameTime = now;

            // Определение baseline после warmup
            this._checkWarmup(now, warmupMs);
        }

        return this._currentFps;
    }

    /**
     * Установка FPS напрямую (для внешнего мониторинга)
     */
    setCameraFps(fps) {
        this._cameraFps = fps;
        this._currentFps = fps;
        this._fpsHistory.push(fps);
        if (this._fpsHistory.length > 60) {
            this._fpsHistory.shift();
        }
        
        // Определение baseline
        if (!this._warmupComplete && this._fpsHistory.length >= 2) {
            const sorted = [...this._fpsHistory].sort((a, b) => b - a);
            this._baselineFps = sorted[Math.floor(sorted.length * 0.2)] || sorted[0];
            this._warmupComplete = true;
        }
    }

    /**
     * Получение реального FPS камеры (установленного через setCameraFps)
     */
    getCameraFps() {
        return this._cameraFps || 0;
    }

    /**
     * Получение текущего FPS
     */
    getCurrentFps() {
        return this._currentFps;
    }

    /**
     * Получение baseline FPS
     */
    getBaselineFps() {
        return this._baselineFps;
    }

    /**
     * Получение среднего FPS
     */
    getAverageFps() {
        if (this._fpsHistory.length === 0) return 0;
        return Math.round(this._fpsHistory.reduce((a, b) => a + b, 0) / this._fpsHistory.length);
    }

    /**
     * Проверка низкого FPS
     */
    isLowFps(factor = 0.5, absCap = 10, absFloor = 6) {
        if (!this._baselineFps || this._currentFps === 0) return false;
        const threshold = Math.max(absFloor, Math.min(absCap, this._baselineFps * factor));
        return this._currentFps < threshold;
    }

    /**
     * Получение истории FPS
     */
    getHistory() {
        return [...this._fpsHistory];
    }

    /**
     * Сброс
     */
    reset() {
        this.stop();
        this._lastFrameTime = 0;
        this._frameCount = 0;
        this._fpsHistory = [];
        this._currentFps = 0;
        this._cameraFps = 0;
        this._baselineFps = null;
        this._warmupComplete = false;
        this._lastVideoTime = 0;
        this._useVideoFrameCallback = false;
    }
}
