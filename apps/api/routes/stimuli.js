/**
 * Stimuli library API: folders + items (metadata only).
 */
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'));

function hasGlobalStimuliAccess(user) {
  return !!user && (user.bypass_admin === true || user.role === 'admin' || user.role === 'PI');
}

// Local file storage for uploaded stimuli binaries.
const uploadsRoot = path.join(process.cwd(), 'uploads', 'stimuli');
fs.mkdirSync(uploadsRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadsRoot);
  },
  filename: function (_req, file, cb) {
    const original = (file.originalname || 'stimulus').replace(/[^\w.\-]+/g, '_');
    const unique = Date.now() + '_' + Math.random().toString(16).slice(2);
    cb(null, unique + '_' + original);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB safety limit
});

async function ensureProjectAccess(projectId, user) {
  if (hasGlobalStimuliAccess(user)) return true;
  const userId = user?.sub;
  if (!userId) return false;
  const r = await pool.query(
    `SELECT 1
     FROM projects p
     INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id
     WHERE p.id = $1 AND uo.user_id = $2`,
    [projectId, userId]
  );
  return !!r.rows[0];
}

router.get(
  '/folders',
  [query('project_id').isInt({ min: 1 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const projectId = parseInt(req.query.project_id, 10);
      if (!(await ensureProjectAccess(projectId, req.user))) return res.status(403).json({ error: 'Access denied' });
      const r = await pool.query(
        `SELECT id, project_id, name, created_at, updated_at
         FROM stimulus_folders
         WHERE project_id = $1
         ORDER BY created_at DESC`,
        [projectId]
      );
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load folders' });
    }
  }
);

router.post(
  '/folders',
  [body('project_id').isInt({ min: 1 }), body('name').trim().notEmpty().isLength({ max: 255 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const projectId = parseInt(req.body.project_id, 10);
      const name = req.body.name.trim();
      if (!(await ensureProjectAccess(projectId, req.user))) return res.status(403).json({ error: 'Access denied' });
      const r = await pool.query(
        `INSERT INTO stimulus_folders (project_id, name)
         VALUES ($1, $2)
         RETURNING id, project_id, name, created_at, updated_at`,
        [projectId, name]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create folder' });
    }
  }
);

router.patch(
  '/folders/:id',
  [param('id').isInt({ min: 1 }), body('name').trim().notEmpty().isLength({ max: 255 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const folderId = parseInt(req.params.id, 10);
      const folder = await pool.query('SELECT id, project_id FROM stimulus_folders WHERE id = $1', [folderId]);
      if (!folder.rows[0]) return res.status(404).json({ error: 'Folder not found' });
      if (!(await ensureProjectAccess(folder.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });
      const r = await pool.query(
        `UPDATE stimulus_folders
         SET name = $1, updated_at = current_timestamp
         WHERE id = $2
         RETURNING id, project_id, name, created_at, updated_at`,
        [req.body.name.trim(), folderId]
      );
      res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update folder' });
    }
  }
);

router.delete(
  '/folders/:id',
  [param('id').isInt({ min: 1 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const folderId = parseInt(req.params.id, 10);
      const folder = await pool.query('SELECT id, project_id FROM stimulus_folders WHERE id = $1', [folderId]);
      if (!folder.rows[0]) return res.status(404).json({ error: 'Folder not found' });
      if (!(await ensureProjectAccess(folder.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });
      await pool.query('UPDATE stimuli SET folder_id = NULL, updated_at = current_timestamp WHERE folder_id = $1', [folderId]);
      await pool.query('DELETE FROM stimulus_folders WHERE id = $1', [folderId]);
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete folder' });
    }
  }
);

router.get(
  '/',
  [query('project_id').isInt({ min: 1 }), query('folder_id').optional().isInt({ min: 1 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const projectId = parseInt(req.query.project_id, 10);
      if (!(await ensureProjectAccess(projectId, req.user))) return res.status(403).json({ error: 'Access denied' });
      const params = [projectId];
      let sql = `
        SELECT id, project_id, folder_id, name, mime_type, size_bytes, metadata, created_at, updated_at
        FROM stimuli
        WHERE project_id = $1
      `;
      if (req.query.folder_id) {
        params.push(parseInt(req.query.folder_id, 10));
        sql += ` AND folder_id = $${params.length}`;
      }
      sql += ' ORDER BY created_at DESC';
      const r = await pool.query(sql, params);
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load stimuli' });
    }
  }
);

router.post(
  '/',
  [
    body('project_id').isInt({ min: 1 }),
    body('name').trim().notEmpty().isLength({ max: 512 }),
    body('mime_type').optional().isString().isLength({ max: 255 }),
    body('size_bytes').optional().isInt({ min: 0 }),
    body('folder_id').optional({ nullable: true }).isInt({ min: 1 }),
    body('metadata').optional().isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const projectId = parseInt(req.body.project_id, 10);
      if (!(await ensureProjectAccess(projectId, req.user))) return res.status(403).json({ error: 'Access denied' });
      const folderId = req.body.folder_id != null ? parseInt(req.body.folder_id, 10) : null;
      if (folderId != null) {
        const folder = await pool.query('SELECT id, project_id FROM stimulus_folders WHERE id = $1', [folderId]);
        if (!folder.rows[0]) return res.status(400).json({ error: 'Folder not found' });
        if (folder.rows[0].project_id !== projectId) return res.status(400).json({ error: 'Folder project mismatch' });
      }
      const r = await pool.query(
        `INSERT INTO stimuli (project_id, folder_id, name, mime_type, size_bytes, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, project_id, folder_id, name, mime_type, size_bytes, metadata, created_at, updated_at`,
        [
          projectId,
          folderId,
          req.body.name.trim(),
          req.body.mime_type || null,
          req.body.size_bytes != null ? parseInt(req.body.size_bytes, 10) : null,
          JSON.stringify(req.body.metadata || {}),
        ]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create stimulus' });
    }
  }
);

router.post(
  '/upload',
  upload.single('file'),
  [
    body('project_id').isInt({ min: 1 }),
    body('name').optional().trim().notEmpty().isLength({ max: 512 }),
    body('folder_id').optional({ nullable: true }).custom((v) => {
      if (v === '' || v == null) return true; // allow empty
      const s = String(v);
      return /^\d+$/.test(s);
    }),
    body('metadata').optional().custom((v) => {
      if (v === '' || v == null) return true;
      try { JSON.parse(v); return true; } catch (_e) { throw new Error('metadata must be valid JSON'); }
    }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const projectId = parseInt(req.body.project_id, 10);
      if (!(await ensureProjectAccess(projectId, req.user))) return res.status(403).json({ error: 'Access denied' });

      const folderId = req.body.folder_id != null && String(req.body.folder_id).trim() !== ''
        ? parseInt(req.body.folder_id, 10)
        : null;

      if (folderId != null) {
        const folder = await pool.query('SELECT id, project_id FROM stimulus_folders WHERE id = $1', [folderId]);
        if (!folder.rows[0]) return res.status(400).json({ error: 'Folder not found' });
        if (folder.rows[0].project_id !== projectId) return res.status(400).json({ error: 'Folder project mismatch' });
      }

      const name = (req.body.name != null ? String(req.body.name) : req.file.originalname || '').trim();
      if (!name) return res.status(400).json({ error: 'Stimulus name is required' });

      let metadata = {};
      if (req.body.metadata != null && String(req.body.metadata).trim() !== '') {
        metadata = JSON.parse(req.body.metadata);
      }

      const relPath = path.relative(uploadsRoot, req.file.path);
      metadata = {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        content_path: relPath,
      };

      const r = await pool.query(
        `INSERT INTO stimuli (project_id, folder_id, name, mime_type, size_bytes, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, project_id, folder_id, name, mime_type, size_bytes, metadata, created_at, updated_at`,
        [
          projectId,
          folderId,
          name,
          req.file.mimetype || null,
          req.file.size != null ? parseInt(req.file.size, 10) : null,
          JSON.stringify(metadata || {}),
        ]
      );

      res.status(201).json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to upload stimulus' });
    }
  }
);

router.get(
  '/:id/content',
  [param('id').isInt({ min: 1 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const stimulusId = parseInt(req.params.id, 10);
      const current = await pool.query('SELECT id, project_id, name, mime_type, metadata FROM stimuli WHERE id = $1', [stimulusId]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Stimulus not found' });
      if (!(await ensureProjectAccess(current.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });

      const stim = current.rows[0];
      const metadata = stim.metadata || {};
      const contentRel = metadata.content_path || metadata.contentPath || null;
      if (!contentRel) return res.status(404).json({ error: 'Stimulus binary not found' });

      const absPath = path.join(uploadsRoot, String(contentRel));
      if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Stimulus binary missing on disk' });

      const download = String(req.query.download || '') === '1';
      res.setHeader('Content-Type', stim.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', (download ? 'attachment' : 'inline') + '; filename="' + stim.name + '"');
      res.sendFile(absPath);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to serve stimulus content' });
    }
  }
);

router.get(
  '/:id/preview',
  [param('id').isInt({ min: 1 })],
  async (req, res) => {
    try {
      const stimulusId = parseInt(req.params.id, 10);
      const r = await pool.query('SELECT id, project_id, name, mime_type, metadata FROM stimuli WHERE id = $1', [stimulusId]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Stimulus not found' });
      const stim = r.rows[0];
      if (!(await ensureProjectAccess(stim.project_id, req.user))) return res.status(403).json({ error: 'Access denied' });

      const metadata = stim.metadata || {};
      const contentRel = metadata.content_path || metadata.contentPath || null;
      const isImage = typeof stim.mime_type === 'string' && stim.mime_type.startsWith('image/');

      if (contentRel && isImage) {
        // For images return inline file.
        const absPath = path.join(uploadsRoot, String(contentRel));
        if (fs.existsSync(absPath)) {
          res.setHeader('Content-Type', stim.mime_type);
          res.setHeader('Content-Disposition', 'inline; filename="' + stim.name + '"');
          return res.sendFile(absPath);
        }
      }

      // For other formats just give clients a URL for download.
      res.json({
        id: stim.id,
        name: stim.name,
        mime_type: stim.mime_type,
        content_url: `/stimuli/${stimulusId}/content`
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to preview stimulus' });
    }
  }
);

router.patch(
  '/:id',
  [
    param('id').isInt({ min: 1 }),
    body('name').optional().trim().notEmpty().isLength({ max: 512 }),
    body('folder_id').optional({ nullable: true }).custom((v) => v === null || Number.isInteger(v) || /^\d+$/.test(String(v))),
    body('metadata').optional().isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const stimulusId = parseInt(req.params.id, 10);
      const current = await pool.query('SELECT id, project_id, folder_id FROM stimuli WHERE id = $1', [stimulusId]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Stimulus not found' });
      if (!(await ensureProjectAccess(current.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });

      const updates = [];
      const values = [];
      let i = 1;
      if (req.body.name !== undefined) { updates.push(`name = $${i++}`); values.push(req.body.name.trim()); }
      if (req.body.folder_id !== undefined) {
        const folderId = req.body.folder_id == null || req.body.folder_id === '' ? null : parseInt(req.body.folder_id, 10);
        if (folderId != null) {
          const folder = await pool.query('SELECT id, project_id FROM stimulus_folders WHERE id = $1', [folderId]);
          if (!folder.rows[0]) return res.status(400).json({ error: 'Folder not found' });
          if (folder.rows[0].project_id !== current.rows[0].project_id) return res.status(400).json({ error: 'Folder project mismatch' });
        }
        updates.push(`folder_id = $${i++}`);
        values.push(folderId);
      }
      if (req.body.metadata !== undefined) { updates.push(`metadata = $${i++}::jsonb`); values.push(JSON.stringify(req.body.metadata || {})); }
      if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

      values.push(stimulusId);
      const r = await pool.query(
        `UPDATE stimuli
         SET ${updates.join(', ')}, updated_at = current_timestamp
         WHERE id = $${i}
         RETURNING id, project_id, folder_id, name, mime_type, size_bytes, metadata, created_at, updated_at`,
        values
      );
      res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update stimulus' });
    }
  }
);

router.delete(
  '/:id',
  [param('id').isInt({ min: 1 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const stimulusId = parseInt(req.params.id, 10);
      const current = await pool.query('SELECT id, project_id, name, mime_type, metadata FROM stimuli WHERE id = $1', [stimulusId]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Stimulus not found' });
      if (!(await ensureProjectAccess(current.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });

      const stim = current.rows[0];
      const metadata = stim.metadata || {};
      const contentRel = metadata.content_path || metadata.contentPath || null;
      if (contentRel) {
        const absPath = path.join(uploadsRoot, String(contentRel));
        try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (_e) { /* ignore */ }
      }
      await pool.query('DELETE FROM stimuli WHERE id = $1', [stimulusId]);
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete stimulus' });
    }
  }
);

module.exports = router;
