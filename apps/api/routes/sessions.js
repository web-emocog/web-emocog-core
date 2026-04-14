/**
 * Experiment Runtime API: старт/стоп сессии (Фаза 2.4).
 */
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

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

async function getProtocolProjectId(protocolId) {
  if (!protocolId) return null;
  const r = await pool.query('SELECT project_id FROM protocols WHERE id = $1', [protocolId]);
  return r.rows[0] ? r.rows[0].project_id : null;
}

function scopedJoinAndWhere(userParamIdx) {
  return `
    LEFT JOIN protocols sp ON sp.id = s.protocol_id
    INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
    INNER JOIN user_organizations uo_scope ON uo_scope.organization_id = p_scope.organization_id AND uo_scope.user_id = $${userParamIdx}
  `;
}

router.post(
  '/start',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
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
      const { session_id, participant_id } = req.body;
      let project_id = req.body.project_id ? parseInt(req.body.project_id, 10) : null;
      const protocol_id = req.body.protocol_id ? parseInt(req.body.protocol_id, 10) : null;
      if (protocol_id) {
        const protocolProjectId = await getProtocolProjectId(protocol_id);
        if (!protocolProjectId) return res.status(400).json({ error: 'Protocol not found' });
        if (project_id && project_id !== protocolProjectId) {
          return res.status(400).json({ error: 'project_id does not match protocol project' });
        }
        project_id = protocolProjectId;
      }
      if (project_id) {
        const allowed = await ensureProjectAccess(project_id, req.user.sub);
        if (!allowed) return res.status(403).json({ error: 'Access denied for project' });
      }
      const now = new Date();
      const r = await pool.query(
        `INSERT INTO sessions (session_id, participant_id, project_id, protocol_id, started_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id) DO UPDATE SET started_at = $5, updated_at = current_timestamp
         RETURNING id, session_id, participant_id, project_id, protocol_id, started_at, stopped_at, created_at`,
        [session_id, participant_id || null, project_id || null, protocol_id || null, now]
      );
      const row = r.rows[0];
      res.status(201).json({
        ...row,
        session_status: row.stopped_at ? 'completed' : 'in_progress',
        completed_at: row.stopped_at || null
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Start session failed' });
    }
  }
);

router.post(
  '/stop',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
  [body('session_id').trim().notEmpty().isLength({ max: 64 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const now = new Date();
      const access = await pool.query(
        `SELECT s.id
         FROM sessions s
         LEFT JOIN protocols sp ON sp.id = s.protocol_id
         INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
         INNER JOIN user_organizations uo_scope ON uo_scope.organization_id = p_scope.organization_id
         WHERE s.session_id = $1 AND uo_scope.user_id = $2`,
        [req.body.session_id, req.user.sub]
      );
      if (!access.rows[0]) return res.status(404).json({ error: 'Session not found or access denied' });
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
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
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
               q.qc_score, q.validity AS qc_validity
        FROM sessions s
        LEFT JOIN session_qc_summary q ON q.session_id = s.id
        ${scopedJoinAndWhere(1)}
        WHERE 1=1
      `;
      const params = [req.user.sub];
      let i = 2;
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
  '/:id',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id, s.started_at, s.stopped_at, s.created_at,
                CASE WHEN s.stopped_at IS NULL THEN 'in_progress' ELSE 'completed' END AS session_status,
                s.stopped_at AS completed_at,
                q.qc_score, q.validity AS qc_validity, q.fail_reasons, q.payload AS qc_payload
         FROM sessions s
         LEFT JOIN session_qc_summary q ON q.session_id = s.id
         LEFT JOIN protocols sp ON sp.id = s.protocol_id
         INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
         INNER JOIN user_organizations uo_scope ON uo_scope.organization_id = p_scope.organization_id
         WHERE s.id = $1 AND uo_scope.user_id = $2`,
        [req.params.id, req.user.sub]
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
