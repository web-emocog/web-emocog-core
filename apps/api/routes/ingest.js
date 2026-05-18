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

      res.status(201).json({
        session_id: sessionId,
        ingested: true,
        qc_validity: validity,
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
