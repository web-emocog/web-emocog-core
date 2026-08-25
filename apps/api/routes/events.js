/**
 * Приём батчей событий (Фаза 2.4). POST /events/batch.
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db');
const {
  requireAuth,
  requireRole,
  requireOperation,
  OPERATIONS,
  hasProjectMembership,
} = require('../middleware/auth');

const router = express.Router();

router.post(
  '/batch',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_WRITE),
  [
    body('session_id').trim().notEmpty().isLength({ max: 64 }),
    body('participant_id').optional().trim().isLength({ max: 64 }),
    body('project_id').optional().isInt({ min: 1 }),
    body('protocol_id').optional().isInt({ min: 1 }),
    body('events').isArray().isLength({ max: 1000 }),
    body('events.*').isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { session_id, participant_id, events } = req.body;
      const projectIdInput = req.body.project_id != null ? parseInt(req.body.project_id, 10) : null;
      const protocolIdInput = req.body.protocol_id != null ? parseInt(req.body.protocol_id, 10) : null;

      async function ensureProjectAccess(projectId) {
        return hasProjectMembership(pool, projectId, req.user);
      }

      async function protocolProjectId(protocolId) {
        const r = await pool.query('SELECT project_id FROM protocols WHERE id = $1', [protocolId]);
        return r.rows[0] ? r.rows[0].project_id : null;
      }

      const sessionRow = await pool.query(
        `SELECT s.id, s.project_id, s.protocol_id
         FROM sessions s
         WHERE s.session_id = $1`,
        [session_id]
      );
      let dbSessionId;
      if (sessionRow.rows[0]) {
        const row = sessionRow.rows[0];
        const effectiveProject = row.project_id || (row.protocol_id ? await protocolProjectId(row.protocol_id) : null);
        if (!effectiveProject || !(await ensureProjectAccess(effectiveProject))) {
          return res.status(403).json({ error: 'Access denied for session project' });
        }
        dbSessionId = sessionRow.rows[0].id;
      } else {
        let effectiveProjectId = projectIdInput;
        if (protocolIdInput) {
          const pid = await protocolProjectId(protocolIdInput);
          if (!pid) return res.status(400).json({ error: 'Protocol not found' });
          if (effectiveProjectId && effectiveProjectId !== pid) {
            return res.status(400).json({ error: 'project_id does not match protocol project' });
          }
          effectiveProjectId = pid;
        }
        if (!effectiveProjectId) {
          return res.status(400).json({ error: 'project_id or protocol_id required for new session' });
        }
        if (!(await ensureProjectAccess(effectiveProjectId))) {
          return res.status(403).json({ error: 'Access denied for project' });
        }
        const ins = await pool.query(
          `INSERT INTO sessions (session_id, participant_id, project_id, protocol_id, started_at)
           VALUES ($1, $2, $3, $4, current_timestamp)
           RETURNING id`,
          [session_id, participant_id || null, effectiveProjectId, protocolIdInput || null]
        );
        dbSessionId = ins.rows[0].id;
      }

      if (events.length === 0) {
        return res.status(201).json({ session_id, inserted: 0 });
      }

      const values = events.map((e, i) => {
        const offset = i * 2;
        return `($${offset + 1}, $${offset + 2}::jsonb)`;
      }).join(', ');
      const flat = events.flatMap(e => [dbSessionId, JSON.stringify(e)]);
      await pool.query(
        `INSERT INTO events (session_id, payload) VALUES ${values}`,
        flat
      );
      res.status(201).json({ session_id, inserted: events.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Events batch failed' });
    }
  }
);

module.exports = router;
