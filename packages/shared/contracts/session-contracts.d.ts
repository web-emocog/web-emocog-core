export type SessionState =
  | 'idle'
  | 'starting'
  | 'instruction'
  | 'running'
  | 'paused'
  | 'quality_error'
  | 'technical_error'
  | 'finishing'
  | 'completed'
  | 'failed';

export interface SessionDeliveryV1 {
  schemaVersion: 'session_delivery.v1';
  sequence: number;
  kind: 'checkpoint' | 'final';
}

export type SessionEventCategory =
  | 'lifecycle'
  | 'quality'
  | 'technical'
  | 'block'
  | 'input'
  | 'upload'
  | 'module';

export interface SessionEventV1 {
  schemaVersion: 'session_event.v1';
  eventId: string;
  sessionId: string | null;
  type: string;
  category: SessionEventCategory;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  phase: string | null;
  timestamp: number;
  tRelMs: number | null;
  blockId: string | number | null;
  trialId: string | number | null;
  startTimestamp?: number | null;
  endTimestamp?: number | null;
  sampleCoverage?: 'not_inferred' | null;
  modules?: SessionModule[] | Partial<Record<SessionModule, string | null>> | null;
  [key: string]: unknown;
}

export interface SessionLifecycleV1 {
  schemaVersion: 'session_lifecycle.v1';
  state: SessionState;
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: number | string | null;
  lastTransitionAt: number | string | null;
  completedAt: number | string | null;
  finishAttemptId?: string | null;
  currentBlock: Record<string, unknown> | null;
  repeatQueue: Array<Record<string, unknown>>;
  activeIssues: Array<Record<string, unknown>>;
  modules?: Record<
    'gaze' | 'blinks' | 'rt' | 'bpm' | 'emotion' | 'bodyPose' | 'audio' | 'multimodal',
    string
  >;
}

export interface RtAlignmentMetricV1 {
  value: number | null;
  n: number;
  nValid: number;
  validFraction: number | null;
  maxGapMs: number | null;
  status: 'observed' | 'no_data';
}

export interface RtAlignmentWindowV1 {
  startMs: number | null;
  endMs: number | null;
  channels: Record<'gaze' | 'body' | 'valence' | 'arousal' | 'bpm', RtAlignmentMetricV1>
    & { respiration?: RtAlignmentMetricV1 };
}

export interface PhysiologyIntervalChannel {
  mean: number | null;
  count: number;
  observedMs: number;
  methodVersion?: string;
}

export interface PhysiologyInterval {
  startMs: number;
  endMs: number;
  heartRate: PhysiologyIntervalChannel;
  respiration: PhysiologyIntervalChannel;
}

export interface PhysiologyIntervalsV1 {
  schemaVersion: 'physiology_intervals.v1';
  throughMs: number;
  truncated: boolean;
  minutes: PhysiologyInterval[];
  blocks: (PhysiologyInterval & {
    blockId: string;
    attempt: number;
    status: 'accepted' | 'repeat_required' | 'interrupted' | 'in_progress';
  })[];
}

export interface RtAlignmentV1 {
  schemaVersion: 'rt_alignment.v1';
  algorithmVersion: 'event-windows-1.0.0' | 'event-windows-1.1.0';
  clock: 'monotonic_epoch_ms' | 'wall_epoch_ms';
  baselineMs: 1000;
  postMs: 1000;
  trialCountTotal: number;
  truncated: boolean;
  rawVideoStored: false;
  trials: Array<{
    trialId: string | null;
    blockId: string | null;
    stimulusId: string | null;
    condition: string | null;
    attempt: number;
    onsetMs: number | null;
    responseMs: number | null;
    endMs: number | null;
    rtMs: number | null;
    correct: boolean | null;
    qualityValid: boolean;
    status: 'responded' | 'no_response' | 'incomplete';
    windows: Record<'baseline' | 'response' | 'post', RtAlignmentWindowV1>;
  }>;
}

export type SessionModule = 'gaze' | 'blinks' | 'rt' | 'bpm' | 'emotion' | 'bodyPose' | 'audio' | 'multimodal';

export interface AnalysisCadenceSummary {
  frames: number;
  windows: number;
  observedMs: number;
  meanFps: number | null;
  threshold: number | null;
  belowThresholdMs: number | null;
}

export interface GazeValidationMetrics extends Record<string, unknown> {
  validSamples?: number | null;
  totalSamples?: number | null;
  validPct?: number | string | null;
  screenDiag?: number | null;
  screenSize?: { width?: number | null; height?: number | null } | null;
}

export interface GazeValidationSummary extends Record<string, unknown> {
  metrics?: GazeValidationMetrics | null;
  rawMetrics?: GazeValidationMetrics | null;
  displayMetrics?: GazeValidationMetrics | null;
  correctedCandidateMetrics?: GazeValidationMetrics | null;
  samplingVersion?: 'unique_capture.v1';
  sampling?: Array<{
    version: 'unique_capture.v1'; stage: 'correction' | 'benchmark'; pointIndex: number;
    clock: 'monotonic' | 'wall' | null; attempted: number; accepted: number;
    duplicate: number; beforeWindow: number; missingTimestamp: number; clockChanged: number;
  }>;
  coverage?: {
    version: 'target_coverage.v1'; expectedTargets: 5; observedTargets: number;
    missingTargetIndices: number[]; complete: boolean;
  };
}

/** All times are integer milliseconds relative to this presentation's onset. */
export interface PassiveValidTimeV1 {
  schemaVersion: 'passive_valid_time.v1';
  targetMs: number;
  acceptedMs: number;
  actualMs: number;
  maxDurationMs: number;
  extended: boolean;
  limitReached: boolean;
  acceptedSegments: Array<{ startMs: number; endMs: number }>;
  excludedSegments: Array<{ startMs: number; endMs: number; reasons: string[] }>;
}

