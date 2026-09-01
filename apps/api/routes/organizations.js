/**
 * Organizations CRUD (Фаза 2.3).
 */
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { withTransaction } = require('../db/transaction');
const {
  requireAuth,
  requireRole,
  requireOperation,
  requirePlatformAdmin,
  OPERATIONS,
  isPlatformAdmin,
  hasOrganizationMembership,
} = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'), requireOperation(OPERATIONS.ORGANIZATION_READ), async (req, res) => {
  try {
    const r = isPlatformAdmin(req.user)
      ? await pool.query('SELECT id, name, slug, created_at FROM organizations ORDER BY name')
      : await pool.query(
        `SELECT o.id, o.name, o.slug, o.created_at
         FROM organizations o
         INNER JOIN user_organizations uo ON uo.organization_id = o.id
         WHERE uo.user_id = $1
         ORDER BY o.name`,
        [req.user.sub]
      );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post(
  '/',
  requirePlatformAdmin,
  [body('name').trim().notEmpty(), body('slug').trim().notEmpty().matches(/^[a-z0-9-]+$/)],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { name, slug } = req.body;
      const org = await withTransaction(pool, async client => {
        const r = await client.query(
          'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug, created_at',
          [name, slug]
        );
        await client.query(
          'INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, $3)',
          [req.user.sub, r.rows[0].id, 'member']
        );
        return r.rows[0];
      });
      res.status(201).json(org);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
      console.error(err);
      res.status(500).json({ error: 'Create failed' });
    }
  }
);

router.get(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.ORGANIZATION_READ),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const allowed = await hasOrganizationMembership(pool, req.params.id, req.user);
      if (!allowed) return res.status(404).json({ error: 'Not found' });
      const r = await pool.query(
        'SELECT id, name, slug, created_at FROM organizations WHERE id = $1',
        [req.params.id]
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
  requireRole('admin', 'PI'),
  requireOperation(OPERATIONS.ORGANIZATION_MANAGE),
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
      const allowed = await hasOrganizationMembership(pool, req.params.id, req.user);
      if (!allowed) return res.status(404).json({ error: 'Not found' });
      values.push(req.params.id);
      const r = await pool.query(
        `UPDATE organizations SET ${updates.join(', ')}, updated_at = current_timestamp
         WHERE id = $${i} RETURNING id, name, slug, updated_at`,
        values
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
  requirePlatformAdmin,
  [param('id').isInt()],
  async (req, res) => {
    try {
      const allowed = await hasOrganizationMembership(pool, req.params.id, req.user);
      if (!allowed) return res.status(404).json({ error: 'Not found' });
      const r = await pool.query('DELETE FROM organizations WHERE id = $1 RETURNING id', [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Delete failed' });
    }
  }
);

module.exports = router;
