/**
 * Stimuli library API: folders + items (metadata only).
 */
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const {
  requireAuth,
  requireRole,
  requireOperation,
  OPERATIONS,
  hasProjectMembership,
} = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const { withTransaction } = require('../db/transaction');
const {
  ConversionError,
  DOCUMENT_MIME_TYPES,
  cleanupConversion,
  convertDocument,
} = require('../stimuli/document-converter');
const {
  resolveServerOwnedUploadPath,
  resolveReadableServerOwnedUploadPath,
  rejectClientOwnedContentPath,
  getStoredContentPath,
  contentDisposition,
} = require('../security/upload-paths');
const {
  ALLOWED_UPLOAD_MIME_TYPES,
  INLINE_MEDIA_TYPES,
  verifyUploadedFileType,
} = require('../security/stimulus-files');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'));
router.use((req, res, next) => {
  const operation = req.method === 'GET'
    ? OPERATIONS.STIMULUS_READ
    : OPERATIONS.STIMULUS_WRITE;
  return requireOperation(operation)(req, res, next);
});

// Local file storage for uploaded stimuli binaries.
const uploadsRoot = path.join(config.storage.uploadsRoot, 'stimuli');
fs.mkdirSync(uploadsRoot, { recursive: true });
const conversionIncomingRoot = path.join(uploadsRoot, '.incoming');
fs.mkdirSync(conversionIncomingRoot, { recursive: true, mode: 0o700 });

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadsRoot);
  },
  filename: function (_req, file, cb) {
    const original = (file.originalname || 'stimulus').replace(/[^\w.\-]+/g, '_');
    const unique = crypto.randomUUID();
    cb(null, unique + '_' + original);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.storage.maxUploadBytes, files: 1 },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
      const error = new Error('Unsupported stimulus media type');
      error.code = 'UNSUPPORTED_STIMULUS_MEDIA_TYPE';
      return callback(error);
    }
    return callback(null, true);
  }
});

const documentUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      callback(null, conversionIncomingRoot);
    },
    filename(_req, file, callback) {
      const extension = path.extname(String(file.originalname || '')).toLowerCase();
      callback(null, `${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: config.storage.conversion.maxDocumentBytes, files: 1 },
  fileFilter(_req, file, callback) {
    if (!DOCUMENT_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
      const error = new ConversionError(415, 'Unsupported document media type', 'document_mime_unsupported');
      return callback(error);
    }
    return callback(null, true);
  },
});

function publicStimulus(row) {
  const metadata = row?.metadata && typeof row.metadata === 'object'
    ? { ...row.metadata }
    : {};
  delete metadata.content_path;
  return {
    ...row,
    metadata,
    content_url: `/stimuli/${row.id}/content`,
    preview_url: `/stimuli/${row.id}/preview`,
  };
}

async function publicStimulusWithAvailability(row) {
  const result = publicStimulus(row);
  const resolved = await resolveReadableServerOwnedUploadPath(
    uploadsRoot,
    getStoredContentPath(row?.metadata)
  );
  return {
    ...result,
    content_available: resolved.ok,
    ...(resolved.ok ? {} : { content_error: resolved.code }),
  };
}

async function removeIncomingDocument(file) {
  if (!file?.path) return;
  const relative = path.relative(conversionIncomingRoot, file.path);
  const resolved = resolveServerOwnedUploadPath(conversionIncomingRoot, relative);
  if (!resolved.ok) return;
  await fs.promises.unlink(resolved.absolutePath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function removeUploadedFile(file) {
  if (!file?.path) return;
  const relativePath = path.relative(uploadsRoot, file.path);
  const resolved = resolveServerOwnedUploadPath(uploadsRoot, relativePath);
  if (!resolved.ok) return;
  try {
    await fs.promises.unlink(resolved.absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function resolveStoredPath(metadata) {
  const contentPath = getStoredContentPath(metadata);
  if (!contentPath) return { ok: false, code: 'missing_content_path' };
  return resolveServerOwnedUploadPath(uploadsRoot, String(contentPath));
}

async function ensureProjectAccess(projectId, user) {
  return hasProjectMembership(pool, projectId, user);
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
      res.json(await Promise.all(r.rows.map(publicStimulusWithAvailability)));
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
      const metadataPolicy = rejectClientOwnedContentPath(req.body.metadata);
      if (!metadataPolicy.ok) {
        return res.status(422).json({ error: metadataPolicy.error, code: metadataPolicy.code });
      }
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
      res.status(201).json(publicStimulus(r.rows[0]));
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
    let fileStored = false;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ errors: errors.array() });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const uploadedRelativePath = path.relative(uploadsRoot, req.file.path);
      if (!(await verifyUploadedFileType(uploadsRoot, uploadedRelativePath, req.file.mimetype))) {
        await removeUploadedFile(req.file);
        return res.status(415).json({
          error: 'Uploaded bytes do not match the declared media type',
          code: 'stimulus_media_signature_mismatch',
        });
      }

      const projectId = parseInt(req.body.project_id, 10);
      if (!(await ensureProjectAccess(projectId, req.user))) {
        await removeUploadedFile(req.file);
        return res.status(403).json({ error: 'Access denied' });
      }

      const folderId = req.body.folder_id != null && String(req.body.folder_id).trim() !== ''
        ? parseInt(req.body.folder_id, 10)
        : null;

      if (folderId != null) {
        const folder = await pool.query('SELECT id, project_id FROM stimulus_folders WHERE id = $1', [folderId]);
        if (!folder.rows[0]) {
          await removeUploadedFile(req.file);
          return res.status(400).json({ error: 'Folder not found' });
        }
        if (folder.rows[0].project_id !== projectId) {
          await removeUploadedFile(req.file);
          return res.status(400).json({ error: 'Folder project mismatch' });
        }
      }

      const name = (req.body.name != null ? String(req.body.name) : req.file.originalname || '').trim();
      if (!name) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ error: 'Stimulus name is required' });
      }

      let metadata = {};
      if (req.body.metadata != null && String(req.body.metadata).trim() !== '') {
        metadata = JSON.parse(req.body.metadata);
      }
      const metadataPolicy = rejectClientOwnedContentPath(metadata);
      if (!metadataPolicy.ok) {
        await removeUploadedFile(req.file);
        return res.status(422).json({ error: metadataPolicy.error, code: metadataPolicy.code });
      }

      const relPath = path.relative(uploadsRoot, req.file.path);
      const resolvedUpload = resolveServerOwnedUploadPath(uploadsRoot, relPath);
      if (!resolvedUpload.ok) {
        await removeUploadedFile(req.file);
        return res.status(500).json({ error: 'Server generated an invalid upload path' });
      }
      metadata = {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        content_path: resolvedUpload.relativePath,
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

      fileStored = true;
      res.status(201).json({ ...publicStimulus(r.rows[0]), content_available: true });
    } catch (err) {
      if (!fileStored) {
        try {
          await removeUploadedFile(req.file);
        } catch (cleanupError) {
          console.error(cleanupError);
        }
      }
      console.error(err);
      res.status(500).json({ error: 'Failed to upload stimulus' });
    }
  }
);

router.post(
  '/convert',
  documentUpload.single('file'),
  [
    body('project_id').isInt({ min: 1 }),
    body('folder_id').optional({ nullable: true }).custom(value => (
      value === '' || value == null || /^\d+$/.test(String(value))
    )),
  ],
  async (req, res) => {
    let conversion = null;
    const promotedFiles = [];
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      if (!req.file) return res.status(400).json({ error: 'Document file is required', code: 'document_missing' });
      const projectId = Number.parseInt(req.body.project_id, 10);
      const folderId = req.body.folder_id != null && String(req.body.folder_id).trim() !== ''
        ? Number.parseInt(req.body.folder_id, 10)
        : null;
      if (!(await ensureProjectAccess(projectId, req.user))) {
        return res.status(403).json({ error: 'Access denied', code: 'project_access_denied' });
      }
      conversion = await convertDocument({
        inputPath: req.file.path,
        originalName: req.file.originalname,
        declaredMime: req.file.mimetype,
        uploadsRoot,
        maxBytes: config.storage.conversion.maxDocumentBytes,
        maxPages: config.storage.conversion.maxPages,
        timeoutMs: config.storage.conversion.timeoutMs,
        dpi: config.storage.conversion.dpi,
        maxConcurrent: config.storage.conversion.maxConcurrent,
        libreOfficeBin: config.storage.conversion.libreOfficeBin,
        pdfInfoBin: config.storage.conversion.pdfInfoBin,
        pdfToPpmBin: config.storage.conversion.pdfToPpmBin,
      });
      const sourceBase = path.basename(String(req.file.originalname || 'document'))
        .replace(/[\r\n]/g, '_')
        .slice(0, 180);
      const stem = sourceBase.replace(/\.[^.]+$/, '').slice(0, 120) || 'document';
      const rows = await withTransaction(pool, async client => {
        if (!(await hasProjectMembership(client, projectId, req.user))) {
          throw new ConversionError(403, 'Access denied', 'project_access_denied');
        }
        if (folderId != null) {
          const folder = await client.query(
            'SELECT id FROM stimulus_folders WHERE id = $1 AND project_id = $2 FOR SHARE',
            [folderId, projectId]
          );
          if (!folder.rows[0]) throw new ConversionError(400, 'Folder project mismatch', 'folder_project_mismatch');
        }
        const insertedRows = [];
        for (let index = 0; index < conversion.pages.length; index += 1) {
          const finalName = `${crypto.randomUUID()}_page_${index + 1}.jpg`;
          const finalResolved = resolveServerOwnedUploadPath(uploadsRoot, finalName);
          if (!finalResolved.ok) throw new Error('Server generated an invalid content path');
          await fs.promises.rename(conversion.pages[index], finalResolved.absolutePath);
          promotedFiles.push(finalResolved.absolutePath);
          const stat = await fs.promises.stat(finalResolved.absolutePath);
          const metadata = {
            content_path: finalResolved.relativePath,
            source_document_name: sourceBase,
            source_page: index + 1,
            source_page_count: conversion.pageCount,
            conversion_dpi: config.storage.conversion.dpi,
            conversion_engine: 'libreoffice_poppler',
          };
          const inserted = await client.query(
            `INSERT INTO stimuli (project_id, folder_id, name, mime_type, size_bytes, metadata)
             VALUES ($1, $2, $3, 'image/jpeg', $4, $5::jsonb)
             RETURNING id, project_id, folder_id, name, mime_type, size_bytes,
                       metadata, created_at, updated_at`,
            [
              projectId,
              folderId,
              `${stem}_page_${index + 1}.jpg`,
              stat.size,
              JSON.stringify(metadata),
            ]
          );
          insertedRows.push(inserted.rows[0]);
        }
        return insertedRows;
      });
      return res.status(201).json({
        source: { name: sourceBase, page_count: conversion.pageCount },
        stimuli: rows.map(row => ({ ...publicStimulus(row), content_available: true })),
      });
    } catch (error) {
      await Promise.allSettled(promotedFiles.map(file => fs.promises.unlink(file)));
      if (error instanceof ConversionError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      console.error(error);
      return res.status(500).json({ error: 'Document conversion failed', code: 'document_conversion_failed' });
    } finally {
      await Promise.allSettled([
        cleanupConversion(conversion),
        removeIncomingDocument(req.file),
      ]);
    }
  }
);

router.post(
  '/:id/content',
  upload.single('file'),
  [param('id').isInt({ min: 1 })],
  async (req, res) => {
    let fileStored = false;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ errors: errors.array() });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const uploadedRelativePath = path.relative(uploadsRoot, req.file.path);
      if (!(await verifyUploadedFileType(uploadsRoot, uploadedRelativePath, req.file.mimetype))) {
        await removeUploadedFile(req.file);
        return res.status(415).json({
          error: 'Uploaded bytes do not match the declared media type',
          code: 'stimulus_media_signature_mismatch',
        });
      }

      const stimulusId = parseInt(req.params.id, 10);
      const current = await pool.query(
        'SELECT id, project_id, name, mime_type, metadata FROM stimuli WHERE id = $1',
        [stimulusId]
      );
      const stimulus = current.rows[0];
      if (!stimulus) {
        await removeUploadedFile(req.file);
        return res.status(404).json({ error: 'Stimulus not found' });
      }
      if (!(await ensureProjectAccess(stimulus.project_id, req.user))) {
        await removeUploadedFile(req.file);
        return res.status(403).json({ error: 'Access denied' });
      }

      const relativePath = path.relative(uploadsRoot, req.file.path);
      const replacement = resolveServerOwnedUploadPath(uploadsRoot, relativePath);
      if (!replacement.ok) {
        await removeUploadedFile(req.file);
        return res.status(500).json({ error: 'Server generated an invalid upload path' });
      }
      const previous = resolveStoredPath(stimulus.metadata);
      const metadata = {
        ...(stimulus.metadata && typeof stimulus.metadata === 'object' ? stimulus.metadata : {}),
        content_path: replacement.relativePath,
      };
      const updated = await pool.query(
        `UPDATE stimuli
         SET mime_type = $1, size_bytes = $2, metadata = $3::jsonb, updated_at = current_timestamp
         WHERE id = $4
         RETURNING id, project_id, folder_id, name, mime_type, size_bytes, metadata, created_at, updated_at`,
        [req.file.mimetype || null, req.file.size, JSON.stringify(metadata), stimulusId]
      );
      fileStored = true;

      if (previous.ok && previous.absolutePath !== replacement.absolutePath) {
        await fs.promises.unlink(previous.absolutePath).catch(error => {
          if (error.code !== 'ENOENT') console.error(error);
        });
      }
      return res.json({ ...publicStimulus(updated.rows[0]), content_available: true });
    } catch (error) {
      if (!fileStored) await removeUploadedFile(req.file).catch(cleanupError => console.error(cleanupError));
      console.error(error);
      return res.status(500).json({ error: 'Failed to replace stimulus content' });
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
      const contentPath = getStoredContentPath(stim.metadata);
      const resolved = await resolveReadableServerOwnedUploadPath(uploadsRoot, contentPath);
      if (!resolved.ok) {
        const status = resolved.code === 'content_file_missing' ? 404 : 422;
        return res.status(status).json({ error: 'Stimulus binary is unavailable', code: resolved.code });
      }

      const download = String(req.query.download || '') === '1';
      res.setHeader('Content-Type', stim.mime_type || 'application/octet-stream');
      const inlineAllowed = INLINE_MEDIA_TYPES.has(String(stim.mime_type || '').toLowerCase());
      res.setHeader(
        'Content-Disposition',
        contentDisposition(download || !inlineAllowed ? 'attachment' : 'inline', stim.name)
      );
      res.sendFile(resolved.absolutePath);
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

      const isImage = typeof stim.mime_type === 'string' && stim.mime_type.startsWith('image/');

      if (getStoredContentPath(stim.metadata) && isImage) {
        const resolved = await resolveReadableServerOwnedUploadPath(
          uploadsRoot,
          getStoredContentPath(stim.metadata)
        );
        if (resolved.ok) {
          res.setHeader('Content-Type', stim.mime_type);
          res.setHeader('Content-Disposition', contentDisposition('inline', stim.name));
          return res.sendFile(resolved.absolutePath);
        }
        // Missing or unsafe previews fall through to the authenticated content URL.
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
      const current = await pool.query('SELECT id, project_id, folder_id, metadata FROM stimuli WHERE id = $1', [stimulusId]);
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
      if (req.body.metadata !== undefined) {
        const metadataPolicy = rejectClientOwnedContentPath(req.body.metadata);
        if (!metadataPolicy.ok) {
          return res.status(422).json({ error: metadataPolicy.error, code: metadataPolicy.code });
        }
        const nextMetadata = { ...(req.body.metadata || {}) };
        const storedContentPath = getStoredContentPath(current.rows[0].metadata);
        if (storedContentPath) nextMetadata.content_path = storedContentPath;
        updates.push(`metadata = $${i++}::jsonb`);
        values.push(JSON.stringify(nextMetadata));
      }
      if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

      values.push(stimulusId);
      const r = await pool.query(
        `UPDATE stimuli
         SET ${updates.join(', ')}, updated_at = current_timestamp
         WHERE id = $${i}
         RETURNING id, project_id, folder_id, name, mime_type, size_bytes, metadata, created_at, updated_at`,
        values
      );
      res.json(await publicStimulusWithAvailability(r.rows[0]));
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
      const storedContentPath = getStoredContentPath(stim.metadata);
      let resolved = null;
      if (storedContentPath) {
        resolved = resolveStoredPath(stim.metadata);
        if (!resolved.ok) {
          return res.status(422).json({ error: 'Invalid server-owned content path', code: resolved.code });
        }
      }
      await pool.query('DELETE FROM stimuli WHERE id = $1', [stimulusId]);
      if (resolved) {
        try {
          await fs.promises.unlink(resolved.absolutePath);
        } catch (error) {
          if (error.code !== 'ENOENT') console.error(error);
        }
      }
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete stimulus' });
    }
  }
);

module.exports = router;
