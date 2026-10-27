export function replayOptions(env = {}) {
  const browser = env.WECOG_REFERENCE_BROWSER || 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(browser)) throw new Error('invalid_reference_browser');
  const playbackRate = Number(env.WECOG_REFERENCE_PLAYBACK_RATE ?? '.5');
  if (![.5, 1].includes(playbackRate)) throw new Error('invalid_reference_playback_rate');
  const run = Number(env.WECOG_REFERENCE_RUN ?? '1');
  if (!Number.isSafeInteger(run) || run < 1 || run > 3) throw new Error('invalid_reference_run');
  const renderer = env.WECOG_REFERENCE_RENDERER || 'software';
  if (!['software', 'default'].includes(renderer)) throw new Error('invalid_reference_renderer');
  const headless = env.WECOG_REFERENCE_HEADLESS ?? '1';
  if (!['0', '1'].includes(headless)) throw new Error('invalid_reference_headless');
  const chromiumMode = env.WECOG_REFERENCE_CHROMIUM_MODE || 'shell';
  if (!['shell', 'browser'].includes(chromiumMode)
    || (browser !== 'chromium' && chromiumMode !== 'shell')) throw new Error('invalid_reference_chromium_mode');
  const segmentDelegate = env.WECOG_REFERENCE_SEGMENT_DELEGATE || 'default';
  if (!['default', 'GPU', 'CPU'].includes(segmentDelegate)) throw new Error('invalid_reference_segment_delegate');
  const workload = env.WECOG_REFERENCE_WORKLOAD || 'signals';
  if (!['signals', 'multimodal', 'source'].includes(workload)) throw new Error('invalid_reference_workload');
  const sourceInput = env.WECOG_REFERENCE_SOURCE_INPUT || 'file';
  if (!['file', 'canvas'].includes(sourceInput) || (sourceInput === 'canvas' && workload !== 'source')) {
    throw new Error('invalid_reference_source_input');
  }
  const faceDelegate = env.WECOG_REFERENCE_FACE_DELEGATE || 'default';
  if (!['default', 'CPU'].includes(faceDelegate)) throw new Error('invalid_reference_face_delegate');
  const faceInput = env.WECOG_REFERENCE_FACE_INPUT || 'bitmap';
  if (!['bitmap', 'imageData'].includes(faceInput)) throw new Error('invalid_reference_face_input');
  const faceOutputs = env.WECOG_REFERENCE_FACE_OUTPUTS || 'full';
  if (!['full', 'used'].includes(faceOutputs)) throw new Error('invalid_reference_face_outputs');
  const faceCanvas = env.WECOG_REFERENCE_FACE_CANVAS || 'default';
  if (!['default', 'compute'].includes(faceCanvas)) throw new Error('invalid_reference_face_canvas');
  const dispatch = env.WECOG_REFERENCE_DISPATCH || 'timer';
  if (!['timer', 'frame-ready', 'frame-deadline'].includes(dispatch)) throw new Error('invalid_reference_dispatch');
  const glProfile = env.WECOG_REFERENCE_GL_PROFILE ?? '0';
  if (!['0', '1'].includes(glProfile)) throw new Error('invalid_reference_gl_profile');
  const requirePerformance = env.WECOG_REFERENCE_REQUIRE_PERFORMANCE ?? '0';
  if (!['0', '1'].includes(requirePerformance)) throw new Error('invalid_reference_performance_gate');
  if (glProfile === '1' && requirePerformance === '1') throw new Error('invalid_reference_profile_performance_gate');
  if (workload === 'source' && (playbackRate !== 1 || glProfile === '1' || requirePerformance === '1')) {
    throw new Error('invalid_reference_source_probe_configuration');
  }
  return { browser, playbackRate, run, renderer, headless: headless === '1', chromiumMode, segmentDelegate, workload, sourceInput, faceDelegate, faceInput, faceOutputs, faceCanvas, dispatch,
    glProfile: glProfile === '1', requirePerformance: requirePerformance === '1' };
}
