/**
 * Experiments accounting: aggregated and recent session-level views.
 */
const express = require('express');
const { query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, requireRole, requireOperation, OPERATIONS, isPlatformAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'));
router.use(requireOperation(OPERATIONS.ANALYTICS_READ));

function scopeJoinAndPredicate(userParamIdx, user) {
  if (isPlatformAdmin(user)) return { join: '', predicate: '1=1' };
  return {
    join: `
      LEFT JOIN protocols sp ON sp.id = s.protocol_id
      INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
      INNER JOIN user_organizations uo_scope ON uo_scope.organization_id = p_scope.organization_id AND uo_scope.user_id = $${userParamIdx}
      INNER JOIN user_projects up_scope ON up_scope.project_id = p_scope.id AND up_scope.user_id = uo_scope.user_id
    `,
    predicate: '1=1'
  };
}

router.get(
  '/',
  [
    query('project_id').optional().isInt({ min: 1 }),
    query('protocol_id').optional().isInt({ min: 1 }),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const conditions = [];
      const params = isPlatformAdmin(req.user) ? [] : [req.user.sub];
      let i = params.length + 1;
      if (req.query.project_id) {
        conditions.push(`s.project_id = $${i++}`);
        params.push(req.query.project_id);
      }
      if (req.query.protocol_id) {
        conditions.push(`s.protocol_id = $${i++}`);
        params.push(req.query.protocol_id);
      }
      if (req.query.date_from) {
        conditions.push(`s.started_at >= $${i++}`);
        params.push(req.query.date_from);
      }
      if (req.query.date_to) {
        conditions.push(`s.started_at <= $${i++}`);
        params.push(req.query.date_to);
      }
      const scope = scopeJoinAndPredicate(1, req.user);
      const where = conditions.length ? `WHERE ${scope.predicate} AND ${conditions.join(' AND ')}` : `WHERE ${scope.predicate}`;

      const r = await pool.query(
        `SELECT
           COALESCE(s.project_id, 0) AS project_id,
           COALESCE(s.protocol_id, 0) AS protocol_id,
           COALESCE(sf.payload->'experimentMeta'->>'title', sf.payload->'meta'->>'protocolName', 'Untitled experiment') AS experiment_title,
           COUNT(*)::int AS total_sessions,
           COUNT(*) FILTER (WHERE s.stopped_at IS NOT NULL)::int AS completed_sessions,
           COUNT(*) FILTER (WHERE s.stopped_at IS NULL)::int AS in_progress_sessions,
           ROUND(AVG(q.qc_score)::numeric, 2) AS avg_qc_score,
           COUNT(*) FILTER (WHERE q.validity = 'valid')::int AS qc_valid_count,
           COUNT(*) FILTER (WHERE q.validity = 'borderline')::int AS qc_borderline_count,
           COUNT(*) FILTER (WHERE q.validity = 'invalid')::int AS qc_invalid_count,
           COUNT(*) FILTER (WHERE pm.payload->>'proxy_ready' = 'true')::int AS proxy_ready_sessions,
           ROUND(AVG(pm.attention_score)::numeric, 2) AS avg_attention_score,
           ROUND(AVG(pm.mean_rt_ms)::numeric, 2) AS avg_mean_rt_ms,
           ROUND(AVG(pm.omissions_pct)::numeric, 2) AS avg_omissions_pct,
           ROUND(AVG(pm.respiration_rate_mean)::numeric, 2) AS avg_respiration_rate_mean,
           COALESCE(SUM(pm.respiration_sample_count), 0)::int AS total_respiration_sample_count,
           COUNT(*) FILTER (WHERE pm.respiration_available = true)::int AS respiration_available_sessions,
           MIN(s.started_at) AS first_started_at,
           MAX(s.started_at) AS last_started_at
         FROM sessions s
         ${scope.join}
         LEFT JOIN session_features sf ON sf.session_id = s.id
         LEFT JOIN session_qc_summary q ON q.session_id = s.id
         LEFT JOIN session_proxy_metrics pm ON pm.session_id = s.id
         ${where}
         GROUP BY 1, 2, 3
         ORDER BY last_started_at DESC NULLS LAST
         LIMIT 200`,
        params
      );
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load experiments overview' });
    }
  }
);

router.get(
  '/recent',
  [
    query('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
      const scope = scopeJoinAndPredicate(1, req.user);
      const params = isPlatformAdmin(req.user)
        ? [limit]
        : [req.user.sub, limit];
      const limitParam = params.length;
      const r = await pool.query(
        `SELECT
           s.id,
           s.session_id,
           COALESCE(NULLIF(sf.payload->'ids'->>'participantAlias', ''), s.participant_id) AS participant_id,
           s.project_id,
           s.protocol_id,
           s.started_at,
           s.stopped_at,
           CASE WHEN s.stopped_at IS NULL THEN 'in_progress' ELSE 'completed' END AS session_status,
           q.qc_score,
           q.validity AS qc_validity,
           q.fail_reasons AS qc_fail_reasons,
           COALESCE((pm.payload->>'proxy_ready')::boolean, false) AS proxy_ready,
           pm.attention_score,
           pm.mean_rt_ms,
           pm.omissions_pct,
           pm.emotion_valence_mean,
           pm.emotion_arousal_mean,
           pm.bpm_mean,
           pm.rppg_sample_count,
           pm.respiration_rate_mean,
           pm.respiration_sample_count,
           pm.respiration_available,
           pm.payload AS proxy_metrics,
           pm.source_payload AS proxy_source_data,
           COALESCE(sf.payload->'ids'->>'invitationCode', '') AS invitation_code,
           COALESCE(sf.payload->'experimentMeta'->>'title', sf.payload->'meta'->>'protocolName', 'Untitled experiment') AS experiment_title
         FROM sessions s
         ${scope.join}
         LEFT JOIN session_qc_summary q ON q.session_id = s.id
         LEFT JOIN session_proxy_metrics pm ON pm.session_id = s.id
         LEFT JOIN session_features sf ON sf.session_id = s.id
         WHERE ${scope.predicate}
         ORDER BY s.started_at DESC NULLS LAST
         LIMIT $${limitParam}`,
        params
      );
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load recent sessions' });
    }
  }
);

module.exports = router;