export interface CognitiveResultV1 {
  trialId?: string | number | null;
  presentationId?: string | number | null;
  block?: string | number | null;
  blockId?: string | number | null;
  stimulusId?: string | number | null;
  presentationIndex?: number | null;
  onsetMs?: number | null;
  rt?: number | null;
  attempt?: number | null;
  decisionTimestampMs?: number | null;
  sourceTrialIndex?: number | null;
  repeatSequenceIndex?: number | null;
  timestamp?: number | null;
  task_id?: string | number | null;
  stimulusType?: string | number | null;
  expectedResponse?: string | number | null;
  condition?: string | number | null;
  response?: string | number | null;
  responseMode?: string | number | null;
  inputType?: string | number | null;
  correct?: boolean | null;
  qualityValid?: boolean | null;
  skippedMedia?: boolean | null;
  pointerSummary?: Record<string, unknown> | null;
  qualityIssueCodes?: Array<string | null>;
  qualityIssues?: Array<Record<string, unknown> | null>;
  validTime?: PassiveValidTimeV1;
  invalidationReason?: 'page_reloaded';
}

export interface FrameLatencyV1 {
  schemaVersion: 'frame_latency.v1';
  scope: 'completed_primary_frames';
  primary: { samples: number; meanMs: number | null; p95Ms: number | null; p99Ms: number | null; maxMs: number | null };
  headroom: 'not_measured' | 'within_budget' | 'over_budget';
}

export interface FrameTimingV1 { frames: number; totalMs: number; maxMs: number }

export interface SessionFeatureV1 {
  delivery?: SessionDeliveryV1;
  schemaVersion: 'session_feature.v1';
  ids: {
    session: string;
    participant?: string | null;
    participantAlias?: string | null;
    invitationCode?: string | null;
  };
  lifecycle: SessionLifecycleV1;
  events: SessionEventV1[];
  meta?: (Record<string, unknown> & {
    tech?: (Record<string, unknown> & { gazeFeatureMethod?: 'same_eye_iris.v2'; gazeCalibrationSampling?: 'open_eye_calibration.v1'; gazeQcSignalMethod?: 'corrected_validity.v1';
      framePipeline?: Record<string, unknown> & { latency?: FrameLatencyV1; faceTimings?: Partial<Record<
        'modelCallMs' | 'bitmapCaptureMs' | 'workerRoundTripMs' | 'workerWorkMs' | 'pixelDrawMs' | 'pixelReadMs' | 'derivedMs', FrameTimingV1>> }
    }) | null;
  }) | null;
  precheck?: Record<string, unknown> | null;
  qcSummary?: (Record<string, unknown> & {
    continuity?: { schemaVersion: 'qc_continuity.v1'; segmentCount: number; historyComplete: boolean };
    fpsDiagnostics?: (Record<string, unknown> & { analysisSession?: AnalysisCadenceSummary }) | null;
  }) | null;
  attentionMetrics?: Record<string, unknown> | null;
  blink_summary?: Record<string, unknown> | null;
  perclos_summary?: Record<string, unknown> | null;
  body_pose_summary?: Record<string, unknown> | null;
  audio_summary?: Record<string, unknown> | null;
  multimodal_summary?: Record<string, unknown> | null;
  multimodal_heatmap?: Record<string, unknown> | null;
  emotion_summary?: Record<string, unknown> | null;
  bpm_summary?: Record<string, unknown> | null;
  rppg_summary?: Record<string, unknown> | null;
  respiration_summary?: Record<string, unknown> | null;
  experimentMeta?: (Record<string, unknown> & { backupScope?: 'light_summary_without_signal_series' }) | null;
  blocks?: Array<Record<string, unknown>>;
  cognitiveResults?: Array<CognitiveResultV1 | null>;
  gazeValidation?: GazeValidationSummary | null;
  gaze_analytics?: {
    schemaVersion: 'gaze_analytics.v1';
    coordinateSpace: 'stimulus_normalized_0_1';
    summary: Record<string, unknown>;
    presentations: Array<Record<string, unknown> & { presentationStartMs?: number | null }>;
  } | null;
  rt_alignment?: RtAlignmentV1;
  physiology_intervals?: PhysiologyIntervalsV1;
  quality_assessment?: MetricQualityV1;
  startTime?: number | string | null;
  testHub?: Record<string, unknown> | null;
  gazeTests?: Record<string, unknown> | null;
}

export interface MetricQualityV1 {
  schemaVersion: 'metric_quality.v1';
  recordingIntegrity: { status: 'complete' | 'partial' | 'unknown'; storage: 'local_prepared' | 'server_acknowledged'; reasons: string[] };
  protocolQuality: 'passed' | 'failed' | 'unknown';
  signals: Array<{ channel: string; status: 'available' | 'missing' | 'unknown'; sampleCount: number | null;
    coverageFraction: number | null; observedMs: number | null; methodVersion: string | null; reasons: string[] }>;
  suitability: Array<{ channel: string; status: 'research_only' | 'unavailable'; reasons: string[] }>;
  limits: Array<{ code: string; scope: string; limit: number; total: number | null; retained: number | null; truncated: boolean }>;
  independentlyValidated: false;
}

export interface IngestSessionFeatureResponseV1 {
  session_id: string;
  ingested: true;
  idempotent: boolean;
  idempotency_key: string | null;
  lifecycle_status: 'in_progress' | 'completed';
  completed_at: string | null;
  qc_validity: string | null;
  proxy_ready: boolean;
}
