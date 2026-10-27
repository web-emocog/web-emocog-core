// A media clock is not a frame counter (notably in Safari).
export function observeVideoFrames(video, onFrame) {
    let active = true, id = null, previous = null;
    const started = performance.now();
    let lastCounterProgress = started;
    let lastMediaTime = video?.currentTime;
    const native = typeof video?.requestVideoFrameCallback === 'function';
    const quality = typeof video?.getVideoPlaybackQuality === 'function';
    let method = native ? 'video-frame-callback' : quality ? 'decoded-frame-counter' : 'media-time-estimate';
    const loop = (now, metadata) => {
        if (!active) return;
        let counter = native ? metadata?.presentedFrames
            : method === 'decoded-frame-counter' ? video.getVideoPlaybackQuality().totalVideoFrames : video.currentTime;
        // Some older engines expose an inert playback counter for MediaStream.
        // Preserve their legacy path, but never label it an exact frame count.
        if (method === 'decoded-frame-counter' && (counter === previous || !Number.isFinite(counter))
            && now - lastCounterProgress >= 1000 && video.currentTime !== lastMediaTime) {
            method = 'media-time-estimate'; previous = lastMediaTime; counter = video.currentTime;
        }
        if (Number.isFinite(counter) && counter !== previous && video.readyState >= 2) {
            const delta = !Number.isFinite(previous) || counter < previous || method === 'media-time-estimate'
                ? 1 : Math.max(1, counter - previous);
            previous = counter;
            lastCounterProgress = now;
            onFrame(now, delta, method);
        }
        lastMediaTime = video.currentTime;
        if (active) id = native ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    if (!native) previous = quality ? video.getVideoPlaybackQuality().totalVideoFrames : video?.currentTime;
    id = native ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    return { get method() { return method; }, stop() {
        active = false;
        if (native) video.cancelVideoFrameCallback?.(id);
        else cancelAnimationFrame(id);
    } };
}

export function measureVideoFps(video, durationMs = 2000) {
    return new Promise(resolve => {
        const started = performance.now();
        let frames = 0;
        const observer = observeVideoFrames(video, (_now, count) => { frames += count; });
        setTimeout(() => {
            observer.stop();
            const duration = (performance.now() - started) / 1000;
            resolve({ fps: Math.round(frames / duration), frames, duration, method: observer.method });
        }, Math.max(1, durationMs));
    });
}
