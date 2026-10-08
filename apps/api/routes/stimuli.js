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
const { referencedDatabaseStimulusIds } = require('../../shared/protocol-stimuli');
const { HttpError } = require('../security/http-error');
const { mayReadStimulus, mayManageSharing, rejectOwnedFields } = require('../stimuli/access');
const { withMediaWrite, ensureStimulusVersion, freezeLegacyBindings } = require('../stimuli/versions');
const { ensurePreview, ensurePlayableVersion } = require('../stimuli/media-preview');
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
router.use((req, res, next) => {
  if (rejectOwnedFields(req.body) || (req.body?.visibility !== undefined && !['private', 'project'].includes(req.body.visibility))) {
    return res.status(422).json({ error: 'Invalid stimulus ownership fields', code: 'stimulus_owned_fields' });
  }
  next();
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
    file.mimetype = String(file.mimetype || '').toLowerCase();
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
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
    content_url: `/stimuli/${row.id}/content${row.current_version_id ? '?version=' + row.current_version_id : ''}`,
    preview_url: `/stimuli/${row.id}/preview${row.current_version_id ? '?version=' + row.current_version_id : ''}`,
  };
}

async function publicStimulusWithAvailability(row) {
  const result = publicStimulus(row);
  const version = row.current_version_id
    ? (await pool.query('SELECT sha256, media_info, preview_status FROM stimulus_versions WHERE id = $1 AND stimulus_id = $2', [row.current_version_id, row.id])).rows[0]
    : null;
  const resolved = await resolveReadableServerOwnedUploadPath(
    uploadsRoot,
    getStoredContentPath(row?.metadata)
  );
  return {
    ...result,
    sha256: version?.sha256 || null,
    media_info: version?.media_info || {},
    preview_status: version?.preview_status || 'pending',
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

async function ensureProjectAccess(projectId, user) {
  return hasProjectMembership(pool, projectId, user);
}

function rejectMediaError(res, error) {
  if (!(error instanceof HttpError)) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

async function requestedVersion(stimulus, value) {
  if (value === undefined && !stimulus.current_version_id) return null;
  const id = value === undefined ? stimulus.current_version_id : String(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, 'Invalid media version', 'stimulus_version_invalid');
  }
  const result = await pool.query('SELECT * FROM stimulus_versions WHERE id = $1 AND stimulus_id = $2', [id, stimulus.id]);
  if (!result.rows[0]) throw new HttpError(404, 'Media version not found', 'stimulus_version_not_found');
  return result.rows[0];
}

async function mayReadVersion(stimulus, user, version) {
  if (mayReadStimulus(stimulus, user)) return true;
  if (!version) return false;
  // Publishing explicitly grants access to ONLY the pinned version, not the personal library.
  const published = await pool.query(`SELECT 1 FROM invitations i JOIN protocols pr ON pr.id = i.protocol_id
    WHERE pr.project_id = $1 AND i.protocol_definition->'mediaManifest'->$2->>'versionId' = $3 LIMIT 1`,
  [stimulus.project_id, String(stimulus.id), String(version.id)]);
  return Boolean(published.rows[0]);
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
        `SELECT *
         FROM stimulus_folders
         WHERE project_id = $1 AND (visibility = 'project' OR created_by = $2 OR $3)
         ORDER BY created_at DESC`,
        [projectId, req.user.sub, req.user.role === 'admin']
      );
      res.json(r.rows);
    } catch (err) {
      console.error('Stimulus operation failed');
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
        `INSERT INTO stimulus_folders (project_id, name, created_by, visibility)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [projectId, name, req.user.sub, req.body.visibility || 'private']
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      console.error('Stimulus operation failed');
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
      const folder = await pool.query('SELECT * FROM stimulus_folders WHERE id = $1', [folderId]);
      if (!folder.rows[0]) return res.status(404).json({ error: 'Folder not found' });
      if (!mayReadStimulus(folder.rows[0], req.user) || !(await ensureProjectAccess(folder.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });
      const r = await pool.query(
        `UPDATE stimulus_folders
         SET name = $1, updated_at = current_timestamp
         WHERE id = $2
         RETURNING *`,
        [req.body.name.trim(), folderId]
      );
      res.json(r.rows[0]);
    } catch (err) {
      console.error('Stimulus operation failed');
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
      const folder = await pool.query('SELECT * FROM stimulus_folders WHERE id = $1', [folderId]);
      if (!folder.rows[0]) return res.status(404).json({ error: 'Folder not found' });
      if (!mayReadStimulus(folder.rows[0], req.user) || !(await ensureProjectAccess(folder.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });
      await pool.query('UPDATE stimuli SET folder_id = NULL, updated_at = current_timestamp WHERE folder_id = $1', [folderId]);
      await pool.query('DELETE FROM stimulus_folders WHERE id = $1', [folderId]);
      res.status(204).send();
    } catch (err) {
      console.error('Stimulus operation failed');
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
      const params = [projectId, req.user.sub, req.user.role === 'admin'];
      let sql = `
        SELECT *
        FROM stimuli
        WHERE project_id = $1 AND (visibility = 'project' OR created_by = $2 OR $3)
      `;
      if (req.query.folder_id) {
        params.push(parseInt(req.query.folder_id, 10));
        sql += ` AND folder_id = $${params.length}`;
      }
      sql += ' ORDER BY created_at DESC';
      const r = await pool.query(sql, params);
      res.json(await Promise.all(r.rows.map(publicStimulusWithAvailability)));
    } catch (err) {
      console.error('Stimulus operation failed');
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
        const folder = await pool.query('SELECT * FROM stimulus_folders WHERE id = $1', [folderId]);
        if (!folder.rows[0]) return res.status(400).json({ error: 'Folder not found' });
        if (Number(folder.rows[0].project_id) !== projectId || !mayReadStimulus(folder.rows[0], req.user)) return res.status(400).json({ error: 'Folder project mismatch' });
      }
      const r = await pool.query(
        `INSERT INTO stimuli (project_id, folder_id, name, mime_type, size_bytes, metadata, created_by, visibility)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING *`,
        [
          projectId,
          folderId,
          req.body.name.trim(),
          req.body.mime_type || null,
          req.body.size_bytes != null ? parseInt(req.body.size_bytes, 10) : null,
          JSON.stringify(req.body.metadata || {}), req.user.sub, req.body.visibility || 'private',
        ]
      );
      res.status(201).json(publicStimulus(r.rows[0]));
    } catch (err) {
      console.error('Stimulus operation failed');
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
      if (rejectOwnedFields(req.body) || (req.body.visibility && !['private', 'project'].includes(req.body.visibility))) {
        await removeUploadedFile(req.file);
        return res.status(422).json({ error: 'Invalid stimulus ownership fields', code: 'stimulus_owned_fields' });
      }
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
        const folder = await pool.query('SELECT * FROM stimulus_folders WHERE id = $1', [folderId]);
        if (!folder.rows[0]) {
          await removeUploadedFile(req.file);
          return res.status(400).json({ error: 'Folder not found' });
        }
        if (Number(folder.rows[0].project_id) !== projectId || !mayReadStimulus(folder.rows[0], req.user)) {
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

      const r = await withMediaWrite(pool, async client => {
        if (!(await hasProjectMembership(client, projectId, req.user))) throw new HttpError(403, 'Access denied', 'project_access_denied');
        const inserted = await client.query(
        `INSERT INTO stimuli (project_id, folder_id, name, mime_type, size_bytes, metadata, created_by, visibility)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING *`,
        [
          projectId,
          folderId,
          name,
          req.file.mimetype || null,
          req.file.size != null ? parseInt(req.file.size, 10) : null,
          JSON.stringify(metadata || {}), req.user.sub, req.body.visibility || 'private',
        ]
      );
        const version = await ensureStimulusVersion(client, inserted.rows[0]);
        if (/^(image|video|audio)\//.test(String(req.file.mimetype))) await ensurePlayableVersion(client, version, uploadsRoot);
        return inserted;
      });

      fileStored = true;
      res.status(201).json({ ...publicStimulus(r.rows[0]), content_available: true });
    } catch (err) {
      if (!fileStored) {
        try {
          await removeUploadedFile(req.file);
        } catch (cleanupError) {
          console.error('Stimulus cleanup failed');
        }
      }
      if (rejectMediaError(res, err)) return;
      console.error('Stimulus operation failed');
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
      if (rejectOwnedFields(req.body) || (req.body.visibility !== undefined && !['private', 'project'].includes(req.body.visibility))) {
        return res.status(422).json({ error: 'Invalid stimulus ownership fields', code: 'stimulus_owned_fields' });
      }
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
      const rows = await withMediaWrite(pool, async client => {
        if (!(await hasProjectMembership(client, projectId, req.user))) {
          throw new ConversionError(403, 'Access denied', 'project_access_denied');
        }
        if (folderId != null) {
          const folder = await client.query(
            `SELECT id FROM stimulus_folders WHERE id = $1 AND project_id = $2 AND (visibility = 'project' OR created_by = $3 OR $4) FOR SHARE`,
            [folderId, projectId, req.user.sub, req.user.role === 'admin']
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
            `INSERT INTO stimuli (project_id, folder_id, name, mime_type, size_bytes, metadata, created_by, visibility)
             VALUES ($1, $2, $3, 'image/jpeg', $4, $5::jsonb, $6, $7)
             RETURNING *`,
            [
              projectId,
              folderId,
              `${stem}_page_${index + 1}.jpg`,
              stat.size,
              JSON.stringify(metadata), req.user.sub, req.body.visibility || 'private',
            ]
          );
          const version = await ensureStimulusVersion(client, inserted.rows[0]);
          const inspected = await ensurePreview(client, version, uploadsRoot);
          if (inspected.preview_status !== 'ready') throw new HttpError(422,
            'Converted slide cannot be decoded', inspected.media_info?.preview_error || 'media_decode_failed');
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
      if (rejectMediaError(res, error)) return;
      if (error instanceof ConversionError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      console.error('Stimulus operation failed');
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
      if (rejectOwnedFields(req.body)) {
        await removeUploadedFile(req.file);
        return res.status(422).json({ error: 'Invalid stimulus ownership fields', code: 'stimulus_owned_fields' });
      }
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
        'SELECT * FROM stimuli WHERE id = $1',
        [stimulusId]
      );
      const stimulus = current.rows[0];
      if (!stimulus) {
        await removeUploadedFile(req.file);
        return res.status(404).json({ error: 'Stimulus not found' });
      }
      if (!mayReadStimulus(stimulus, req.user) || !(await ensureProjectAccess(stimulus.project_id, req.user))) {
        await removeUploadedFile(req.file);
        return res.status(403).json({ error: 'Access denied' });
      }

      const relativePath = path.relative(uploadsRoot, req.file.path);
      const replacement = resolveServerOwnedUploadPath(uploadsRoot, relativePath);
      if (!replacement.ok) {
        await removeUploadedFile(req.file);
        return res.status(500).json({ error: 'Server generated an invalid upload path' });
      }
      const updated = await withMediaWrite(pool, async client => {
        const locked = (await client.query('SELECT * FROM stimuli WHERE id = $1 FOR UPDATE', [stimulusId])).rows[0];
        if (!locked || !mayReadStimulus(locked, req.user) || !(await hasProjectMembership(client, locked.project_id, req.user))) throw new HttpError(403, 'Access denied', 'stimulus_access_denied');
        await freezeLegacyBindings(client, locked.project_id, stimulusId);
        const previous = await resolveReadableServerOwnedUploadPath(uploadsRoot, getStoredContentPath(locked.metadata));
        if (previous.ok) await ensureStimulusVersion(client, locked);
        const metadata = { ...(locked.metadata || {}), content_path: replacement.relativePath };
        const result = await client.query(`UPDATE stimuli SET mime_type = $1, size_bytes = $2, metadata = $3::jsonb,
            updated_at = current_timestamp WHERE id = $4 RETURNING *`,
          [req.file.mimetype || null, req.file.size, JSON.stringify(metadata), stimulusId]);
        const version = await ensureStimulusVersion(client, result.rows[0]);
        if (/^(image|video|audio)\//.test(String(req.file.mimetype))) await ensurePlayableVersion(client, version, uploadsRoot);
        return result;
      });
      fileStored = true;
      // Previous versions stay on disk for published invitations and historical analysis.
      return res.json({ ...publicStimulus(updated.rows[0]), content_available: true });
    } catch (error) {
      if (!fileStored) await removeUploadedFile(req.file).catch(() => console.error('Stimulus cleanup failed'));
      if (rejectMediaError(res, error)) return;
      console.error('Stimulus operation failed');
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
      const current = await pool.query('SELECT * FROM stimuli WHERE id = $1', [stimulusId]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Stimulus not found' });
      const stim = current.rows[0];
      if (!(await ensureProjectAccess(stim.project_id, req.user))) return res.status(403).json({ error: 'Access denied' });
      const version = await requestedVersion(stim, req.query.version);
      if (!(await mayReadVersion(stim, req.user, version))) return res.status(403).json({ error: 'Access denied' });
      const contentPath = version?.content_path || getStoredContentPath(stim.metadata);
      const resolved = await resolveReadableServerOwnedUploadPath(uploadsRoot, contentPath);
      if (!resolved.ok) {
        const status = resolved.code === 'content_file_missing' ? 404 : 422;
        return res.status(status).json({ error: 'Stimulus binary is unavailable', code: resolved.code });
      }

      const download = String(req.query.download || '') === '1';
      const mimeType = version?.mime_type || stim.mime_type;
      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, no-store');
      if (version?.sha256) res.setHeader('ETag', `"sha256-${version.sha256}"`);
      const inlineAllowed = INLINE_MEDIA_TYPES.has(String(mimeType || '').toLowerCase());
      res.setHeader(
        'Content-Disposition',
        contentDisposition(download || !inlineAllowed ? 'attachment' : 'inline', stim.name)
      );
      res.sendFile(resolved.absolutePath);
    } catch (err) {
      if (rejectMediaError(res, err)) return;
      console.error('Stimulus operation failed');
      res.status(500).json({ error: 'Failed to serve stimulus content' });
    }
  }
);

router.get('/:id/preview', [param('id').isInt({ min: 1 })], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const stim = (await pool.query('SELECT * FROM stimuli WHERE id = $1', [req.params.id])).rows[0];
    if (!stim) return res.status(404).json({ error: 'Stimulus not found' });
    if (!(await ensureProjectAccess(stim.project_id, req.user))) return res.status(403).json({ error: 'Access denied' });
    let version = await requestedVersion(stim, req.query.version);
    if (!(await mayReadVersion(stim, req.user, version))) return res.status(403).json({ error: 'Access denied' });
    version = await withMediaWrite(pool, async client => {
      const locked = (await client.query('SELECT * FROM stimuli WHERE id = $1 FOR UPDATE', [stim.id])).rows[0];
      if (!locked) throw new HttpError(404, 'Stimulus not found', 'stimulus_not_found');
      if (!version) version = await ensureStimulusVersion(client, locked);
      return ensurePreview(client, version, uploadsRoot);
    });
    if (version.preview_status !== 'ready') {
      return res.status(version.preview_status === 'unsupported' ? 415 : 503).json({
        error: 'Preview unavailable; original media is preserved', code: version.media_info?.preview_error || 'media_preview_unsupported'
      });
    }
    const resolved = await resolveReadableServerOwnedUploadPath(uploadsRoot, version.preview_path);
    if (!resolved.ok) throw new HttpError(404, 'Preview file unavailable', resolved.code);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(resolved.absolutePath);
  } catch (error) {
    if (rejectMediaError(res, error)) return;
    return res.status(500).json({ error: 'Failed to preview stimulus' });
  }
});

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
      const current = await pool.query('SELECT * FROM stimuli WHERE id = $1', [stimulusId]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Stimulus not found' });
      if (!mayReadStimulus(current.rows[0], req.user) || !(await ensureProjectAccess(current.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });

      const updates = [];
      const values = [];
      let i = 1;
      if (req.body.visibility !== undefined) {
        if (!mayManageSharing(current.rows[0], req.user)) return res.status(403).json({ error: 'Only the owner can change sharing' });
        updates.push(`visibility = $${i++}`);
        values.push(req.body.visibility);
        // A shared item must not retain a reference to a personal folder.
        if (req.body.visibility === 'project' && req.body.folder_id === undefined) updates.push('folder_id = NULL');
      }
      if (req.body.name !== undefined) { updates.push(`name = $${i++}`); values.push(req.body.name.trim()); }
      if (req.body.folder_id !== undefined) {
        const folderId = req.body.folder_id == null || req.body.folder_id === '' ? null : parseInt(req.body.folder_id, 10);
        if (folderId != null) {
          const folder = await pool.query('SELECT * FROM stimulus_folders WHERE id = $1', [folderId]);
          if (!folder.rows[0]) return res.status(400).json({ error: 'Folder not found' });
          if (folder.rows[0].project_id !== current.rows[0].project_id || !mayReadStimulus(folder.rows[0], req.user)) return res.status(400).json({ error: 'Folder project mismatch' });
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
      const r = await withMediaWrite(pool, async client => {
        const locked = (await client.query('SELECT * FROM stimuli WHERE id = $1 FOR UPDATE', [stimulusId])).rows[0];
        if (!locked || !mayReadStimulus(locked, req.user)) throw new HttpError(403, 'Access denied', 'stimulus_access_denied');
        if (req.body.visibility !== undefined && !mayManageSharing(locked, req.user)) throw new HttpError(403, 'Only the owner can change sharing', 'stimulus_owner_required');
        const metadataUpdate = updates.find(update => update.startsWith('metadata = '));
        if (metadataUpdate) {
          const index = Number(metadataUpdate.match(/\$(\d+)/)[1]) - 1;
          const metadata = JSON.parse(values[index]);
          const contentPath = getStoredContentPath(locked.metadata);
          if (contentPath) metadata.content_path = contentPath;
          values[index] = JSON.stringify(metadata);
        }
        return client.query(
        `UPDATE stimuli
         SET ${updates.join(', ')}, updated_at = current_timestamp
         WHERE id = $${i}
         RETURNING *`,
        values
      );
      });
      res.json(await publicStimulusWithAvailability(r.rows[0]));
    } catch (err) {
      if (rejectMediaError(res, err)) return;
      console.error('Stimulus operation failed');
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
      const current = await pool.query('SELECT * FROM stimuli WHERE id = $1', [stimulusId]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Stimulus not found' });
      if (!mayReadStimulus(current.rows[0], req.user) || !(await ensureProjectAccess(current.rows[0].project_id, req.user))) return res.status(403).json({ error: 'Access denied' });

      await withMediaWrite(pool, async client => {
        const stim = (await client.query('SELECT * FROM stimuli WHERE id = $1 FOR UPDATE', [stimulusId])).rows[0];
        if (!stim || !mayReadStimulus(stim, req.user)) throw new HttpError(403, 'Access denied', 'stimulus_access_denied');
        const definitions = await client.query(          `SELECT definition FROM protocols WHERE project_id = $1
            UNION ALL SELECT i.protocol_definition AS definition FROM invitations i
            JOIN protocols pr ON pr.id = i.protocol_id WHERE pr.project_id = $1`, [stim.project_id]);
        if (definitions.rows.some(row => referencedDatabaseStimulusIds(row.definition).includes(stimulusId))) {
          throw new HttpError(409, 'Stimulus is used by a protocol or a published invitation', 'stimulus_used_by_protocol');
        }
        const versions = await client.query('SELECT content_path, preview_path FROM stimulus_versions WHERE stimulus_id = $1', [stimulusId]);
        const paths = new Set([getStoredContentPath(stim.metadata), ...versions.rows.flatMap(row => [row.content_path, row.preview_path])].filter(Boolean));
        const files = [...paths].map(value => resolveServerOwnedUploadPath(uploadsRoot, value));
        if (files.some(file => !file.ok)) throw new HttpError(422, 'Invalid stored media path', 'invalid_content_path');
        await client.query('UPDATE stimuli SET current_version_id = NULL WHERE id = $1', [stimulusId]);
        await client.query('DELETE FROM stimulus_versions WHERE stimulus_id = $1', [stimulusId]);
        await client.query('DELETE FROM stimuli WHERE id = $1', [stimulusId]);
        // Extra files after an IO failure are harmless; deleting before commit could lose referenced media.
        return files;
      }).then(async files => {
        for (const file of files) await fs.promises.unlink(file.absolutePath).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
      });
      res.status(204).send();
    } catch (err) {
      if (rejectMediaError(res, err)) return;
      res.status(500).json({ error: 'Failed to delete stimulus' });
    }
  }
);

module.exports = router;
