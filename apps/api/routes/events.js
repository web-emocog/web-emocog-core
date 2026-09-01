/**
 * Приём батчей событий (Фаза 2.4). POST /events/batch.
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db');
const config = require('../config');
const { withTransaction } = require('../db/transaction');
const { insertEventPayloadsInChunks } = require('../db/bulk-insert');
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

      const outcome = await withTransaction(pool, async (client) => {
        async function projectAccess(projectId) {
          return hasProjectMembership(client, projectId, req.user);
        }
        async function projectForProtocol(protocolId) {
          const result = await client.query(
            'SELECT project_id FROM protocols WHERE id = $1',
            [protocolId]
          );
          return result.rows[0] ? result.rows[0].project_id : null;
        }

        const sessionRow = await client.query(
          `SELECT s.id, s.project_id, s.protocol_id
           FROM sessions s
           WHERE s.session_id = $1
           FOR UPDATE`,
          [session_id]
        );
        let dbSessionId;
        if (sessionRow.rows[0]) {
          const row = sessionRow.rows[0];
          const effectiveProject = row.project_id
            || (row.protocol_id ? await projectForProtocol(row.protocol_id) : null);
          if (!effectiveProject || !(await projectAccess(effectiveProject))) {
            const error = new Error('Access denied for session project');
            error.status = 403;
            throw error;
          }
          dbSessionId = row.id;
        } else {
          let effectiveProjectId = projectIdInput;
          if (protocolIdInput) {
            const projectId = await projectForProtocol(protocolIdInput);
            if (!projectId) {
              const error = new Error('Protocol not found');
              error.status = 400;
              throw error;
            }
            if (effectiveProjectId && effectiveProjectId !== projectId) {
              const error = new Error('project_id does not match protocol project');
              error.status = 400;
              throw error;
            }
            effectiveProjectId = projectId;
          }
          if (!effectiveProjectId) {
            const error = new Error('project_id or protocol_id required for new session');
            error.status = 400;
            throw error;
          }
          if (!(await projectAccess(effectiveProjectId))) {
            const error = new Error('Access denied for project');
            error.status = 403;
            throw error;
          }
          const insertedSession = await client.query(
            `INSERT INTO sessions (session_id, participant_id, project_id, protocol_id, started_at)
             VALUES ($1, $2, $3, $4, current_timestamp)
             RETURNING id`,
            [session_id, participant_id || null, effectiveProjectId, protocolIdInput || null]
          );
          dbSessionId = insertedSession.rows[0].id;
        }

        const inserted = await insertEventPayloadsInChunks(client, {
          sessionId: dbSessionId,
          events,
          batchSize: config.database.bulkInsertBatchSize,
        });
        return { inserted };
      });
      return res.status(201).json({ session_id, inserted: outcome.inserted });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error(err);
      return res.status(500).json({ error: 'Events batch failed' });
    }
  }
);

module.exports = router;
