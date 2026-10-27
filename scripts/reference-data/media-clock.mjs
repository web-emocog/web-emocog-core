// Only for finite-file replay, never a replacement for the live capture clock.
export async function prepareFiniteVideo(video) {
  const waitFor = (event, action) => new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); video.removeEventListener(event, ready); video.removeEventListener('error', failed);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('reference_video_prepare_failed'));
    const timer = setTimeout(() => finish(new Error('reference_video_prepare_deadline')), 10000);
    video.addEventListener(event, ready, { once: true }); video.addEventListener('error', failed, { once: true });
    try { action?.(); } catch (error) { finish(error); }
  });
  video.pause();
  if (video.readyState < 2) await waitFor('loadeddata');
  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.loop) throw new Error('invalid_reference_finite_video');
  // Reset decoder/preloaded-frame state before admitting callbacks. Never seek
  // or reset a timestamp after a measurement has been accepted.
  await waitFor('seeked', () => { video.currentTime = 0; });
  if (video.seeking || video.currentTime !== 0) throw new Error('reference_seek_did_not_reset');
}

export function nextMediaTimestamp(previous, metadata, playback) {
  const timestamp = metadata?.mediaTime * 1000 + 1; // Distinct from the model's timestamp-0 warmup.
  if (!Number.isFinite(metadata?.mediaTime) || metadata.mediaTime < 0
    || !Number.isFinite(timestamp) || (previous !== null && (!Number.isFinite(previous) || previous < 1))) {
    throw new Error('invalid_reference_media_clock');
  }
  if (playback?.seeking === true) throw new Error('reference_unexpected_seek');
  if (previous !== null && timestamp <= previous) {
    // A compositor may present an old frame again at EOF. Only an exact,
    // browser-confirmed terminal state permits ignoring it; never retime it.
    if (playback?.ended === true && Number.isFinite(playback.duration) && playback.duration > 0
      && playback.currentTime === playback.duration) return { kind: 'terminal_replay', timestamp: null };
    throw new Error('non_monotonic_video_pts');
  }
  return { kind: 'frame', timestamp };
}
