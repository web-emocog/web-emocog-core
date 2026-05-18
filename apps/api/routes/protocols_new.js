/**
 * Protocols CRUD (Фаза 4.1). StudyProtocol: blocks (instruction, questionnaire, calibration, stimuli, rest, final), order, durations.
 * Файл новый — исходные не удаляем.
 */
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function hasGlobalProtocolAccess(user) {
  return !!user && (user.bypass_admin === true || user.role === 'admin' || user.role === 'PI');
}

router.get(
  '/',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
  [query('project_id').optional().isInt()],
  async (req, res) => {
    try {
      const globalAccess = hasGlobalProtocolAccess(req.user);
      let sql = `
        SELECT pr.id, pr.project_id, pr.name, pr.definition, pr.created_at, pr.updated_at
        FROM protocols pr
        INNER JOIN projects p ON p.id = pr.project_id
      `;
      if (!globalAccess) {
        sql += ' INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id';
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
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
  [
    body('project_id').isInt(),
    body('name').trim().notEmpty(),
    body('definition').isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { project_id, name, definition } = req.body;
      const check = hasGlobalProtocolAccess(req.user)
        ? await pool.query('SELECT 1 FROM projects WHERE id = $1', [project_id])
        : await pool.query(
          'SELECT 1 FROM projects p INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id WHERE p.id = $1 AND uo.user_id = $2',
          [project_id, req.user.sub]
        );
      if (!check.rows[0]) return res.status(403).json({ error: 'Not member of project organization' });
      const r = await pool.query(
        `INSERT INTO protocols (project_id, name, definition) VALUES ($1, $2, $3)
         RETURNING id, project_id, name, definition, created_at, updated_at`,
        [project_id, name, JSON.stringify(definition)]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === '23503') return res.status(400).json({ error: 'Project not found' });
      console.error(err);
      res.status(500).json({ error: 'Create failed' });
    }
  }
);

router.get(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
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
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
  [
    param('id').isInt(),
    body('name').optional().trim().notEmpty(),
    body('definition').optional().isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const updates = [];
      const values = [];
      let i = 1;
      if (req.body.name !== undefined) {
        updates.push(`name = $${i++}`);
        values.push(req.body.name);
      }
      if (req.body.definition !== undefined) {
        updates.push(`definition = $${i++}`);
        values.push(JSON.stringify(req.body.definition));
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
           RETURNING pr.id, pr.project_id, pr.name, pr.definition, pr.updated_at`,
          values
        );
      }
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Update failed' });
    }
  }
);

router.delete(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
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
