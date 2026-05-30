/**
 * Projects CRUD (Фаза 2.3). Привязка к организациям.
 */
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listProjectProxyMetrics } = require('./proxy_metrics');

const router = express.Router();
router.use(requireAuth);

function hasGlobalProjectAccess(user) {
  return !!user && (user.bypass_admin === true || user.role === 'admin' || user.role === 'PI');
}

router.get(
  '/',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
  [query('organization_id').optional().isInt()],
  async (req, res) => {
    try {
      const globalAccess = hasGlobalProjectAccess(req.user);
      let sql = `
        SELECT p.id, p.organization_id, p.name, p.slug, p.created_at, o.name AS organization_name
        FROM projects p
        INNER JOIN organizations o ON o.id = p.organization_id
      `;
      if (!globalAccess) {
        sql += ' INNER JOIN user_organizations uo ON uo.organization_id = o.id';
      }
      sql += globalAccess ? ' WHERE 1=1' : ' WHERE uo.user_id = $1';
      const params = globalAccess ? [] : [req.user.sub];
      if (req.query.organization_id) {
        params.push(req.query.organization_id);
        sql += ` AND p.organization_id = $${params.length}`;
      }
      sql += ' ORDER BY p.name';
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
  requireRole('admin', 'PI', 'researcher'),
  [body('organization_id').isInt(), body('name').trim().notEmpty(), body('slug').trim().notEmpty().matches(/^[a-z0-9-]+$/)],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { organization_id, name, slug } = req.body;
      const check = hasGlobalProjectAccess(req.user)
        ? await pool.query('SELECT 1 FROM organizations WHERE id = $1', [organization_id])
        : await pool.query(
          'SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
          [req.user.sub, organization_id]
        );
      if (!check.rows[0]) return res.status(403).json({ error: 'Not member of organization' });
      const r = await pool.query(
        'INSERT INTO projects (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id, organization_id, name, slug, created_at',
        [organization_id, name, slug]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === '23503') return res.status(400).json({ error: 'Organization not found' });
      if (err.code === '23505') return res.status(409).json({ error: 'Project slug already exists in organization' });
      console.error(err);
      res.status(500).json({ error: 'Create failed' });
    }
  }
);

router.get(
  '/:id/proxy-metrics',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
  [
    param('id').isInt(),
    query('protocol_id').optional().isInt(),
    query('status').optional().isIn(['not_computed', 'partial', 'computed', 'failed']),
    query('computed_from').optional().isISO8601(),
    query('computed_to').optional().isISO8601(),
    query('metric_name').optional().isString(),
    query('limit').optional().isInt({ min: 1, max: 500 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  listProjectProxyMetrics
);

router.get(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const r = hasGlobalProjectAccess(req.user)
        ? await pool.query(
          `SELECT p.id, p.organization_id, p.name, p.slug, p.created_at, o.name AS organization_name
           FROM projects p
           INNER JOIN organizations o ON o.id = p.organization_id
           WHERE p.id = $1`,
          [req.params.id]
        )
        : await pool.query(
          `SELECT p.id, p.organization_id, p.name, p.slug, p.created_at, o.name AS organization_name
           FROM projects p
           INNER JOIN organizations o ON o.id = p.organization_id
           INNER JOIN user_organizations uo ON uo.organization_id = o.id
           WHERE p.id = $1 AND uo.user_id = $2`,
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
  requireRole('admin', 'PI', 'researcher'),
  [param('id').isInt(), body('name').optional().trim().notEmpty(), body('slug').optional().trim().matches(/^[a-z0-9-]+$/)],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const updates = [];
      const values = [];
      let i = 1;
      if (req.body.name !== undefined) { updates.push(`name = $${i++}`); values.push(req.body.name); }
      if (req.body.slug !== undefined) { updates.push(`slug = $${i++}`); values.push(req.body.slug); }
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(req.params.id);
      const r = hasGlobalProjectAccess(req.user)
        ? await pool.query(
          `UPDATE projects
           SET ${updates.join(', ')}, updated_at = current_timestamp
           WHERE id = $${i}
           RETURNING id, organization_id, name, slug, updated_at`,
          values
        )
        : await pool.query(
          `UPDATE projects p SET ${updates.join(', ')}, updated_at = current_timestamp
           FROM user_organizations uo
           WHERE p.organization_id = uo.organization_id AND uo.user_id = $${i} AND p.id = $${i + 1}
           RETURNING p.id, p.organization_id, p.name, p.slug, p.updated_at`,
          [...values, req.user.sub]
        );
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json(r.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
      console.error(err);
      res.status(500).json({ error: 'Update failed' });
    }
  }
);

router.delete(
  '/:id',
  requireRole('admin', 'PI'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const r = hasGlobalProjectAccess(req.user)
        ? await pool.query(
          `DELETE FROM projects
           WHERE id = $1
           RETURNING id`,
          [req.params.id]
        )
        : await pool.query(
          `DELETE FROM projects p
           USING user_organizations uo
           WHERE p.organization_id = uo.organization_id AND uo.user_id = $1 AND p.id = $2
           RETURNING p.id`,
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
