export const GAZE_BENCHMARK_REVISION = '20261110-160';
export const GAZE_BENCHMARK_PROTOCOLS = Object.freeze(['spatial.v1', 'posture.v1', 'temporal.v1', 'aoi-continuous.v1', 'eye-gate.v1']);
const phases = ['setup', 'access', 'camera_permission', 'model_initialization', 'ready', 'calibration', 'correction', 'independent', 'spatial_before', 'interval',
  'spatial_after', 'pose_natural', 'pose_lowered', 'pose_returned', 'nuisance_reference', 'nuisance_alternate', 'nuisance_return',
  'aoi_instruction', 'aoi_running', 'eye_gate_reference', 'eye_gate_clicks', 'completed'];
const reasons = ['user_stop', 'page_hidden', 'viewport_changed', 'camera_resized', 'camera_ended',
  'access_denied', 'sensor_policy_denied', 'camera_denied', 'camera_unavailable', 'timeout',
  'model_unavailable', 'correction_coverage', 'benchmark_coverage', 'masked_calibration_coverage',
  'nuisance_anchor_coverage', 'nuisance_no_direction', 'appearance_gate_unavailable', 'geometry_anchor_overlap', 'geometry_gate_unavailable',
  'aoi_timing_overrun', 'aoi_geometry', 'calibration_retry_limit', 'calibration_failed', 'technical_error'];
const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const size = value => ({ width: finite(value?.width), height: finite(value?.height) });

// Parse only a coarse browser/OS group; never export UA, hardware identifiers or free text.
export function coarseEnvironment(ua = '') {
  const variants = [['edge', /Edg\/(\d+)/], ['firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['chrome', /(?:Chrome|CriOS)\/(\d+)/], ['safari', /Version\/(\d+).*Safari\//]];
  const browser = variants.find(([, pattern]) => pattern.test(ua));
  const platform = /iPhone|iPad|iPod/.test(ua) || /Macintosh.*Mobile/.test(ua) ? 'ios'
    : /Android/.test(ua) ? 'android' : /Macintosh|Mac OS X/.test(ua) ? 'macos'
    : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'unknown';
  return { browser: browser?.[0] || 'unknown', browserMajor: browser ? Number(ua.match(browser[1])[1]) : null, platform };
}

export function benchmarkFailureReason(error) {
  if (error?.status === 401 || error?.status === 403) return 'access_denied';
  const codes = { diagnostic_access_denied: 'access_denied', staff_account_changed: 'access_denied',
    diagnostic_sensor_policy_denied: 'sensor_policy_denied', diagnostic_timeout: 'timeout', request_timeout: 'timeout' };
  if (codes[error?.code]) return codes[error.code];
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'camera_denied';
  if (['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(error?.name)) return 'camera_unavailable';
  // Only our fixed internal stage codes, never an arbitrary exception message/stack.
  if (error?.message === 'deadline') return 'timeout';
  if (error?.message === 'model') return 'model_unavailable';
  if (['correction_coverage', 'benchmark_coverage', 'calibration_retry_limit', 'aoi_timing_overrun', 'aoi_geometry'].includes(error?.message)) return error.message;
  if (['calibration', 'model_calibration_disagreement'].includes(error?.message)) return 'calibration_failed';
  return 'technical_error';
}

export function benchmarkMetadata(input) {
  if (!GAZE_BENCHMARK_PROTOCOLS.includes(input.protocol)) throw new RangeError('Unknown benchmark protocol');
  return { revision: GAZE_BENCHMARK_REVISION, protocol: input.protocol,
    runId: typeof input.runId === 'string' && /^[a-f0-9-]{36}$/.test(input.runId) ? input.runId : null,
    completed: input.completed === true, reason: input.completed ? null : reasons.includes(input.reason) ? input.reason : 'technical_error',
    phase: phases.includes(input.phase) ? input.phase : 'setup', elapsedMs: finite(input.elapsedMs),
    environment: { ...coarseEnvironment(input.userAgent), viewport: size(input.viewport),
      camera: { ...size(input.camera), reportedFrameRate: finite(input.camera?.reportedFrameRate) },
      devicePixelRatio: finite(input.devicePixelRatio), viewportScale: finite(input.viewportScale),
      backend: ['worker', 'main', 'main-thread', 'synthetic_oracle'].includes(input.backend) ? input.backend : 'unknown' },
    counters: { completedCaptures: count(input.frameCount), frameErrors: count(input.frameErrors),
      calibrationAttempts: count(input.calibrationAttempts), calibrationAccepted: count(input.calibrationAccepted) },
    scope: 'standalone_shared_captures_not_full_protocol_or_accuracy_certification',
    offScreenSpecificityMeasured: false, transmission: 'manual_json_download_only',
    limitations: ['instructed_fixation_not_independent_eye_tracker_ground_truth',
      'posture_is_proxy_not_measured_pose', 'no_accuracy_observation_inside_temporal_interval',
      'random_run_id_does_not_identify_unique_people_or_devices'] };
}
