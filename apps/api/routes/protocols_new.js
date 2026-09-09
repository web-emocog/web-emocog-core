/**
 * Protocols CRUD (Фаза 4.1). StudyProtocol: blocks (instruction, questionnaire, calibration, stimuli, rest, final), order, durations.
 * Файл новый — исходные не удаляем.
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
} = require('../middleware/auth');
const { listProtocolProxyMetrics } = require('./proxy_metrics');
const { validateProtocolAois } = require('../../web/aoi-protocol');
const { validateProtocolSurveyBlocks } = require('../../shared/survey-contract');
const { normalizeMandatoryParticipantShell } = require('../protocol/participant-shell');

const router = express.Router();
router.use(requireAuth);

function rejectInvalidAois(res, definition) {
  const validation = validateProtocolAois(definition);
  if (validation.ok) return false;
  res.status(422).json({
    error: 'Protocol AOI validation failed',
    code: 'protocol_aoi_invalid',
    details: validation.errors,
  });
  return true;
}

function rejectInvalidSurveys(res, definition) {
  const validation = validateProtocolSurveyBlocks(definition);
  if (validation.ok) return false;
  res.status(422).json({
    error: 'Protocol survey validation failed',
    code: 'protocol_survey_invalid',
    details: validation.errors,
  });
  return true;
}

function hasGlobalProtocolAccess(user) {
  return isPlatformAdmin(user);
}

function rejectProtocolConflict(res, err) {
  const protocolIdConflict = err.constraint === 'protocols_project_protocol_id_unique';
  return res.status(409).json({
    error: protocolIdConflict
      ? 'A protocol with this Protocol ID already exists in the project'
      : 'A protocol with this name already exists in the project',
    code: protocolIdConflict ? 'protocol_id_conflict' : 'protocol_name_conflict',
  });
}

router.get(
  '/',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.PROTOCOL_READ),
  [query('project_id').optional().isInt()],
  async (req, res) => {
    try {
      const globalAccess = hasGlobalProtocolAccess(req.user);
      let sql = `
        SELECT pr.id, pr.project_id, pr.name, pr.definition, pr.created_at, pr.updated_at,
               active_invitation.id AS invitation_id,
               active_invitation.code AS invitation_code,
               active_invitation.max_runs AS invitation_max_runs,
               active_invitation.used_runs AS invitation_used_runs,
               active_invitation.expires_at AS invitation_expires_at,
               active_invitation.created_at AS invitation_created_at
        FROM protocols pr
        INNER JOIN projects p ON p.id = pr.project_id
        LEFT JOIN LATERAL (
          SELECT i.id, i.code, i.max_runs, i.used_runs, i.expires_at, i.created_at
          FROM invitations i
          WHERE i.protocol_id = pr.id
            AND (i.expires_at IS NULL OR i.expires_at > current_timestamp)
            AND (i.max_runs IS NULL OR i.used_runs < i.max_runs)
          ORDER BY i.created_at DESC
          LIMIT 1
        ) active_invitation ON true
      `;
      if (!globalAccess) {
        sql += `
          INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id
          INNER JOIN user_projects up ON up.project_id = p.id AND up.user_id = uo.user_id
        `;
      }
      sql += globalAccess ? ' WHERE 1=1' : ' WHERE uo.user_id = $1';
      const params = globalAccess ? [] : [req.user.sub];
      if (req.query.project_id) {
        params.push(req.query.project_id);
        sql += ` AND pr.project_id = $${params.length}`;
      }
      sql += ' ORDER BY pr.updated_at DESC';
      const r = await pool.query(sql, params);
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.post(
  '/',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.PROTOCOL_WRITE),
  [
    body('project_id').isInt(),
    body('name').trim().notEmpty().isLength({ max: 255 }),
    body('definition').isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { project_id, name } = req.body;
      const definition = normalizeMandatoryParticipantShell(req.body.definition);
      if (rejectInvalidAois(res, definition)) return;
      if (rejectInvalidSurveys(res, definition)) return;
      const projectAllowed = await hasProjectMembership(pool, project_id, req.user);
      if (!projectAllowed) return res.status(403).json({ error: 'Not member of project' });
      const r = await pool.query(
        `INSERT INTO protocols (project_id, name, definition) VALUES ($1, $2, $3)
         RETURNING id, project_id, name, definition, created_at, updated_at`,
        [project_id, name, JSON.stringify(definition)]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === '23503') return res.status(400).json({ error: 'Project not found' });
      if (err.code === '23505') return rejectProtocolConflict(res, err);
      console.error(err);
      res.status(500).json({ error: 'Create failed' });
    }
  }
);

router.get(
  '/:id/proxy-metrics',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.ANALYTICS_READ),
  [
    param('id').isInt(),
    query('status').optional().isIn(['not_computed', 'partial', 'computed', 'failed']),
    query('computed_from').optional().isISO8601(),
    query('computed_to').optional().isISO8601(),
    query('metric_name').optional().isString(),
    query('limit').optional().isInt({ min: 1, max: 500 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  listProtocolProxyMetrics
);

router.get(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.PROTOCOL_READ),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const r = hasGlobalProtocolAccess(req.user)
        ? await pool.query(
          `SELECT pr.id, pr.project_id, pr.name, pr.definition, pr.created_at, pr.updated_at
           FROM protocols pr
           WHERE pr.id = $1`,
          [req.params.id]
        )
        : await pool.query(
          `SELECT pr.id, pr.project_id, pr.name, pr.definition, pr.created_at, pr.updated_at
           FROM protocols pr
           INNER JOIN projects p ON p.id = pr.project_id
           INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id
           INNER JOIN user_projects up ON up.project_id = p.id AND up.user_id = uo.user_id
           WHERE pr.id = $1 AND uo.user_id = $2`,
          [req.params.id, req.user.sub]
        );
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.patch(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.PROTOCOL_WRITE),
  [
    param('id').isInt(),
    body('name').optional().trim().notEmpty().isLength({ max: 255 }),
    body('definition').optional().isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const normalizedDefinition = req.body.definition === undefined
        ? undefined
        : normalizeMandatoryParticipantShell(req.body.definition);
      if (normalizedDefinition !== undefined && rejectInvalidAois(res, normalizedDefinition)) return;
      if (normalizedDefinition !== undefined && rejectInvalidSurveys(res, normalizedDefinition)) return;
      const updates = [];
      const values = [];
      let i = 1;
      if (req.body.name !== undefined) {
        updates.push(`name = $${i++}`);
        values.push(req.body.name);
      }
      if (req.body.definition !== undefined) {
        updates.push(`definition = $${i++}`);
        values.push(JSON.stringify(normalizedDefinition));
      }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      let r;
      if (hasGlobalProtocolAccess(req.user)) {
        values.push(req.params.id);
        r = await pool.query(
          `UPDATE protocols
           SET ${updates.join(', ')}, updated_at = current_timestamp
           WHERE id = $${i}
           RETURNING id, project_id, name, definition, updated_at`,
          values
        );
      } else {
        values.push(req.user.sub);
        values.push(req.params.id);
        r = await pool.query(
          `UPDATE protocols pr SET ${updates.join(', ')}, updated_at = current_timestamp
           FROM projects p, user_organizations uo
           WHERE pr.project_id = p.id AND p.organization_id = uo.organization_id AND uo.user_id = $${i} AND pr.id = $${i + 1}
             AND EXISTS (
               SELECT 1 FROM user_projects up
               WHERE up.project_id = p.id AND up.user_id = uo.user_id
             )
           RETURNING pr.id, pr.project_id, pr.name, pr.definition, pr.updated_at`,
          values
        );
      }
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json(r.rows[0]);
    } catch (err) {
      if (err.code === '23505') return rejectProtocolConflict(res, err);
      console.error(err);
      res.status(500).json({ error: 'Update failed' });
    }
  }
);

router.delete(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.PROTOCOL_WRITE),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const r = hasGlobalProtocolAccess(req.user)
        ? await pool.query(
          `DELETE FROM protocols
           WHERE id = $1
           RETURNING id`,
          [req.params.id]
        )
        : await pool.query(
          `DELETE FROM protocols pr
           USING projects p, user_organizations uo
           WHERE pr.project_id = p.id AND p.organization_id = uo.organization_id AND uo.user_id = $1 AND pr.id = $2
             AND EXISTS (
               SELECT 1 FROM user_projects up
               WHERE up.project_id = p.id AND up.user_id = uo.user_id
             )
           RETURNING pr.id`,
          [req.user.sub, req.params.id]
        );
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Delete failed' });
    }
  }
);

module.exports = router;
