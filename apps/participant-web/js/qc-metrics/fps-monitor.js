import { VIDEO_ELEMENT_IDS } from './constants.js';
import { observeVideoFrames } from '../session-runtime/video-frames.mjs';

// Analysis throughput and camera delivery are independent measurements.
export class VideoFpsMonitor {
    constructor() { this._video = null; this.reset(); }

    findVideoElement(candidateIds = VIDEO_ELEMENT_IDS) {
        this._video = candidateIds.map(id => document.getElementById(id))
            .find(v => v?.tagName === 'VIDEO' && v.srcObject)
            || [...document.querySelectorAll('video')].find(v => v.srcObject) || null;
        return this._video;
    }

    setVideoElement(video) { this._video = video; }

    start(useRealFps = false) {
        this.reset();
        this._isRunning = true;
        this._startTime = this._lastFrameTime = performance.now();
        if (useRealFps && this._video) {
            let frames = 0, started = this._startTime;
            this._observer = observeVideoFrames(this._video, (_now, count) => { frames += count; });
            this.cameraMethod = this._observer.method;
            this._cameraTimer = setInterval(() => {
                const now = performance.now();
                this.cameraMethod = this._observer.method;
                this.setCameraFps(frames * 1000 / (now - started), {
                    frames, durationMs: now - started, method: this.cameraMethod
                });
                frames = 0; started = now;
            }, 1000);
        }
    }

    stop() {
        if (this._isRunning) this._stoppedAt = performance.now();
        this._isRunning = false;
        this._observer?.stop(); this._observer = null;
        clearInterval(this._cameraTimer); this._cameraTimer = null;
    }

    tick(warmupMs = 2000) {
        if (!this._isRunning) return this._currentFps;
        const now = performance.now();
        this._frameCount++;
        const elapsed = now - this._lastFrameTime;
        if (elapsed >= 1000) {
            this._currentFps = Math.round(this._frameCount * 1000 / elapsed);
            this._analysisWindow = { lastWindowFps: this._currentFps, method: 'completed-analysis-frames',
                frames: this._frameCount, durationMs: elapsed,
                startAfterMs: this._lastFrameTime - this._startTime, endAfterMs: now - this._startTime };
            this._fpsHistory.push(this._currentFps);
            if (this._fpsHistory.length > 60) this._fpsHistory.shift();
            this._frameCount = 0; this._lastFrameTime = now;
            if (!this._warmupComplete && now - this._startTime >= warmupMs && this._fpsHistory.length >= 2) {
                this._warmupComplete = true;
                const sorted = [...this._fpsHistory].sort((a, b) => b - a);
                this._baselineFps = sorted[Math.floor(sorted.length * .2)];
            }
        }
        return this._currentFps;
    }

    setCameraFps(fps, details = {}) {
        if (!Number.isFinite(fps) || fps < 0) return;
        this._cameraFps = fps;
        this._cameraUpdatedAt = performance.now();
        const durationMs = Number.isFinite(details.durationMs) && details.durationMs > 0 ? details.durationMs : null;
        const method = ['video-frame-callback', 'decoded-frame-counter', 'media-time-estimate',
            'video-callback-count'].includes(details.method)
            ? details.method : 'external-publication';
        this._cameraWindow = { lastWindowFps: fps, method,
            frames: Number.isSafeInteger(details.frames) && details.frames >= 0 ? details.frames : null,
            durationMs, startAfterMs: durationMs === null ? null : this._cameraUpdatedAt - this._startTime - durationMs,
            endAfterMs: this._cameraUpdatedAt - this._startTime };
    }

    // Legacy numeric getters retain their contract. New consumers can distinguish
    // an old window or absent measurement from an actual measured zero.
    getDiagnostics() {
        const now = this._stoppedAt ?? performance.now();
        const describe = window => {
            if (!window) return { status: 'no_data', fps: null, lastWindowFps: null, method: null,
                frames: null, durationMs: null, startAfterMs: null, endAfterMs: null, ageMs: null };
            const ageMs = Math.max(0, now - this._startTime - window.endAfterMs);
            const status = ageMs > 2500 ? 'stale' : 'measured';
            return { status, fps: status === 'measured' ? window.lastWindowFps : null, ...window, ageMs };
        };
        return { schemaVersion: 'fps_diagnostics.v1', scope: 'last_completed_window', running: this._isRunning,
            analysis: describe(this._analysisWindow), camera: describe(this._cameraWindow) };
    }

    getCameraFps() {
        return !this._isRunning || performance.now() - this._cameraUpdatedAt <= 2500 ? this._cameraFps : 0;
    }
    getCurrentFps() { return this._currentFps; }
    getBaselineFps() { return this._baselineFps; }
    getAverageFps() {
        return this._fpsHistory.length ? Math.round(this._fpsHistory.reduce((a, b) => a + b, 0) / this._fpsHistory.length) : 0;
    }
    isLowFps(factor = .5, absCap = 10, absFloor = 6, absoluteMin = 0) {
        const camera = this.getCameraFps();
        const fps = this._cameraUpdatedAt !== -Infinity && performance.now() - this._cameraUpdatedAt <= 2500
            ? camera : this._currentFps;
        if (fps === 0 && this._cameraUpdatedAt === -Infinity) return false;
        if (absoluteMin > 0 && fps < absoluteMin) return true;
        return this._baselineFps !== null && fps < Math.max(absFloor, Math.min(absCap, this._baselineFps * factor));
    }
    getHistory() { return [...this._fpsHistory]; }
    reset() {
        this.stop();
        this._lastFrameTime = 0; this._startTime = 0; this._frameCount = 0;
        this._fpsHistory = []; this._currentFps = 0; this._cameraFps = 0;
        this._cameraUpdatedAt = -Infinity; this._baselineFps = null; this._warmupComplete = false;
        this._analysisWindow = null; this._cameraWindow = null; this._stoppedAt = null;
        this.cameraMethod = null;
    }
}
