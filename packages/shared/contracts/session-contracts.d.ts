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
  modules?: Record<'gaze' | 'blinks' | 'rt' | 'bpm' | 'emotion' | 'bodyPose', string>;
}

export interface SessionFeatureV1 {
  schemaVersion: 'session_feature.v1';
  ids: {
    session: string;
    participant?: string | null;
    invitationCode?: string | null;
  };
  lifecycle: SessionLifecycleV1;
  events: SessionEventV1[];
  meta?: Record<string, unknown> | null;
  precheck?: Record<string, unknown> | null;
  qcSummary?: Record<string, unknown> | null;
  attentionMetrics?: Record<string, unknown> | null;
  blink_summary?: Record<string, unknown> | null;
  perclos_summary?: Record<string, unknown> | null;
  body_pose_summary?: Record<string, unknown> | null;
  emotion_summary?: Record<string, unknown> | null;
  bpm_summary?: Record<string, unknown> | null;
  rppg_summary?: Record<string, unknown> | null;
  respiration_summary?: Record<string, unknown> | null;
  experimentMeta?: Record<string, unknown> | null;
  blocks?: Array<Record<string, unknown>>;
  cognitiveResults?: Array<Record<string, unknown>>;
  gazeValidation?: Record<string, unknown> | null;
  gaze_analytics?: Record<string, unknown> | null;
  startTime?: number | string | null;
  testHub?: Record<string, unknown> | null;
  gazeTests?: Record<string, unknown> | null;
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
