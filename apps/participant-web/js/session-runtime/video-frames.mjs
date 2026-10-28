// A media clock is not a frame counter (notably in Safari).
export function observeVideoFrames(video, onFrame) {
    let active = true, id = null, previous = null;
    const started = performance.now();
    let lastCounterProgress = started;
    let lastMediaTime = video?.currentTime;
    const native = typeof video?.requestVideoFrameCallback === 'function';
    const quality = typeof video?.getVideoPlaybackQuality === 'function';
    // Some file decoders inflate presentedFrames across loops/replay. Do not
    // apply playback-quality counters to MediaStream: they can be inert there.
    const playbackFile = native && quality && !video?.srcObject && Boolean(video?.currentSrc || video?.src);
    let previousDropped = null, droppedFrames = 0, fileFrames = 0, counterResets = 0, notifications = 0;
    function fileFramesCounter() {
        try {
            const { totalVideoFrames: total, droppedVideoFrames: dropped } = video.getVideoPlaybackQuality();
            if (!Number.isSafeInteger(total) || !Number.isSafeInteger(dropped)
                || total < 0 || dropped < 0 || dropped > total) return null;
            if (previousDropped !== null) {
                if (dropped >= previousDropped) droppedFrames += dropped - previousDropped;
                else if (Number.isFinite(previous) && total >= previous) counterResets++;
            }
            previousDropped = dropped;
            return total;
        } catch (_) { return null; }
    }
    let method = playbackFile ? 'decoded-frame-counter'
        : native ? 'video-frame-callback' : quality ? 'decoded-frame-counter' : 'media-time-estimate';
    let fallbackReason = null;
    if (playbackFile) previous = fileFramesCounter();
    const loop = (now, metadata) => {
        if (!active) return;
        if (native) notifications++;
        let counter = playbackFile && method === 'decoded-frame-counter' ? fileFramesCounter()
            : native ? metadata?.presentedFrames
            : method === 'decoded-frame-counter' ? video.getVideoPlaybackQuality().totalVideoFrames : video.currentTime;
        if (playbackFile && method === 'decoded-frame-counter' && (!Number.isFinite(counter)
            || (counter === previous && now - lastCounterProgress >= 1000 && video.currentTime !== lastMediaTime))) {
            fallbackReason = Number.isFinite(counter) ? 'playback_counter_stalled' : 'playback_counter_unavailable';
            method = 'video-callback-count'; previous = null; counter = metadata?.presentedFrames;
        }
        if (method === 'video-callback-count') counter = notifications;
        // Some older engines expose an inert playback counter for MediaStream.
        // Preserve their legacy path, but never label it an exact frame count.
        if (!native && method === 'decoded-frame-counter' && (counter === previous || !Number.isFinite(counter))
            && now - lastCounterProgress >= 1000 && video.currentTime !== lastMediaTime) {
            method = 'media-time-estimate'; previous = lastMediaTime; counter = video.currentTime;
        }
        if (Number.isFinite(counter) && counter !== previous && video.readyState >= 2) {
            if (playbackFile && Number.isFinite(previous) && counter < previous) counterResets++;
            const delta = !Number.isFinite(previous) || counter < previous
                || method === 'media-time-estimate' || method === 'video-callback-count'
                ? 1 : Math.max(1, counter - previous);
            previous = counter;
            lastCounterProgress = now;
            if (playbackFile) fileFrames += delta;
            onFrame(now, delta, method);
        }
        lastMediaTime = video.currentTime;
        if (active) id = native ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    if (!native) previous = quality ? video.getVideoPlaybackQuality().totalVideoFrames : video?.currentTime;
    id = native ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    return { get method() { return method; }, get fallbackReason() { return fallbackReason; },
        get playbackQuality() {
            if (!playbackFile) return null;
            const complete = !fallbackReason && counterResets === 0 && fileFrames >= droppedFrames;
            return { complete, counterResets, droppedFrames: complete ? droppedFrames : null,
                displayedFrames: complete ? Math.max(0, fileFrames - droppedFrames) : null };
        }, stop() {
        active = false;
        if (native) video.cancelVideoFrameCallback?.(id);
        else cancelAnimationFrame(id);
    } };
}

export function measureVideoFps(video, durationMs = 2000) {
    if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 2147483647) {
        return Promise.reject(new RangeError('Invalid FPS sampling duration'));
    }
    return new Promise(resolve => {
        const started = performance.now();
        let frames = 0;
        const observer = observeVideoFrames(video, (_now, count) => { frames += count; });
        setTimeout(() => {
            observer.stop();
            const duration = (performance.now() - started) / 1000;
            resolve({ fps: Math.round(frames / duration), frames, duration, method: observer.method,
                measurementVersion: 'video_cadence.v2', fallbackReason: observer.fallbackReason,
                playbackQuality: observer.playbackQuality });
        }, durationMs);
    });
}
