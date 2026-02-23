import { state } from './state.js';

export function measureRenderFPS() {
    return new Promise(resolve => {
        let frames = 0;
        let startTime = performance.now();
        function loop() {
            frames++;
            const now = performance.now();
            if (now - startTime >= 500) { 
                const fps = Math.round(frames * 2); 
                resolve(fps);
            } else {
                requestAnimationFrame(loop);
            }
        }
        requestAnimationFrame(loop);
    });
}

/**
 * Измеряет реальный FPS видеопотока камеры
 * @param {HTMLVideoElement} videoElement - элемент видео
 * @param {number} durationMs - длительность измерения в мс (по умолчанию 2000)
 * @returns {Promise<{fps: number, frames: number}>}
 */
export function measureCameraFPS(videoElement, durationMs = 2000) {
    return new Promise(resolve => {
        let frameCount = 0;
        let lastTime = 0;
        const startTime = performance.now();
        
        function checkFrame(currentTime) {
            // Проверяем, изменился ли кадр видео
            if (videoElement.currentTime !== lastTime) {
                frameCount++;
                lastTime = videoElement.currentTime;
            }
            
            if (performance.now() - startTime < durationMs) {
                requestAnimationFrame(checkFrame);
            } else {
                const elapsed = (performance.now() - startTime) / 1000;
                const fps = Math.round(frameCount / elapsed);
                resolve({ fps, frames: frameCount, duration: elapsed });
            }
        }
        
        requestAnimationFrame(checkFrame);
    });
}

// Для обратной совместимости
export function measureFPS() {
    return measureRenderFPS();
}

/**
 * Запускает мониторинг FPS камеры
 * @param {HTMLVideoElement} videoElement - элемент видео
 */
export function startCameraFpsMonitor(videoElement) {
    if (state.cameraFpsState.isRunning) return;
    
    state.cameraFpsState.video = videoElement;
    state.cameraFpsState.isRunning = true;
    state.cameraFpsState.frameCount = 0;
    state.cameraFpsState.lastTime = performance.now();
    state.cameraFpsState.fpsHistory = [];
    
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        console.log('[CameraFPS] Используем requestVideoFrameCallback');
        startVideoFrameCallback();
    } else {
        console.log('[CameraFPS] requestVideoFrameCallback не поддерживается, используем fallback');
        startFallbackFpsMonitor();
    }
}

/**
 * Останавливает мониторинг FPS камеры
 */
export function stopCameraFpsMonitor() {
    state.cameraFpsState.isRunning = false;
    
    if (state.cameraFpsState.videoFrameCallbackId != null) {
        if (state.cameraFpsState.video && state.cameraFpsState.video.cancelVideoFrameCallback) {
            // Основной путь: requestVideoFrameCallback
            state.cameraFpsState.video.cancelVideoFrameCallback(state.cameraFpsState.videoFrameCallbackId);
        } else {
            // Fallback: requestAnimationFrame
            cancelAnimationFrame(state.cameraFpsState.videoFrameCallbackId);
        }
        state.cameraFpsState.videoFrameCallbackId = null;
    }
}

/**
 * Возвращает средний FPS за время мониторинга
 */
export function getAverageCameraFps() {
    if (state.cameraFpsState.fpsHistory.length === 0) return 0;
    return Math.round(state.cameraFpsState.fpsHistory.reduce((a, b) => a + b, 0) / state.cameraFpsState.fpsHistory.length);
}

/**
 * Внутренняя функция: мониторинг через requestVideoFrameCallback
 */
function startVideoFrameCallback() {
    const onFrame = (now, metadata) => {
        if (!state.cameraFpsState.isRunning) return;
        
        state.cameraFpsState.frameCount++;
        
        // Вычисляем FPS каждую секунду
        const elapsed = now - state.cameraFpsState.lastTime;
        if (elapsed >= 1000) {
            state.cameraFpsState.currentFps = Math.round((state.cameraFpsState.frameCount * 1000) / elapsed);
            state.cameraFpsState.fpsHistory.push(state.cameraFpsState.currentFps);
            if (state.cameraFpsState.fpsHistory.length > 30) state.cameraFpsState.fpsHistory.shift();
            
            // Передаём FPS в QCMetrics
            if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
                state.runtime.qcMetrics.setCameraFps(state.cameraFpsState.currentFps);
            }
            
            state.cameraFpsState.frameCount = 0;
            state.cameraFpsState.lastTime = now;
        }
        
        // Запрашиваем следующий кадр
        state.cameraFpsState.videoFrameCallbackId = state.cameraFpsState.video.requestVideoFrameCallback(onFrame);
    };
    
    state.cameraFpsState.videoFrameCallbackId = state.cameraFpsState.video.requestVideoFrameCallback(onFrame);
}

/**
 * Внутренняя функция: fallback мониторинг через currentTime
 */
function startFallbackFpsMonitor() {
    let lastVideoTime = state.cameraFpsState.video.currentTime;
    let rafId = null;
    
    const checkFrame = () => {
        if (!state.cameraFpsState.isRunning) return;
        
        const now = performance.now();
        
        // Проверяем, изменился ли кадр видео
        if (state.cameraFpsState.video.currentTime !== lastVideoTime) {
            state.cameraFpsState.frameCount++;
            lastVideoTime = state.cameraFpsState.video.currentTime;
        }
        
        // Вычисляем FPS каждую секунду
        const elapsed = now - state.cameraFpsState.lastTime;
        if (elapsed >= 1000) {
            state.cameraFpsState.currentFps = Math.round((state.cameraFpsState.frameCount * 1000) / elapsed);
            state.cameraFpsState.fpsHistory.push(state.cameraFpsState.currentFps);
            if (state.cameraFpsState.fpsHistory.length > 30) state.cameraFpsState.fpsHistory.shift();
            
            // Передаём FPS в QCMetrics
            if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
                state.runtime.qcMetrics.setCameraFps(state.cameraFpsState.currentFps);
            }
            
            state.cameraFpsState.frameCount = 0;
            state.cameraFpsState.lastTime = now;
        }
        
        rafId = requestAnimationFrame(checkFrame);
    };
    
    rafId = requestAnimationFrame(checkFrame);
    
    // Сохраняем rafId для возможности остановки (через videoFrameCallbackId для унификации)
    state.cameraFpsState.videoFrameCallbackId = rafId;
}