/**
 * Data Ingestion для агрегатов (Фаза 2.5).
 * POST /ingest — приём payload из buildAggregatesPayload.
 * PII and fields outside the typed allowlist are rejected before DB access.
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db');
const config = require('../config');
const {
  authenticateBearerHeader,
  canRolePerform,
  OPERATIONS,
  requireAuth,
  resolveCurrentStaffPrincipal,
  hasProjectMembership,
} = require('../security/permissions');
const {
  verifyIngestToken,
  verifyParticipantIngestRequest,
} = require('../security/ingest-token');
const { computeQcValidity, mergeBehavioralRtQc } = require('../qc/aggregator');
const {
  computeSessionRtFeatures,
  mergeRtIntoProxyScalars,
  buildProxyMetricsJson,
} = require('../rt/compute');
const {
  resolveIdempotencyKey,
  getIngestSuccessStatus,
  resolveExistingFinish,
  requireFinishIdempotencyKey,
} = require('../ingest/idempotency');
const {
  findInvitationByCode,
  reserveInvitationRun,
} = require('../ingest/invitation-repository');
const { withTransaction, lockSessionKey } = require('../db/transaction');
const { HttpError } = require('../security/http-error');
const { requireSessionFeaturePayload } = require('../security/payload-policy');

const router = express.Router();

function toFiniteNumber(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function deriveBlocksFromCognitiveResults(cognitiveResults, existingBlocks) {
  const rows = Array.isArray(cognitiveResults) ? cognitiveResults : [];
  if (!rows.length) return Array.isArray(existingBlocks) ? existingBlocks : [];

  const byBlock = new Map();
  rows.forEach((r) => {
    const blockId = r && r.blockId != null ? String(r.blockId) : null;
    if (!blockId) return;
    if (!byBlock.has(blockId)) byBlock.set(blockId, []);
    byBlock.get(blockId).push(r);
  });

  const existing = Array.isArray(existingBlocks) ? existingBlocks : [];
  const existingByName = new Map(existing.map(b => [String(b?.name || ''), b]));

  const derived = [];
  for (const [blockId, trials] of byBlock.entries()) {
    const rtVals = trials.map(t => t && t.rt).filter(v => typeof v === 'number' && Number.isFinite(v));
    const omissionsCount = trials.filter(t => !t || t.response == null).length;
    const omissions = trials.length > 0 ? (omissionsCount / trials.length) * 100 : null;
    const rt = rtVals.length ? rtVals.reduce((a, b) => a + b, 0) / rtVals.length : null;

    const prev = existingByName.get(blockId) || null;
    derived.push({
      name: blockId,
      attention: toFiniteNumber(prev && prev.attention),
      arousal: toFiniteNumber(prev && prev.arousal),
      valence: toFiniteNumber(prev && prev.valence),
      blinks: toFiniteNumber(prev && prev.blinks),
      rt: rt != null ? Math.round(rt) : null,
      omissions: omissions != null ? Math.round(omissions * 100) / 100 : null,
    });
  }

  return derived;
}

function normalizeDerivedPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  const cognitiveResults = Array.isArray(out.cognitiveResults) ? out.cognitiveResults : [];
  const blocks = Array.isArray(out.blocks) ? out.blocks : [];

  if (!blocks.length && cognitiveResults.length) {
    out.blocks = deriveBlocksFromCognitiveResults(cognitiveResults, blocks);
    return out;
  }

  if (blocks.length && cognitiveResults.length) {
    const derived = deriveBlocksFromCognitiveResults(cognitiveResults, blocks);
    const byName = new Map(derived.map(b => [String(b.name), b]));
    out.blocks = blocks.map((b, idx) => {
      const name = b && b.name ? String(b.name) : `Block_${idx + 1}`;
      const d = byName.get(name);
      if (!d) return b;
      return {
        ...b,
        rt: b.rt == null ? d.rt : b.rt,
        omissions: b.omissions == null ? d.omissions : b.omissions,
      };
    });
  }

  return out;
}

function toFinite(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function average(values) {
  const nums = (Array.isArray(values) ? values : []).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function roundTo(v, digits) {
  const n = toFinite(v);
  if (n == null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function to01(value, maxScale) {
  const v = toFinite(value);
  if (v == null) return null;
  if (maxScale === 1) return clamp(v, 0, 1);
  if (maxScale === 100) return clamp(v / 100, 0, 1);
  return null;
}

function extractRespirationMetrics(payload) {
  const rs = payload && payload.respiration_summary;
  if (!rs || typeof rs !== 'object') {
    return {
      respiration_rate_mean: null,
      respiration_rate_min: null,
      respiration_rate_max: null,
      respiration_sample_count: 0,
      respiration_available: false,
    };
  }

  const sampleCountRaw = rs.resp_sample_count;
  const respiration_sample_count = (typeof sampleCountRaw === 'number' && Number.isFinite(sampleCountRaw))
    ? Math.max(0, Math.round(sampleCountRaw))
    : 0;

  return {
    respiration_rate_mean: roundTo(toFinite(rs.resp_rate_mean), 2),
    respiration_rate_min: roundTo(toFinite(rs.resp_rate_min), 2),
    respiration_rate_max: roundTo(toFinite(rs.resp_rate_max), 2),
    respiration_sample_count,
    respiration_available: Boolean(rs.resp_available),
  };
}

function extractProxyMetrics(payload, qcSummary, qcComputed) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const respiration = extractRespirationMetrics(p);
  const blocks = Array.isArray(p.blocks) ? p.blocks.filter(b => b && typeof b === 'object') : [];
  const cognitiveRows = Array.isArray(p.cognitiveResults) ? p.cognitiveResults : [];

  const emotionValence = toFinite(p.emotion_summary && p.emotion_summary.valence_mean);
  const emotionArousal = toFinite(p.emotion_summary && p.emotion_summary.arousal_mean);

  const attGlobal = p.attentionMetrics && p.attentionMetrics.global && typeof p.attentionMetrics.global === 'object'
    ? p.attentionMetrics.global
    : {};
  const attentionScore = (() => {
    const direct = toFinite(attGlobal.attentionScore) ??
      toFinite(attGlobal.focusScore) ??
      toFinite(attGlobal.attention) ??
      toFinite(attGlobal.attentionPct);
    if (direct != null) return direct;
    const fallback = average(blocks.map(b => toFinite(b.attention)));
    return fallback != null ? roundTo(fallback, 2) : null;
  })();

  const meanRtFromBlocks = average(blocks.map(b => toFinite(b.rt)));
  const meanRtFromTrials = average(cognitiveRows.map(r => toFinite(r && r.rt)));
  const meanRtMs = roundTo(meanRtFromBlocks ?? meanRtFromTrials, 2);

  const omissionsFromBlocks = average(blocks.map(b => toFinite(b.omissions)));
  const omissionsFromTrials = (() => {
    if (!cognitiveRows.length) return null;
    const omissionCount = cognitiveRows.filter(r => !r || r.response == null).length;
    return (omissionCount / cognitiveRows.length) * 100;
  })();
  const omissionsPct = roundTo(omissionsFromBlocks ?? omissionsFromTrials, 2);

  const blinkCount = roundTo(
    average(blocks.map(b => toFinite(b.blinks))) ??
      toFinite(attGlobal.blinkDynamics && attGlobal.blinkDynamics.blinkCount),
    2
  );
  const bpmMean = roundTo(toFinite(p.bpm_summary && p.bpm_summary.bpmMean), 2);
  const rppgSampleCount = (() => {
    const n = p.rppg_summary && p.rppg_summary.sampleCount;
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return Math.round(n);
  })();

  const qcScore = toFinite(qcComputed && qcComputed.qc_score);
  const attention01 = to01(attentionScore, 100);
  const valence01 = (() => {
    if (emotionValence == null) return null;
    return clamp((emotionValence + 1) / 2, 0, 1);
  })();
  const arousal01 = to01(emotionArousal, 1);
  const rtNorm = (() => {
    if (meanRtMs == null) return null;
    // 300..1300ms -> 1..0 (faster is better)
    return clamp(1 - ((meanRtMs - 300) / 1000), 0, 1);
  })();
  const omissions01 = (() => {
    if (omissionsPct == null) return null;
    // Lower omissions -> better normalized quality
    return clamp(1 - (omissionsPct / 100), 0, 1);
  })();
  const qc01 = to01(qcScore, 100);

  const emotCogIndex = (valence01 != null && attention01 != null)
    ? roundTo(((valence01 * 0.5) + (attention01 * 0.5)) * 100, 2)
    : null;
  const engagement = (attention01 != null && valence01 != null)
    ? roundTo(((attention01 * 0.6) + (valence01 * 0.4)) * 100, 2)
    : null;
  const stressProxy = (arousal01 != null && valence01 != null)
    ? roundTo((arousal01 * (1 - valence01)) * 100, 2)
    : null;
  const perceptionQuality = (qc01 != null && rtNorm != null && omissions01 != null)
    ? roundTo(((qc01 * 0.5) + (rtNorm * 0.3) + (omissions01 * 0.2)) * 100, 2)
    : null;

  const sourceFlags = {
    has_qc: !!(qcComputed && qcComputed.validity),
    has_emotion_summary: emotionValence != null || emotionArousal != null,
    has_attention_metrics: attentionScore != null,
    has_cognitive_signal: meanRtMs != null || omissionsPct != null,
    has_biometry_signal: bpmMean != null || rppgSampleCount != null || respiration.respiration_available,
    has_respiration_summary: respiration.respiration_available,
    has_blocks: blocks.length > 0,
  };
  const sourceCount = Object.values(sourceFlags).filter(Boolean).length;
  const proxyReady = sourceFlags.has_emotion_summary && sourceFlags.has_attention_metrics && sourceFlags.has_cognitive_signal;

  return {
    emotion_valence_mean: emotionValence,
    emotion_arousal_mean: emotionArousal,
    attention_score: attentionScore,
    mean_rt_ms: meanRtMs,
    omissions_pct: omissionsPct,
    blink_count: blinkCount,
    bpm_mean: bpmMean,
    rppg_sample_count: rppgSampleCount,
    respiration_rate_mean: respiration.respiration_rate_mean,
    respiration_rate_min: respiration.respiration_rate_min,
    respiration_rate_max: respiration.respiration_rate_max,
    respiration_sample_count: respiration.respiration_sample_count,
    respiration_available: respiration.respiration_available,
    payload: {
      emot_cog_index: emotCogIndex,
      engagement_index: engagement,
      stress_proxy_index: stressProxy,
      perception_quality_index: perceptionQuality,
      qc_score: qcScore,
      qc_validity: qcComputed ? qcComputed.validity : null,
      proxy_ready: proxyReady,
      source_count: sourceCount,
      source_flags: sourceFlags,
    },
    source_payload: {
      qc_summary: qcSummary && typeof qcSummary === 'object' ? qcSummary : {},
      qc_computed: qcComputed && typeof qcComputed === 'object' ? qcComputed : {},
      feature_inputs: {
        emotion_summary: p.emotion_summary || null,
        attention_metrics_global: p.attentionMetrics && p.attentionMetrics.global ? p.attentionMetrics.global : null,
        blocks,
        cognitive_results_count: cognitiveRows.length,
        bpm_summary: p.bpm_summary || null,
        rppg_summary: p.rppg_summary || null,
        respiration_summary: p.respiration_summary || null,
      },
      normalized: {
        attention_01: attention01,
        valence_01: valence01,
        arousal_01: arousal01,
        rt_norm: rtNorm,
        omissions_01: omissions01,
        qc_01: qc01,
      }
    },
  };
}

async function ensureProjectAccess(queryable, projectId, user) {
  return hasProjectMembership(queryable, projectId, user);
}

function requireIngestCredential(req, res, next) {
  const ids = req.body?.ids;
  const invitationCode = typeof ids?.invitationCode === 'string'
    ? ids.invitationCode.trim()
    : '';
  const authorization = req.headers.authorization;
  if (invitationCode) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Participant ingest token required' });
    }
    try {
      const claims = verifyIngestToken(token);
      const sessionId = typeof ids?.session === 'string' ? ids.session : null;
      if (
        claims.scope !== 'participant:ingest'
        || String(claims.invitation_code) !== invitationCode
        || (sessionId && String(claims.sid) !== sessionId)
      ) {
        return res.status(409).json({
          error: 'Ingest token does not match session or invitation',
          code: 'ingest_token_mismatch',
        });
      }
      req.participantIngestClaims = claims;
      return next();
    } catch (_) {
      return res.status(401).json({ error: 'Invalid or expired participant ingest token' });
    }
  }

  // Researcher web uses an HttpOnly staff cookie. Reuse the canonical auth
  // middleware here so cookie requests receive the same CSRF and revocation
  // checks as every other state-changing staff endpoint.
  return requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (!canRolePerform(req.user?.role, OPERATIONS.SESSION_WRITE)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Operation not permitted: ${OPERATIONS.SESSION_WRITE}`,
        required_permission: OPERATIONS.SESSION_WRITE,
      });
    }
    req.ingestStaffClaims = req.user;
    return next();
  });
}

router.post(
  '/',
  [
    requireIngestCredential,
    requireSessionFeaturePayload,
    body('schemaVersion').optional().equals('session_feature.v1'),
    body('ids').optional().isObject(),
    body('ids.session').optional().isString(),
    body('ids.participant').optional().isString(),
    body('meta').optional({ nullable: true }).isObject(),
    body('precheck').optional({ nullable: true }).isObject(),
    body('qcSummary').optional({ nullable: true }).isObject(),
    body('attentionMetrics').optional({ nullable: true }).isObject(),
    body('audio_summary').optional({ nullable: true }).isObject(),
    body('multimodal_summary').optional({ nullable: true }).isObject(),
    body('multimodal_heatmap').optional({ nullable: true }).isObject(),
    body('emotion_summary').optional({ nullable: true }).isObject(),
    body('experimentMeta').optional({ nullable: true }).isObject(),
    body('cognitiveResults').optional({ nullable: true }).isArray(),
    body('gazeValidation').optional({ nullable: true }).isObject(),
    body('events').optional({ nullable: true }).isArray(),
    body('lifecycle').optional({ nullable: true }).isObject(),
    body('lifecycle.schemaVersion').optional().equals('session_lifecycle.v1'),
    body('lifecycle.state').optional().isIn([
      'idle',
      'starting',
      'instruction',
      'running',
      'paused',
      'quality_error',
      'technical_error',
      'finishing',
      'completed',
      'failed',
    ]),
    body('events.*.schemaVersion').optional().equals('session_event.v1'),
    body('startTime').optional({ nullable: true }),
    body('testHub').optional({ nullable: true }).isObject(),
    body('gazeTests').optional({ nullable: true }).isObject(),
    body('gaze_analytics').optional({ nullable: true }).isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const raw = req.body;
      const sessionId = (raw.ids && raw.ids.session) ? String(raw.ids.session) : null;
      const participantId = (raw.ids && raw.ids.participant) ? String(raw.ids.participant) : null;
      const invitationCode = (raw.ids && raw.ids.invitationCode) ? String(raw.ids.invitationCode) : null;
      const lifecycle = (raw.lifecycle && typeof raw.lifecycle === 'object') ? raw.lifecycle : null;
      const idempotency = resolveIdempotencyKey(req.get('Idempotency-Key'), lifecycle);
      if (!idempotency.ok) {
        return res.status(idempotency.status).json({ error: idempotency.error });
      }
      const finishKeyRequirement = requireFinishIdempotencyKey(lifecycle, idempotency.key);
      if (!finishKeyRequirement.ok) {
        return res.status(finishKeyRequirement.status).json({ error: finishKeyRequirement.error });
      }
      const participantIngest = !!invitationCode;
      const staffClaims = participantIngest
        ? null
        : (req.ingestStaffClaims || authenticateBearerHeader(req.headers.authorization));
      const authenticated = Boolean(staffClaims);
      if (staffClaims) req.user = staffClaims;
      if (!authenticated && !invitationCode) {
        return res.status(401).json({ error: 'Unauthorized ingest: token or ids.invitationCode required' });
      }
      if (!sessionId) return res.status(400).json({ error: 'ids.session required' });
      const result = await withTransaction(pool, async (client) => {
        await lockSessionKey(client, sessionId);
        if (staffClaims) {
          const principal = await resolveCurrentStaffPrincipal(
            client,
            req.headers.authorization,
            req.cookies?.[config.auth.staffCookieName]
          );
          if (!principal) {
            throw new HttpError(
              401,
              'Invalid, expired, or revoked staff token',
              'staff_token_revoked'
            );
          }
          req.user = principal;
        }

        let invitation = null;
        if (invitationCode) {
          invitation = await findInvitationByCode(client, invitationCode, { forUpdate: true });
          if (!invitation) {
            throw new HttpError(404, 'Invitation not found', 'invitation_not_found');
          }
          if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
            throw new HttpError(410, 'Invitation expired', 'invitation_expired');
          }
          const tokenCheck = verifyParticipantIngestRequest(req, {
            sessionId,
            invitationCode,
            invitation,
          });
          if (!tokenCheck.ok) {
            throw new HttpError(tokenCheck.status, tokenCheck.error, 'ingest_token_mismatch');
          }
        }

        let payload = normalizeDerivedPayload(raw);
        const sessionRow = await client.query(
          `SELECT s.id, s.participant_id, s.started_at, s.stopped_at, s.project_id,
                  s.protocol_id, s.invitation_id,
                  sf.payload->'lifecycle'->>'finishAttemptId' AS stored_finish_attempt_id,
                  sq.validity AS stored_qc_validity,
                  sp.payload->>'proxy_ready' AS stored_proxy_ready
           FROM sessions s
           LEFT JOIN session_features sf ON sf.session_id = s.id
           LEFT JOIN session_qc_summary sq ON sq.session_id = s.id
           LEFT JOIN session_proxy_metrics sp ON sp.session_id = s.id
           WHERE s.session_id = $1
           FOR UPDATE OF s`,
          [sessionId]
        );
        const storedSession = sessionRow.rows[0] || null;
        const existingSession = Boolean(storedSession);
        const alreadyCompleted = Boolean(storedSession?.stopped_at);
        let dbSessionId;
        let scope;

        if (storedSession) {
          dbSessionId = storedSession.id;
          const sessionProjectId = storedSession.project_id || null;
          const sessionProtocolId = storedSession.protocol_id || null;
          if (invitation) {
            if (
              Number(storedSession.invitation_id) !== Number(invitation.id)
              || Number(sessionProtocolId) !== Number(invitation.protocol_id)
              || Number(sessionProjectId) !== Number(invitation.project_id)
            ) {
              throw new HttpError(
                409,
                'Session does not match invitation, project, or protocol',
                'session_invitation_mismatch'
              );
            }
            if (
              storedSession.participant_id
              && participantId
              && String(storedSession.participant_id) !== String(participantId)
            ) {
              throw new HttpError(
                409,
                'Session participant does not match',
                'session_participant_mismatch'
              );
            }
          } else if (!authenticated) {
            throw new HttpError(403, 'Invitation required for participant ingest');
          }
          if (authenticated && !sessionProjectId) {
            throw new HttpError(
              409,
              'Staff ingest requires a session bound to a project',
              'session_scope_missing'
            );
          }
          if (
            authenticated
            && !(await ensureProjectAccess(client, sessionProjectId, req.user))
          ) {
            throw new HttpError(403, 'Access denied for project', 'project_access_denied');
          }
          if (invitation && !storedSession.participant_id && participantId) {
            await client.query(
              `UPDATE sessions
               SET participant_id = $1, updated_at = current_timestamp
               WHERE id = $2 AND participant_id IS NULL`,
              [participantId, dbSessionId]
            );
          }
          if (alreadyCompleted) {
            const existingFinish = resolveExistingFinish(
              storedSession.stored_finish_attempt_id,
              idempotency.key
            );
            if (existingFinish.action === 'conflict') {
              throw new HttpError(
                existingFinish.status,
                existingFinish.error,
                'idempotency_conflict'
              );
            }
            if (existingFinish.action === 'replay') {
              return {
                status: 200,
                body: {
                  session_id: sessionId,
                  ingested: true,
                  idempotent: true,
                  idempotency_key: idempotency.key,
                  qc_validity: storedSession.stored_qc_validity || null,
                  proxy_ready: storedSession.stored_proxy_ready === 'true',
                  lifecycle_status: 'completed',
                  completed_at: new Date(storedSession.stopped_at).toISOString(),
                },
              };
            }
          }
          scope = {
            project_id: sessionProjectId,
            protocol_id: sessionProtocolId,
            participant_id: storedSession.participant_id || participantId || null,
          };
        } else {
          if (!invitation) {
            throw new HttpError(
              authenticated ? 409 : 403,
              authenticated
                ? 'Staff must create a project-scoped session before ingest'
                : 'Invitation required to create session',
              'session_must_be_precreated'
            );
          }
          const reserved = await reserveInvitationRun(client, invitation.id);
          if (!reserved) {
            throw new HttpError(
              410,
              'Invitation run limit reached',
              'invitation_run_limit'
            );
          }
          const startCandidate = raw.startTime ? new Date(raw.startTime) : new Date();
          const startTime = Number.isFinite(startCandidate.getTime())
            ? startCandidate
            : new Date();
          const inserted = await client.query(
            `INSERT INTO sessions (
               session_id, participant_id, project_id, protocol_id, invitation_id, started_at
             )
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, participant_id, project_id, protocol_id`,
            [
              sessionId,
              participantId,
              invitation.project_id,
              invitation.protocol_id,
              invitation.id,
              startTime,
            ]
          );
          dbSessionId = inserted.rows[0].id;
          scope = inserted.rows[0];
        }

        let completionApplied = false;
        let completedAtIso = null;
        if (lifecycle && lifecycle.status === 'completed') {
          const completedCandidate = lifecycle.completedAt
            ? new Date(lifecycle.completedAt)
            : new Date();
          const completedAt = Number.isFinite(completedCandidate.getTime())
            ? completedCandidate
            : new Date();
          await client.query(
            `UPDATE sessions
             SET stopped_at = COALESCE(stopped_at, $1), updated_at = current_timestamp
             WHERE id = $2`,
            [completedAt, dbSessionId]
          );
          completionApplied = true;
          completedAtIso = completedAt.toISOString();
        }

        let protocolDefinition = null;
        if (scope.protocol_id) {
          const protocol = await client.query(
            'SELECT definition FROM protocols WHERE id = $1',
            [scope.protocol_id]
          );
          protocolDefinition = protocol.rows[0]?.definition || null;
          if (typeof protocolDefinition === 'string') {
            try {
              protocolDefinition = JSON.parse(protocolDefinition);
            } catch (_) {
              protocolDefinition = null;
            }
          }
        }

        const rtFeatures = computeSessionRtFeatures(payload, protocolDefinition);
        if (rtFeatures && rtFeatures.blocks && rtFeatures.blocks.length) {
          payload = { ...payload, rt_features: rtFeatures };
        }

        const qcSummary = raw.qcSummary || null;
        let { validity, qc_score, fail_reasons } = computeQcValidity(qcSummary, payload);
        ({ validity, qc_score, fail_reasons } = mergeBehavioralRtQc(
          { validity, qc_score, fail_reasons },
          rtFeatures,
          payload,
        ));

        await client.query(
          `INSERT INTO session_features (session_id, payload) VALUES ($1, $2::jsonb)
           ON CONFLICT (session_id) DO UPDATE
           SET payload = $2::jsonb, updated_at = current_timestamp`,
          [dbSessionId, JSON.stringify(payload)]
        );

        await client.query(
          `INSERT INTO session_qc_summary (
             session_id, qc_score, validity, fail_reasons, payload
           ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
           ON CONFLICT (session_id) DO UPDATE SET
             qc_score = $2,
             validity = $3,
             fail_reasons = $4::jsonb,
             payload = $5::jsonb,
             updated_at = current_timestamp`,
          [
            dbSessionId,
            qc_score,
            validity,
            JSON.stringify(fail_reasons || null),
            JSON.stringify(qcSummary || {}),
          ]
        );

        let proxy = extractProxyMetrics(
          payload,
          qcSummary,
          { validity, qc_score, fail_reasons }
        );
        proxy = mergeRtIntoProxyScalars(proxy, rtFeatures);
        const rtMetricsJson = buildProxyMetricsJson(rtFeatures);
        await client.query(
        `INSERT INTO session_proxy_metrics (
           session_id, project_id, protocol_id, participant_id, qc_validity,
           schema_version, status,
           emotion_valence_mean, emotion_arousal_mean, attention_score, mean_rt_ms,
           omissions_pct, blink_count, bpm_mean, rppg_sample_count,
           respiration_rate_mean, respiration_rate_min, respiration_rate_max,
           respiration_sample_count, respiration_available,
           payload, source_payload, metrics
         ) VALUES (
           $1, $2, $3, $4, $5,
           'proxy_metrics.v1', 'partial',
           $6, $7, $8, $9,
           $10, $11, $12, $13,
           $14, $15, $16, $17, $18,
           $19::jsonb, $20::jsonb, $21::jsonb
         )
         ON CONFLICT (session_id) DO UPDATE SET
           project_id = $2,
           protocol_id = $3,
           participant_id = $4,
           qc_validity = $5,
           schema_version = 'proxy_metrics.v1',
           status = 'partial',
           emotion_valence_mean = $6,
           emotion_arousal_mean = $7,
           attention_score = $8,
           mean_rt_ms = $9,
           omissions_pct = $10,
           blink_count = $11,
           bpm_mean = $12,
           rppg_sample_count = $13,
           respiration_rate_mean = $14,
           respiration_rate_min = $15,
           respiration_rate_max = $16,
           respiration_sample_count = $17,
           respiration_available = $18,
           payload = $19::jsonb,
           source_payload = $20::jsonb,
           metrics = COALESCE(session_proxy_metrics.metrics, '{}'::jsonb) || $21::jsonb,
           updated_at = current_timestamp`,
        [
          dbSessionId,
          scope.project_id || null,
          scope.protocol_id || null,
          scope.participant_id || null,
          validity,
          proxy.emotion_valence_mean,
          proxy.emotion_arousal_mean,
          proxy.attention_score,
          proxy.mean_rt_ms,
          proxy.omissions_pct,
          proxy.blink_count,
          proxy.bpm_mean,
          proxy.rppg_sample_count,
          proxy.respiration_rate_mean,
          proxy.respiration_rate_min,
          proxy.respiration_rate_max,
          proxy.respiration_sample_count,
          proxy.respiration_available,
          JSON.stringify(proxy.payload),
          JSON.stringify(proxy.source_payload),
          JSON.stringify(rtMetricsJson),
        ]
        );

        return {
          status: getIngestSuccessStatus(existingSession),
          body: {
            session_id: sessionId,
            ingested: true,
            idempotent: false,
            idempotency_key: idempotency.key,
            qc_validity: validity,
            proxy_ready: !!proxy.payload.proxy_ready,
            lifecycle_status: completionApplied ? 'completed' : 'in_progress',
            completed_at: completedAtIso,
          },
        };
      });
      return res.status(result.status).json(result.body);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({
          error: err.message,
          code: err.code,
          ...(err.details ? { details: err.details } : {}),
        });
      }
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'Session or idempotency conflict',
          code: 'session_conflict',
        });
      }
      console.error(err);
      return res.status(500).json({ error: 'Ingest failed', code: 'ingest_failed' });
    }
  }
);

module.exports = router;
module.exports.requireIngestCredential = requireIngestCredential;
