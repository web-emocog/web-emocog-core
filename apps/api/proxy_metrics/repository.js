const { pool } = require('../db');
const { scopedSessionJoin } = require('./access');

const PROXY_SELECT = `
  pm.session_id AS pm_session_id,
  pm.project_id AS pm_project_id,
  pm.protocol_id AS pm_protocol_id,
  pm.participant_id AS pm_participant_id,
  pm.schema_version,
  pm.status,
  pm.metrics,
  pm.missing_metrics,
  pm.error,
  pm.computed_at,
  pm.updated_at,
  pm.attention_score,
  pm.emotion_valence_mean,
  pm.emotion_arousal_mean,
  pm.mean_rt_ms,
  pm.omissions_pct,
  pm.blink_count,
  pm.bpm_mean,
  pm.rppg_sample_count,
  pm.respiration_rate_mean,
  pm.respiration_available,
  pm.payload,
  pm.source_payload,
  pm.qc_validity
`;

function mapProxyRow(row) {
  if (!row || row.pm_session_id == null) return null;
  return {
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
  };
}

async function loadProxyBySessionDbId(sessionDbId) {
  const r = await pool.query(
    `SELECT ${PROXY_SELECT}
     FROM session_proxy_metrics pm
     WHERE pm.session_id = $1`,
    [sessionDbId]
  );
  return mapProxyRow(r.rows[0]);
}

async function loadQcBySessionDbId(sessionDbId) {
  const r = await pool.query(
    `SELECT qc_score, validity, fail_reasons, payload
     FROM session_qc_summary
     WHERE session_id = $1`,
    [sessionDbId]
  );
  return r.rows[0] || null;
}

async function loadFeaturesBySessionDbId(sessionDbId) {
  const r = await pool.query(
    'SELECT payload FROM session_features WHERE session_id = $1',
    [sessionDbId]
  );
  return r.rows[0] ? r.rows[0].payload : null;
}

async function listProxyForScope({ userId, platformScope = false, projectId, protocolId, status, computedFrom, computedTo, metricName, limit, offset }) {
  let sql = `
    SELECT s.id AS session_db_id, s.session_id, s.participant_id, s.project_id, s.protocol_id,
           ${PROXY_SELECT}
    FROM sessions s
    LEFT JOIN session_proxy_metrics pm ON pm.session_id = s.id
    ${platformScope ? '' : scopedSessionJoin(1)}
    WHERE 1=1
  `;
  const params = platformScope ? [] : [userId];
  let i = params.length + 1;

  if (projectId) {
    params.push(projectId);
    sql += ` AND s.project_id = $${i++}`;
  }
  if (protocolId) {
    params.push(protocolId);
    sql += ` AND s.protocol_id = $${i++}`;
  }
  if (status) {
    params.push(status);
    sql += ` AND COALESCE(pm.status, 'not_computed') = $${i++}`;
  }
  if (computedFrom) {
    params.push(computedFrom);
    sql += ` AND pm.computed_at >= $${i++}`;
  }
  if (computedTo) {
    params.push(computedTo);
    sql += ` AND pm.computed_at <= $${i++}`;
  }
  if (metricName) {
    params.push(metricName);
    sql += ` AND pm.metrics ? $${i++}`;
  }

  params.push(limit);
  sql += ` ORDER BY s.started_at DESC NULLS LAST LIMIT $${i++}`;
  params.push(offset);
  sql += ` OFFSET $${i++}`;

  const r = await pool.query(sql, params);
  return r.rows;
}

module.exports = {
  loadProxyBySessionDbId,
  loadQcBySessionDbId,
  loadFeaturesBySessionDbId,
  listProxyForScope,
  mapProxyRow,
};
