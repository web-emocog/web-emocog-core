/**
 * Experiment Runtime API: старт/стоп сессии (Фаза 2.4).
 */
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const {
  requireAuth,
  requireRole,
  requireOperation,
  OPERATIONS,
  isPlatformAdmin,
  hasProjectMembership,
  hasSessionMembership,
} = require('../middleware/auth');
const { getSessionProxyMetrics } = require('./proxy_metrics');
const { withTransaction, lockSessionKey } = require('../db/transaction');
const { HttpError } = require('../security/http-error');

const router = express.Router();

async function ensureProjectAccess(queryable, projectId, user) {
  return hasProjectMembership(queryable, projectId, user);
}

async function getProtocolProjectId(queryable, protocolId) {
  if (!protocolId) return null;
  const r = await queryable.query('SELECT project_id FROM protocols WHERE id = $1', [protocolId]);
  return r.rows[0] ? r.rows[0].project_id : null;
}

function scopedJoinAndWhere(userParamIdx, user) {
  if (isPlatformAdmin(user)) return '';
  return `
    LEFT JOIN protocols sp ON sp.id = s.protocol_id
    INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
    INNER JOIN user_organizations uo_scope ON uo_scope.organization_id = p_scope.organization_id AND uo_scope.user_id = $${userParamIdx}
    INNER JOIN user_projects up_scope ON up_scope.project_id = p_scope.id AND up_scope.user_id = uo_scope.user_id
  `;
}

router.post(
  '/start',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_WRITE),
  [
    body('session_id').trim().notEmpty().isLength({ max: 64 }),
    body('participant_id').optional().trim().isLength({ max: 64 }),
    body('project_id').optional().isInt(),
    body('protocol_id').optional().isInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const result = await withTransaction(pool, async (client) => {
        const { session_id, participant_id } = req.body;
        await lockSessionKey(client, session_id);
        let projectId = req.body.project_id ? parseInt(req.body.project_id, 10) : null;
        const protocolId = req.body.protocol_id ? parseInt(req.body.protocol_id, 10) : null;
        if (protocolId) {
          const protocolProjectId = await getProtocolProjectId(client, protocolId);
          if (!protocolProjectId) throw new HttpError(400, 'Protocol not found');
          if (projectId && projectId !== protocolProjectId) {
            throw new HttpError(400, 'project_id does not match protocol project');
          }
          projectId = protocolProjectId;
        }
        if (!projectId) {
          throw new HttpError(400, 'project_id or protocol_id is required');
        }
        if (!(await ensureProjectAccess(client, projectId, req.user))) {
          throw new HttpError(403, 'Access denied for project');
        }

        const existing = await client.query(
          `SELECT id, session_id, participant_id, project_id, protocol_id,
                  invitation_id, started_at, stopped_at, created_at
           FROM sessions
           WHERE session_id = $1
           FOR UPDATE`,
          [session_id]
        );
        if (existing.rows[0]) {
          const row = existing.rows[0];
          if (!(await hasSessionMembership(client, session_id, req.user))) {
            throw new HttpError(
              409,
              'session_id already belongs to another project',
              'foreign_session_conflict'
            );
          }
          if (
            Number(row.project_id) !== Number(projectId)
            || Number(row.protocol_id || 0) !== Number(protocolId || 0)
          ) {
            throw new HttpError(409, 'session_id scope mismatch', 'session_scope_mismatch');
          }
          if (
            row.participant_id
            && participant_id
            && String(row.participant_id) !== String(participant_id)
          ) {
            throw new HttpError(
              409,
              'session_id participant mismatch',
              'session_participant_mismatch'
            );
          }
          return {
            status: 200,
            body: {
              ...row,
              idempotent: true,
              session_status: row.stopped_at ? 'completed' : 'in_progress',
              completed_at: row.stopped_at || null,
            },
          };
        }

        const inserted = await client.query(
          `INSERT INTO sessions (
             session_id, participant_id, project_id, protocol_id, started_at
           )
           VALUES ($1, $2, $3, $4, current_timestamp)
           RETURNING id, session_id, participant_id, project_id, protocol_id,
                     invitation_id, started_at, stopped_at, created_at`,
          [session_id, participant_id || null, projectId, protocolId]
        );
        const row = inserted.rows[0];
        return {
          status: 201,
          body: {
            ...row,
            idempotent: false,
            session_status: 'in_progress',
            completed_at: null,
          },
        };
      });
      return res.status(result.status).json(result.body);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({
          error: err.message,
          code: err.code || 'session_start_rejected',
        });
      }
      console.error(err);
      return res.status(500).json({ error: 'Start session failed' });
    }
  }
);

