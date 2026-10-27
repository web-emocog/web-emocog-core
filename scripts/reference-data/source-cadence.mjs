import { distribution } from './performance.mjs';
import { nextMediaTimestamp, prepareFiniteVideo } from './media-clock.mjs';

// A camera-free live-stream control. It tests browser delivery, not a camera driver.
export async function measureSyntheticSourceCadence(video, durationMs = 20000) {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
  if (typeof canvas.captureStream !== 'function') throw new Error('source_probe_capture_stream_unavailable');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('source_probe_canvas_unavailable');
  let stream = null, timer = null, counter = 0;
  const producerStarted = performance.now(), drawIntervals = [];
  let lastDrawAt = null;
  const draw = () => {
    const now = performance.now();
    if (lastDrawAt !== null && drawIntervals.length < 20000) drawIntervals.push(now - lastDrawAt);
    lastDrawAt = now;
    context.fillStyle = counter++ % 2 ? '#222' : '#ddd';
    context.fillRect(0, 0, canvas.width, canvas.height);
  };
  try {
    draw(); stream = canvas.captureStream(30);
    video.removeAttribute('src'); video.srcObject = stream;
    timer = setInterval(draw, 1000 / 30);
    const result = await measureSourceCadence(video, durationMs, 'stream');
    const producerElapsedMs = performance.now() - producerStarted;
    return { ...result, sourceInput: 'synthetic_canvas_stream',
      nominalFps: 30, width: canvas.width, height: canvas.height,
      producer: { drawCalls: counter, elapsedIncludingPlayMs: producerElapsedMs,
        drawFpsIncludingPlay: counter * 1000 / producerElapsedMs, drawIntervalsMs: distribution(drawIntervals) },
      interpretation: 'synthetic_live_stream_delivery_not_physical_camera_or_analysis_fps' };
  } finally {
    clearInterval(timer); video.pause(); video.srcObject = null;
    stream?.getTracks().forEach(track => track.stop());
  }
}

// Decoder/compositor control: no model, pixel readback or physiological output.
export async function measureSourceCadence(video, durationMs = 20000, sourceType = 'file') {
  if (!Number.isFinite(durationMs) || durationMs < 50 || durationMs > 60000) {
    throw new Error('invalid_source_probe_duration');
  }
  if (!['file', 'stream'].includes(sourceType)) throw new Error('invalid_source_probe_type');
  let frameId = null, animationId = null, timer = null, playTimer = null;
  let callbacks = 0, presented = 0, animationFrames = 0, previousCount = null;
  let previousPts = null, previousCallback = null, previousAnimation = null;
  const callbackIntervals = [], animationIntervals = [];
  const mediaClock = { policy: sourceType === 'file' ? 'strict_finite_pts' : 'observe_stream_pts_without_retiming',
    increasing: 0, repeated: 0, backwards: 0, missing: 0 };
  const append = (values, value) => {
    if (values.length >= 20000) throw new Error('source_probe_sample_limit');
    values.push(value);
  };
  try {
    if (sourceType === 'file') await prepareFiniteVideo(video);
    await Promise.race([video.play(), new Promise((_, reject) => {
      playTimer = setTimeout(() => reject(new Error('source_probe_play_deadline')), 10000);
    })]);
    clearTimeout(playTimer);
    const started = performance.now();
    let terminalFrameReplays = 0;
    const stopReason = await new Promise((resolve, reject) => {
      let done = false;
      const finish = (reason, error) => {
        if (done) return;
        done = true;
        if (error) reject(error); else resolve(reason);
      };
      video.onended = () => finish('ended');
      video.onerror = () => finish(null, new Error('source_probe_decode_failed'));
      const onFrame = (_now, metadata) => {
        if (done) return;
        try {
          if (sourceType === 'file') {
            const step = nextMediaTimestamp(previousPts, metadata, video);
            if (step.kind === 'terminal_replay') { terminalFrameReplays++; finish('ended'); return; }
            previousPts = step.timestamp; mediaClock.increasing++;
          } else {
            // This control counts delivery callbacks, not valid signal samples.
            // Safari streams can repeat mediaTime: expose that, never invent PTS.
            const pts = metadata?.mediaTime;
            if (!Number.isFinite(pts) || pts < 0) mediaClock.missing++;
            else {
              if (previousPts === null || pts > previousPts) mediaClock.increasing++;
              else if (pts === previousPts) mediaClock.repeated++;
              else mediaClock.backwards++;
              previousPts = pts;
            }
          }
          const count = metadata.presentedFrames;
          if (!Number.isSafeInteger(count) || count < 1 || (previousCount !== null && count <= previousCount)) {
            throw new Error('source_probe_invalid_frame_counter');
          }
          const now = performance.now();
          if (previousCallback !== null) append(callbackIntervals, now - previousCallback);
          presented += previousCount === null ? 1 : count - previousCount;
          previousCount = count; previousCallback = now; callbacks++;
          frameId = video.requestVideoFrameCallback(onFrame);
        } catch (error) { finish(null, error); }
      };
      const onAnimation = now => {
        if (done) return;
        try {
          if (previousAnimation !== null) append(animationIntervals, now - previousAnimation);
          previousAnimation = now; animationFrames++;
          animationId = requestAnimationFrame(onAnimation);
        } catch (error) { finish(null, error); }
      };
      frameId = video.requestVideoFrameCallback(onFrame);
      animationId = requestAnimationFrame(onAnimation);
      timer = setTimeout(() => finish('duration'), durationMs);
    });
    const elapsedMs = performance.now() - started;
    return { kind: 'source-cadence', elapsedMs, stopReason, callbacks, presented, animationFrames,
      callbackFps: callbacks * 1000 / elapsedMs, presentedFps: presented * 1000 / elapsedMs,
      animationFps: animationFrames * 1000 / elapsedMs, visibility: document.visibilityState,
      callbackIntervalsMs: distribution(callbackIntervals), animationIntervalsMs: distribution(animationIntervals),
      mediaClock, terminalFrameReplays, modelsRun: false, accuracyValidated: false,
      interpretation: sourceType === 'file' ? 'finite_file_decoder_compositor_control_not_camera_or_analysis_fps'
        : 'stream_delivery_control_not_physical_camera_or_analysis_fps' };
  } finally {
    clearTimeout(timer); clearTimeout(playTimer);
    if (frameId !== null) video.cancelVideoFrameCallback(frameId);
    if (animationId !== null) cancelAnimationFrame(animationId);
    video.onended = null; video.onerror = null; video.pause();
  }
}
