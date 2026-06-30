/**
 * Proxy metrics read API (v1 contract) + optional internal upsert (env-gated).
 */
const express = require('express');
const { param, query, body, validationResult } = require('express-validator');
const config = require('../config');
const { requireAuth, requireRole, requirePlatformAdmin } = require('../middleware/auth');
const {
  buildNotComputed,
  rowToProxyMetricsResponse,
  getSchemaDescriptor,
  SCHEMA_VERSION,
  STATUSES,
} = require('../proxy_metrics/contract');
const { getSessionForUser, ensureProjectAccess, ensureProtocolAccess } = require('../proxy_metrics/access');
const {
  loadProxyBySessionDbId,
  loadQcBySessionDbId,
  loadFeaturesBySessionDbId,
  listProxyForScope,
} = require('../proxy_metrics/repository');
const { pool } = require('../db');

const router = express.Router();

function hasGlobalProjectAccess(user) {
  return !!user && (user.bypass_admin === true || user.role === 'admin' || user.role === 'PI');
}

function hasGlobalProtocolAccess(user) {
  return !!user && (user.bypass_admin === true || user.role === 'admin' || user.role === 'PI');
}

function parseListQuery(req) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  return {
    protocolId: req.query.protocol_id ? parseInt(req.query.protocol_id, 10) : null,
    status: req.query.status || null,
    computedFrom: req.query.computed_from || req.query.from || null,
    computedTo: req.query.computed_to || req.query.to || null,
    metricName: req.query.metric_name || null,
    limit,
    offset,
  };
}

async function buildListResponse(rows, userId) {
  const items = [];
  for (const row of rows) {
    const sessionRow = {
      id: row.session_db_id,
      session_id: row.session_id,
      participant_id: row.participant_id,
      project_id: row.project_id,
      protocol_id: row.protocol_id,
    };
    const proxyRow = row.pm_session_id != null ? {
      session_id: row.pm_session_id,
      project_id: row.pm_project_id,
      protocol_id: row.pm_protocol_id,
      participant_id: row.pm_participant_id,
      schema_version: row.schema_version,
      status: row.status,
      metrics: row.metrics,
      missing_metrics: row.missing_metrics,
      error: row.error,
      computed_at: row.computed_at,
      updated_at: row.updated_at,
      attention_score: row.attention_score,
      emotion_valence_mean: row.emotion_valence_mean,
      emotion_arousal_mean: row.emotion_arousal_mean,
      mean_rt_ms: row.mean_rt_ms,
      omissions_pct: row.omissions_pct,
      blink_count: row.blink_count,
      bpm_mean: row.bpm_mean,
      rppg_sample_count: row.rppg_sample_count,
      respiration_rate_mean: row.respiration_rate_mean,
      respiration_available: row.respiration_available,
      payload: row.payload,
      source_payload: row.source_payload,
      qc_validity: row.qc_validity,
    } : null;
    const features = await loadFeaturesBySessionDbId(sessionRow.id);
    const qc = await loadQcBySessionDbId(sessionRow.id);
    items.push(rowToProxyMetricsResponse(sessionRow, proxyRow, features, qc));
  }
  return items;
}

/** GET /proxy-metrics/schema */
router.get('/schema', (req, res) => {
  res.json(getSchemaDescriptor());
});

/** GET /sessions/:sessionRef/proxy-metrics — mounted from sessions router */
async function getSessionProxyMetrics(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const session = await getSessionForUser(req.params.sessionRef, req.user.sub);
    if (!session) return res.status(404).json({ error: 'Session not found or access denied' });

    const proxyRow = await loadProxyBySessionDbId(session.id);
    const features = await loadFeaturesBySessionDbId(session.id);
    const qc = await loadQcBySessionDbId(session.id);

    res.json(rowToProxyMetricsResponse(session, proxyRow, features, qc));
  } catch (err) {
    console.error('[proxy-metrics] session', err.message);
    res.status(500).json({ error: 'Proxy metrics read failed' });
  }
}

/** GET /projects/:id/proxy-metrics — mounted from projects router */
async function listProjectProxyMetrics(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const projectId = parseInt(req.params.id, 10);
    const allowed = await ensureProjectAccess(projectId, req.user, hasGlobalProjectAccess);
    if (!allowed) return res.status(403).json({ error: 'Access denied for project' });

    const q = parseListQuery(req);
    const rows = await listProxyForScope({
      userId: req.user.sub,
      projectId,
      protocolId: q.protocolId,
      status: q.status,
      computedFrom: q.computedFrom,
      computedTo: q.computedTo,
      metricName: q.metricName,
      limit: q.limit,
      offset: q.offset,
    });

    res.json({
      project_id: projectId,
      schema_version: SCHEMA_VERSION,
      count: rows.length,
      pagination: { limit: q.limit, offset: q.offset },
      items: await buildListResponse(rows, req.user.sub),
    });
  } catch (err) {
    console.error('[proxy-metrics] project list', err.message);
    res.status(500).json({ error: 'Proxy metrics list failed' });
  }
}