router.post(
  '/stop',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_WRITE),
  [body('session_id').trim().notEmpty().isLength({ max: 64 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const now = new Date();
      const allowed = await hasSessionMembership(pool, req.body.session_id, req.user);
      if (!allowed) return res.status(404).json({ error: 'Session not found or access denied' });
      const r = await pool.query(
        `UPDATE sessions SET stopped_at = $1, updated_at = current_timestamp
         WHERE session_id = $2 RETURNING id, session_id, started_at, stopped_at`,
        [now, req.body.session_id]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Session not found' });
      const row = r.rows[0];
      res.json({
        ...row,
        session_status: row.stopped_at ? 'completed' : 'in_progress',
        completed_at: row.stopped_at || null
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Stop session failed' });
    }
  }
);

router.get(
  '/',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_READ),
  [
    query('project_id').optional().isInt(),
    query('protocol_id').optional().isInt(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('qc_validity').optional().isIn(['valid', 'borderline', 'invalid']),
  ],
  async (req, res) => {
    try {
      let sql = `
        SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id, s.started_at, s.stopped_at, s.created_at,
               CASE WHEN s.stopped_at IS NULL THEN 'in_progress' ELSE 'completed' END AS session_status,
               s.stopped_at AS completed_at,
               q.qc_score, q.validity AS qc_validity,
               q.fail_reasons AS qc_fail_reasons,
               COALESCE((pm.payload->>'proxy_ready')::boolean, false) AS proxy_ready,
               pm.attention_score, pm.mean_rt_ms, pm.omissions_pct,
               pm.emotion_valence_mean, pm.emotion_arousal_mean, pm.bpm_mean, pm.rppg_sample_count,
               pm.respiration_rate_mean, pm.respiration_sample_count, pm.respiration_available,
               pm.payload AS proxy_metrics
        FROM sessions s
        LEFT JOIN session_qc_summary q ON q.session_id = s.id
        LEFT JOIN session_proxy_metrics pm ON pm.session_id = s.id
        ${scopedJoinAndWhere(1, req.user)}
        WHERE 1=1
      `;
      const params = isPlatformAdmin(req.user) ? [] : [req.user.sub];
      let i = params.length + 1;
      if (req.query.project_id) { params.push(req.query.project_id); sql += ` AND s.project_id = $${i++}`; }
      if (req.query.protocol_id) { params.push(req.query.protocol_id); sql += ` AND s.protocol_id = $${i++}`; }
      if (req.query.date_from) { params.push(req.query.date_from); sql += ` AND s.started_at >= $${i++}`; }
      if (req.query.date_to) { params.push(req.query.date_to); sql += ` AND s.started_at <= $${i++}`; }
      if (req.query.qc_validity) { params.push(req.query.qc_validity); sql += ` AND q.validity = $${i++}`; }
      sql += ' ORDER BY s.started_at DESC NULLS LAST LIMIT 500';
      const r = await pool.query(sql, params);
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.get(
  '/:sessionRef/proxy-metrics',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'developer'),
  requireOperation(OPERATIONS.ANALYTICS_READ),
  [param('sessionRef').trim().notEmpty().isLength({ max: 64 })],
  getSessionProxyMetrics
);

router.get(
  '/:id',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_READ),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const allowed = await hasSessionMembership(pool, req.params.id, req.user);
      if (!allowed) return res.status(404).json({ error: 'Not found' });
      const r = await pool.query(
        `SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id, s.started_at, s.stopped_at, s.created_at,
                CASE WHEN s.stopped_at IS NULL THEN 'in_progress' ELSE 'completed' END AS session_status,
                s.stopped_at AS completed_at,
                q.qc_score, q.validity AS qc_validity, q.fail_reasons, q.payload AS qc_payload,
                COALESCE((pm.payload->>'proxy_ready')::boolean, false) AS proxy_ready,
                pm.attention_score, pm.mean_rt_ms, pm.omissions_pct,
                pm.emotion_valence_mean, pm.emotion_arousal_mean, pm.bpm_mean, pm.rppg_sample_count,
                pm.respiration_rate_mean, pm.respiration_sample_count, pm.respiration_available,
                pm.payload AS proxy_metrics, pm.source_payload AS proxy_source_data
         FROM sessions s
         LEFT JOIN session_qc_summary q ON q.session_id = s.id
         LEFT JOIN session_proxy_metrics pm ON pm.session_id = s.id
         WHERE s.id = $1`,
        [req.params.id]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      const session = r.rows[0];
      const features = await pool.query('SELECT payload FROM session_features WHERE session_id = $1', [session.id]);
      session.features = features.rows[0] ? features.rows[0].payload : null;
      res.json(session);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
