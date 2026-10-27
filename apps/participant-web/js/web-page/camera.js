import { state } from './state.js?v=20261025-1';
import { observeVideoFrames, measureVideoFps } from '../session-runtime/video-frames.mjs';

export function measureRenderFPS() {
    return new Promise(resolve => {
        let frames = 0;
        const started = performance.now();
        function loop(now) {
            frames++;
            if (now - started >= 500) resolve(Math.round(frames * 1000 / (now - started)));
            else requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    });
}

export const measureCameraFPS = measureVideoFps;
export const measureFPS = measureRenderFPS;
let observer = null, timer = null;

export function startCameraFpsMonitor(video) {
    if (state.cameraFpsState.isRunning) return;
    const fps = state.cameraFpsState;
    Object.assign(fps, { video, isRunning: true, frameCount: 0, currentFps: 0,
        lastTime: performance.now(), fpsHistory: [] });
    observer = observeVideoFrames(video, (_now, count) => { fps.frameCount += count; });
    fps.method = observer.method;
    timer = setInterval(() => {
        if (!fps.isRunning) return;
        const now = performance.now();
        fps.currentFps = Math.round(fps.frameCount * 1000 / (now - fps.lastTime));
        fps.method = observer.method;
        fps.fpsHistory.push(fps.currentFps);
        if (fps.fpsHistory.length > 30) fps.fpsHistory.shift();
        if (state.runtime.qcMetrics?.isRunning()) state.runtime.qcMetrics.setCameraFps(fps.currentFps);
        fps.frameCount = 0; fps.lastTime = now;
    }, 1000);
}

export function stopCameraFpsMonitor() {
    state.cameraFpsState.isRunning = false;
    observer?.stop(); observer = null;
    clearInterval(timer); timer = null;
    state.cameraFpsState.currentFps = 0;
}

export function getAverageCameraFps() {
    const history = state.cameraFpsState.fpsHistory;
    return history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : 0;
}