/** GET /protocols/:id/proxy-metrics — mounted from protocols router */
async function listProtocolProxyMetrics(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const protocolId = parseInt(req.params.id, 10);
    const protocol = await ensureProtocolAccess(protocolId, req.user, hasGlobalProtocolAccess);
    if (!protocol) return res.status(404).json({ error: 'Protocol not found or access denied' });

    const q = parseListQuery(req);
    const rows = await listProxyForScope({
      userId: req.user.sub,
      projectId: protocol.project_id,
      protocolId,
      status: q.status,
      computedFrom: q.computedFrom,
      computedTo: q.computedTo,
      metricName: q.metricName,
      limit: q.limit,
      offset: q.offset,
    });

    res.json({
      protocol_id: protocolId,
      project_id: protocol.project_id,
      schema_version: SCHEMA_VERSION,
      count: rows.length,
      pagination: { limit: q.limit, offset: q.offset },
      items: await buildListResponse(rows, req.user.sub),
    });
  } catch (err) {
    console.error('[proxy-metrics] protocol list', err.message);
    res.status(500).json({ error: 'Proxy metrics list failed' });
  }
}

/** Internal upsert — disabled unless ENABLE_PROXY_METRICS_INTERNAL_UPSERT=true */
router.post(
  '/internal/sessions/:sessionRef',
  requireAuth,
  requirePlatformAdmin,
  [
    param('sessionRef').trim().notEmpty(),
    body('schema_version').optional().isString(),
    body('status').optional().isIn([...STATUSES]),
    body('metrics').optional().isObject(),
    body('missing_metrics').optional().isArray(),
    body('error').optional({ nullable: true }).isString(),
    body('computed_at').optional().isISO8601(),
  ],
  async (req, res) => {
    if (process.env.ENABLE_PROXY_METRICS_INTERNAL_UPSERT !== 'true') {
      return res.status(404).json({ error: 'Not found' });
    }
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const session = await getSessionForUser(req.params.sessionRef, req.user.sub);
      if (!session) return res.status(404).json({ error: 'Session not found or access denied' });

      const schemaVersion = req.body.schema_version || SCHEMA_VERSION;
      const status = req.body.status || 'computed';
      const metrics = req.body.metrics || {};
      const missing = req.body.missing_metrics || [];
      const computedAt = req.body.computed_at || new Date().toISOString();

      await pool.query(
        `INSERT INTO session_proxy_metrics (
           session_id, project_id, protocol_id, participant_id,
           schema_version, status, metrics, missing_metrics, error, computed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
         ON CONFLICT (session_id) DO UPDATE SET
           project_id = EXCLUDED.project_id,
           protocol_id = EXCLUDED.protocol_id,
           participant_id = EXCLUDED.participant_id,
           schema_version = EXCLUDED.schema_version,
           status = EXCLUDED.status,
           metrics = EXCLUDED.metrics,
           missing_metrics = EXCLUDED.missing_metrics,
           error = EXCLUDED.error,
           computed_at = EXCLUDED.computed_at,
           updated_at = current_timestamp`,
        [
          session.id,
          session.project_id,
          session.protocol_id,
          session.participant_id,
          schemaVersion,
          status,
          JSON.stringify(metrics),
          JSON.stringify(missing),
          req.body.error || null,
          computedAt,
        ]
      );

      const proxyRow = await loadProxyBySessionDbId(session.id);
      const features = await loadFeaturesBySessionDbId(session.id);
      const qc = await loadQcBySessionDbId(session.id);
      res.status(200).json(rowToProxyMetricsResponse(session, proxyRow, features, qc));
    } catch (err) {
      console.error('[proxy-metrics] internal upsert', err.message);
      res.status(500).json({ error: 'Proxy metrics upsert failed' });
    }
  }
);

module.exports = router;
module.exports.getSessionProxyMetrics = getSessionProxyMetrics;
module.exports.listProjectProxyMetrics = listProjectProxyMetrics;
module.exports.listProtocolProxyMetrics = listProtocolProxyMetrics;
