/**
 * Data Ingestion для агрегатов (Фаза 2.5).
 * POST /ingest — приём payload из buildAggregatesPayload.
 * PII (email) не сохраняем в SessionFeatures (Фаза 2.8).
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { computeQcValidity } = require('../qc/aggregator');

const router = express.Router();

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const piiKeyPattern = /(email|e-mail|phone|tel|telegram|whatsapp|first_name|last_name|middle_name|full_name|surname|address|passport)/i;
  const sanitizeNode = (node) => {
    if (Array.isArray(node)) return node.map(sanitizeNode);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (piiKeyPattern.test(String(key))) continue;
      out[key] = sanitizeNode(value);
    }
    return out;
  };
  const out = sanitizeNode(payload);
  if (out.meta && out.meta.user && typeof out.meta.user === 'object') {
    out.meta.user = { ...out.meta.user };
    delete out.meta.user.email;
  }
  if (out.ids && typeof out.ids === 'object') {
    delete out.ids.email;
    delete out.ids.mail;
    delete out.ids.phone;
    delete out.ids.tel;
    delete out.ids.full_name;
  }
  return out;
}

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

function extractProxyMetrics(payload, qcSummary, qcComputed) {
  const p = payload && typeof payload === 'object' ? payload : {};
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
    has_biometry_signal: bpmMean != null || rppgSampleCount != null,
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

function hasValidAuth(req) {
  try {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return false;
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = payload;
    return true;
  } catch (_) {
    return false;
  }
}

async function getInvitationContext(code) {
  if (!code) return null;
  const inv = await pool.query(
    `SELECT i.id, i.code, i.max_runs, i.expires_at, i.protocol_id, p.project_id
     FROM invitations i
     INNER JOIN protocols p ON p.id = i.protocol_id
     WHERE i.code = $1`,
    [code]
  );
  return inv.rows[0] || null;
}

async function invitationRunsUsed(code) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM session_features sf
     WHERE sf.payload->'ids'->>'invitationCode' = $1`,
    [code]
  );
  return r.rows[0] ? r.rows[0].n : 0;
}

async function ensureProjectAccess(projectId, userId) {
  if (!projectId) return false;
  const r = await pool.query(
    `SELECT 1
     FROM projects p
     INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id
     WHERE p.id = $1 AND uo.user_id = $2`,
    [projectId, userId]
  );
  return !!r.rows[0];
}

router.post(
  '/',
  [
    body('ids').optional().isObject(),
    body('ids.session').optional().isString(),
    body('ids.participant').optional().isString(),
    body('meta').optional().isObject(),
    body('precheck').optional().isObject(),
    body('qcSummary').optional().isObject(),
    body('attentionMetrics').optional().isObject(),
    body('emotion_summary').optional().isObject(),
    body('experimentMeta').optional().isObject(),
    body('cognitiveResults').optional().isArray(),
    body('gazeValidation').optional().isObject(),
    body('events').optional().isArray(),
    body('lifecycle').optional().isObject(),
    body('startTime').optional(),
    body('testHub').optional().isObject(),
    body('gazeTests').optional().isObject(),
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
      const authenticated = hasValidAuth(req);
      let invitation = null;

      if (!authenticated && !invitationCode) {
        return res.status(401).json({ error: 'Unauthorized ingest: token or ids.invitationCode required' });
      }
      if (!sessionId) return res.status(400).json({ error: 'ids.session required' });
      if (invitationCode) {
        invitation = await getInvitationContext(invitationCode);
        if (!invitation) return res.status(403).json({ error: 'Invalid invitation code' });
        if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
          return res.status(410).json({ error: 'Invitation expired' });
        }
        if (invitation.max_runs != null) {
          const used = await invitationRunsUsed(invitation.code);
          if (used >= invitation.max_runs) {
            return res.status(410).json({ error: 'Invitation run limit reached' });
          }
        }
        if (authenticated) {
          const allowed = await ensureProjectAccess(invitation.project_id, req.user.sub);
          if (!allowed) return res.status(403).json({ error: 'Access denied for invitation project' });
        }
      }

      const payload = normalizeDerivedPayload(sanitizePayload(raw));

      const sessionRow = await pool.query(
        `SELECT s.id, s.started_at, s.project_id, s.protocol_id
         FROM sessions s
         WHERE s.session_id = $1`,
        [sessionId]
      );
      let dbSessionId;
      let startedAt = null;
      if (sessionRow.rows[0]) {
        dbSessionId = sessionRow.rows[0].id;
        startedAt = sessionRow.rows[0].started_at;
        const sessionProjectId = sessionRow.rows[0].project_id || null;
        const sessionProtocolId = sessionRow.rows[0].protocol_id || null;
        if (invitation) {
          if (sessionProtocolId && sessionProtocolId !== invitation.protocol_id) {
            return res.status(403).json({ error: 'Session protocol mismatch with invitation' });
          }
        } else if (!authenticated) {
          return res.status(403).json({ error: 'Invitation required for unauthenticated ingest' });
        }
        if (authenticated && sessionProjectId) {
          const ok = await ensureProjectAccess(sessionProjectId, req.user.sub);
          if (!ok) return res.status(403).json({ error: 'Access denied for project' });
        }
      } else {
        const startTime = raw.startTime ? new Date(raw.startTime) : new Date();
        const protocolId = invitation ? invitation.protocol_id : null;
        const projectId = invitation ? invitation.project_id : null;
        if (!authenticated && !invitation) {
          return res.status(403).json({ error: 'Invitation required to create session' });
        }
        if (authenticated && projectId) {
          const ok = await ensureProjectAccess(projectId, req.user.sub);
          if (!ok) return res.status(403).json({ error: 'Access denied for project' });
        }
        const ins = await pool.query(
          `INSERT INTO sessions (session_id, participant_id, project_id, protocol_id, started_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [sessionId, participantId, projectId, protocolId, startTime]
        );
        dbSessionId = ins.rows[0].id;
        startedAt = startTime;
      }

      let completionApplied = false;
      let completedAtIso = null;
      if (lifecycle && lifecycle.status === 'completed') {
        const completedAt = lifecycle.completedAt ? new Date(lifecycle.completedAt) : new Date();
        const safeCompletedAt = Number.isFinite(completedAt.getTime()) ? completedAt : new Date();
        await pool.query(
          `UPDATE sessions
           SET stopped_at = COALESCE(stopped_at, $1), updated_at = current_timestamp
           WHERE id = $2`,
          [safeCompletedAt, dbSessionId]
        );
        completionApplied = true;
        completedAtIso = safeCompletedAt.toISOString();
      }

      await pool.query(
        `INSERT INTO session_features (session_id, payload) VALUES ($1, $2::jsonb)
         ON CONFLICT (session_id) DO UPDATE SET payload = $2::jsonb, updated_at = current_timestamp`,
        [dbSessionId, JSON.stringify(payload)]
      );

      const qcSummary = raw.qcSummary || null;
      const { validity, qc_score, fail_reasons } = computeQcValidity(qcSummary, payload);
      await pool.query(
        `INSERT INTO session_qc_summary (session_id, qc_score, validity, fail_reasons, payload) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (session_id) DO UPDATE SET qc_score = $2, validity = $3, fail_reasons = $4::jsonb, payload = $5::jsonb, updated_at = current_timestamp`,
        [dbSessionId, qc_score, validity, JSON.stringify(fail_reasons || null), JSON.stringify(qcSummary || {})]
      );

      const sessionScope = await pool.query(
        'SELECT project_id, protocol_id FROM sessions WHERE id = $1',
        [dbSessionId]
      );
      const proxy = extractProxyMetrics(payload, qcSummary, { validity, qc_score, fail_reasons });
      await pool.query(
        `INSERT INTO session_proxy_metrics (
           session_id, project_id, protocol_id, qc_validity,
           emotion_valence_mean, emotion_arousal_mean, attention_score, mean_rt_ms,
           omissions_pct, blink_count, bpm_mean, rppg_sample_count, payload, source_payload
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12, $13::jsonb, $14::jsonb
         )
         ON CONFLICT (session_id) DO UPDATE SET
           project_id = $2,
           protocol_id = $3,
           qc_validity = $4,
           emotion_valence_mean = $5,
           emotion_arousal_mean = $6,
           attention_score = $7,
           mean_rt_ms = $8,
           omissions_pct = $9,
           blink_count = $10,
           bpm_mean = $11,
           rppg_sample_count = $12,
           payload = $13::jsonb,
           source_payload = $14::jsonb,
           updated_at = current_timestamp`,
        [
          dbSessionId,
          sessionScope.rows[0] ? sessionScope.rows[0].project_id : null,
          sessionScope.rows[0] ? sessionScope.rows[0].protocol_id : null,
          validity,
          proxy.emotion_valence_mean,
          proxy.emotion_arousal_mean,
          proxy.attention_score,
          proxy.mean_rt_ms,
          proxy.omissions_pct,
          proxy.blink_count,
          proxy.bpm_mean,
          proxy.rppg_sample_count,
          JSON.stringify(proxy.payload),
          JSON.stringify(proxy.source_payload),
        ]
      );

      res.status(201).json({
        session_id: sessionId,
        ingested: true,
        qc_validity: validity,
        proxy_ready: !!proxy.payload.proxy_ready,
        lifecycle_status: completionApplied ? 'completed' : 'in_progress',
        completed_at: completedAtIso
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Ingest failed' });
    }
  }
);

module.exports = router;
