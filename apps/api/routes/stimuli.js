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
const { withMediaWrite, hashFile, ensureStimulusVersion, freezeLegacyBindings } = require('../stimuli/versions');
const { ensurePreview, createPreview, persistPreview, hasUsablePreview } = require('../stimuli/media-preview');
const { readStoragePolicy } = require('../config/storage-policy');
const { canonical, fingerprint, normalizeDescriptor, publicOperation, findOperation,
  admitOperation, claimOperation, completeOperation, failOperation } = require('../stimuli/media-operations');
const { usage, organizationForProject, assertDiskSpace, measureUnmeasured, lockOrganization } = require('../stimuli/storage-quotas');
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
const mediaLimits = { maxUploadBytes: config.storage.maxUploadBytes,
  maxDocumentBytes: config.storage.conversion.maxDocumentBytes, maxPages: config.storage.conversion.maxPages };

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadsRoot);
  },
  filename: function (req, _file, cb) {
    // The display name is metadata, never a filesystem component (NAME_MAX).
    const name = crypto.randomUUID();
    rememberMediaArtifact(req, name).then(() => cb(null, name), cb);
  }
});

const upload = {
  storage,
  limits: { fileSize: config.storage.maxUploadBytes, files: 1, fields: 8,
    parts: 10, fieldSize: 256 * 1024, fieldNameSize: 64 },
  fileFilter(_req, file, callback) {
    file.mimetype = String(file.mimetype || '').toLowerCase();
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      const error = new Error('Unsupported stimulus media type');
      error.code = 'UNSUPPORTED_STIMULUS_MEDIA_TYPE';
      return callback(error);
    }
    return callback(null, true);
  }
};

const documentUpload = {
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      callback(null, conversionIncomingRoot);
    },
    filename(req, file, callback) {
      const extension = path.extname(String(file.originalname || '')).toLowerCase();
      if (!['.pdf', '.ppt', '.pptx'].includes(extension)) {
        return callback(new ConversionError(415, 'Use a PDF, PPT or PPTX document', 'document_extension_unsupported'));
      }
      const name = `${crypto.randomUUID()}${extension}`;
      rememberMediaArtifact(req, path.join('.incoming', name)).then(() => callback(null, name), callback);
    },
  }),
  limits: { fileSize: config.storage.conversion.maxDocumentBytes, files: 1,
    fields: 8, parts: 10, fieldSize: 256 * 1024, fieldNameSize: 64 },
  fileFilter(_req, file, callback) {
    if (!DOCUMENT_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
      const error = new ConversionError(415, 'Unsupported document media type', 'document_mime_unsupported');
      return callback(error);
    }
    return callback(null, true);
  },
};

function publicStimulus(row) {
  const metadata = row?.metadata && typeof row.metadata === 'object'
    ? { ...row.metadata }
    : {};
  delete metadata.content_path;
  delete metadata.contentPath;
  return {
    ...row,
    metadata,
    content_url: `/stimuli/${row.id}/content${row.current_version_id ? '?version=' + row.current_version_id : ''}`,
    preview_url: `/stimuli/${row.id}/preview${row.current_version_id ? '?version=' + row.current_version_id : ''}`,
  };
}

async function publicStimulusWithAvailability(row, loadedVersion) {
  const result = publicStimulus(row);
  const version = loadedVersion !== undefined ? loadedVersion : row.current_version_id
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
  if ([503, 504].includes(error.status) && error.code !== 'media_write_uncertain') res.setHeader('Retry-After', '1');
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

async function mayReadVersion(stimulus, user, version, queryable = pool) {
  if (mayReadStimulus(stimulus, user)) return true;
  if (!version) return false;
  // Publishing explicitly grants access to ONLY the pinned version, not the personal library.
  const published = await queryable.query(`SELECT 1 FROM invitations i JOIN protocols pr ON pr.id = i.protocol_id
    WHERE pr.project_id = $1 AND i.protocol_definition->'mediaManifest'->$2->>'versionId' = $3 LIMIT 1`,
  [stimulus.project_id, String(stimulus.id), String(version.id)]);
  return Boolean(published.rows[0]);
}

async function validateOperationAccess(descriptor, user, queryable = pool) {
  if (!(await hasProjectMembership(queryable, descriptor.project_id, user))) {
    throw new HttpError(403, 'Access denied', 'project_access_denied');
  }
  if (descriptor.kind === 'replace') {
    const row = (await queryable.query('SELECT * FROM stimuli WHERE id=$1', [descriptor.stimulus_id])).rows[0];
    if (!row || Number(row.project_id) !== descriptor.project_id || !mayReadStimulus(row, user)) {
      throw new HttpError(403, 'Access denied', 'stimulus_access_denied');
    }
  }
  if (descriptor.folder_id !== null) {
    const folder = (await queryable.query('SELECT * FROM stimulus_folders WHERE id=$1', [descriptor.folder_id])).rows[0];
    if (!folder || Number(folder.project_id) !== descriptor.project_id || !mayReadStimulus(folder, user)) {
      throw new HttpError(422, 'Folder is unavailable in this project', 'folder_project_mismatch');
    }
  }
}

router.post('/operations', async (req, res) => {
  try {
    const descriptor = normalizeDescriptor(req.body, mediaLimits);
    if (descriptor.kind === 'convert' ? !DOCUMENT_MIME_TYPES.has(descriptor.file.type)
      || !/\.(pdf|ppt|pptx)$/i.test(descriptor.file.name) : !ALLOWED_UPLOAD_MIME_TYPES.has(descriptor.file.type)) {
      throw new HttpError(415, 'Unsupported media type', 'stimulus_media_type_unsupported');
    }
    await validateOperationAccess(descriptor, req.user);
    const organizationId = await organizationForProject(pool, descriptor.project_id);
    const operation = await admitOperation(pool, req.user.sub, organizationId, req.body.key,
      descriptor, uploadsRoot, mediaLimits);
    return res.status(operation.state === 'reserved' ? 201 : 200).json(publicOperation(operation));
  } catch (error) {
    if (rejectMediaError(res, error)) return;
    return res.status(503).json({ error: 'Media admission is unavailable', code: 'media_admission_unavailable' });
  }
});

router.get('/operations/:key', async (req, res) => {
  try {
    const operation = await findOperation(pool, req.user.sub, req.params.key);
    if (!operation || Number(req.query.project_id) !== Number(operation.project_id)
      || !(await ensureProjectAccess(operation.project_id, req.user))) {
      throw new HttpError(404, 'Media operation not found', 'media_operation_not_found');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(publicOperation(operation));
  } catch (error) {
    if (rejectMediaError(res, error)) return;
    return res.status(503).json({ error: 'Media recovery is unavailable', code: 'media_recovery_unavailable' });
  }
});

router.get('/storage', async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);
    if (!Number.isSafeInteger(projectId) || projectId < 1) throw new HttpError(422, 'Project is required', 'project_invalid');
    if (!(await ensureProjectAccess(projectId, req.user))) throw new HttpError(403, 'Access denied', 'project_access_denied');
    const organizationId = await organizationForProject(pool, projectId);
    const totals = await withMediaWrite(pool, async client => {
      await lockOrganization(client, organizationId);
      await measureUnmeasured(client, organizationId, uploadsRoot);
      return usage(client, organizationId);
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ ...totals, limit_bytes: readStoragePolicy().organizationBytes });
  } catch (error) {
    if (rejectMediaError(res, error)) return;
    return res.status(503).json({ error: 'Media usage is unavailable', code: 'media_usage_unavailable' });
  }
});

async function finishMediaRequest(req) {
  if (!req.mediaClaim || req.mediaClaim.replay) return;
  try {
    if (!req.mediaCompleted) {
      let uncertain = Boolean(req.mediaUncertain);
      if (!uncertain) {
        const paths = new Set([req.file?.path, ...(req.mediaArtifacts || [])].filter(Boolean));
        for (const file of paths) {
          try { await removeUploadedFile({ path: file }); }
          catch (_) { uncertain = true; }
        }
      }
      await failOperation(pool, req.mediaClaim.operation, uncertain);
    }
  } catch (_) {
    // Leave charged state intact when DB/cleanup cannot confirm failure.
  } finally { await req.mediaClaim.release(); }
}

async function rememberMediaArtifact(req, relativePath, directory = false) {
  const resolved = resolveServerOwnedUploadPath(uploadsRoot, relativePath);
  if (!resolved.ok) throw new HttpError(422, 'Invalid media artifact', 'invalid_content_path');
  const result = await pool.query(`UPDATE media_operations SET artifacts=artifacts || $2::jsonb,updated_at=now()
    WHERE id=$1 AND state IN ('receiving','processing') AND jsonb_array_length(artifacts)<1500 RETURNING id`,
  [req.mediaClaim.operation.id, JSON.stringify([{ path: resolved.relativePath, directory }])]);
  if (!result.rows.length) throw new HttpError(409, 'Media operation needs recovery before further processing', 'media_recovery_required');
  if (!directory) req.mediaArtifacts.push(resolved.absolutePath);
}

function mediaIncoming(kind, parser) {
  return async (req, res, next) => {
    try {
      const operation = await findOperation(pool, req.user.sub, req.get('Idempotency-Key') || req.query.operation_key);
      if (!operation) throw new HttpError(422, 'Create a media operation before uploading; refresh this client', 'media_operation_required');
      if (operation.descriptor.kind !== kind || (kind === 'replace' && Number(req.params.id) !== operation.descriptor.stimulus_id)) {
        throw new HttpError(409, 'Media operation does not match this endpoint', 'media_operation_conflict');
      }
      await validateOperationAccess(operation.descriptor, req.user);
      req.mediaClaim = await claimOperation(pool, operation, uploadsRoot);
      if (req.mediaClaim.replay) return res.status(req.mediaClaim.operation.result_status).json(req.mediaClaim.operation.result);
      req.mediaArtifacts = [];
      const receive = multer({ ...parser, limits: { ...parser.limits,
        fileSize: operation.descriptor.file.size } }).single('file');
      if (req.aborted) throw new HttpError(400, 'Media transfer was interrupted', 'media_transfer_interrupted');
      await new Promise((resolve, reject) => {
        // Multer closes and removes partial files before calling next on abort.
        // An independent abort callback would race that cleanup.
        receive(req, res, error => error ? reject(error) : resolve());
      });
      const d = operation.descriptor;
      if (!req.file) throw new HttpError(400, 'Media file is required', 'media_file_required');
      if (rejectOwnedFields(req.body) || (req.body.visibility && !['private','project'].includes(req.body.visibility))) {
        throw new HttpError(422, 'Invalid stimulus ownership fields', 'stimulus_owned_fields');
      }
      const actual = { ...d, file: { ...d.file, size: req.file.size,
        type: String(req.file.mimetype).toLowerCase(), sha256: await hashFile(req.file.path) } };
      for (const field of ['project_id','folder_id']) if (req.body[field] !== undefined) actual[field] = req.body[field] === '' ? null : Number(req.body[field]);
      for (const field of ['name','visibility']) if (req.body[field] !== undefined) actual[field] = req.body[field];
      if (req.body.original_name !== undefined && req.body.original_name !== d.file.name) {
        throw new HttpError(409, 'Media operation file name changed', 'media_operation_conflict');
      }
      if (req.body.metadata !== undefined && req.body.metadata !== '') {
        try { actual.metadata = canonical(JSON.parse(req.body.metadata)); }
        catch (_) { throw new HttpError(422, 'Media metadata must be valid JSON', 'media_operation_invalid'); }
      }
      if (fingerprint(actual) !== operation.fingerprint) throw new HttpError(409,
        'Media bytes or metadata differ from the reserved operation', 'media_operation_conflict');
      req.mediaDescriptor = d;
      await req.mediaClaim.client.query("UPDATE media_operations SET state='processing',updated_at=now() WHERE id=$1 AND state='receiving'", [operation.id]);
      await assertDiskSpace(req.mediaClaim.client, uploadsRoot);
      return next();
    } catch (error) {
      await finishMediaRequest(req);
      if (rejectMediaError(res, error)) return;
      if (error instanceof ConversionError) return res.status(error.status).json({ error: error.message, code: error.code });
      if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 422)
        .json({ error: 'Media transfer exceeds the allowed multipart limits', code: 'media_transfer_limit' });
      return res.status(503).json({ error: 'Media transfer failed; recover the operation before retrying', code: 'media_transfer_failed' });
    }
  };
}

async function prepareMedia(req, file, mime, sha256) {
  const preview = await createPreview({ content_path: path.relative(uploadsRoot, file), mime_type: mime, sha256 }, uploadsRoot,
    { ...config.storage.preview, onArtifact: relative => rememberMediaArtifact(req, relative) });
  if (preview.path) req.mediaArtifacts.push(path.join(uploadsRoot, preview.path));
  return preview;
}

async function operationWrite(req, status, format, callback) {
  try {
    const result = await withMediaWrite(pool, client => completeOperation(client,
      req.mediaClaim.operation, status, format, async queryable => {
        await validateOperationAccess(req.mediaDescriptor, req.user, queryable);
        return callback(queryable);
      }));
    req.mediaCompleted = true;
    return result;
  } catch (error) {
    if (error.mediaCommitUncertain) req.mediaUncertain = true;
    throw error;
  }
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
        SELECT s.*, v.sha256 AS version_sha256, v.media_info AS version_media_info,
          v.preview_status AS version_preview_status
        FROM stimuli s LEFT JOIN stimulus_versions v ON v.id = s.current_version_id AND v.stimulus_id = s.id
        WHERE s.project_id = $1 AND (s.visibility = 'project' OR s.created_by = $2 OR $3)
      `;
      if (req.query.folder_id) {
        params.push(parseInt(req.query.folder_id, 10));
        sql += ` AND s.folder_id = $${params.length}`;
      }
      sql += ' ORDER BY s.created_at DESC';
      const r = await pool.query(sql, params);
      const rows = new Array(r.rows.length);
      let cursor = 0;
      // Bound filesystem work too; large libraries must not exhaust the pool or fd queue.
      await Promise.all(Array.from({ length: Math.min(8, r.rows.length) }, async () => {
        while (cursor < r.rows.length) {
          const index = cursor++;
          const { version_sha256, version_media_info, version_preview_status, ...row } = r.rows[index];
          rows[index] = await publicStimulusWithAvailability(row, {
            sha256: version_sha256, media_info: version_media_info, preview_status: version_preview_status,
          });
        }
      }));
      res.json(rows);
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

router.post('/upload', mediaIncoming('upload', upload), async (req, res) => {
  try {
    const d = req.mediaDescriptor;
    const relative = path.relative(uploadsRoot, req.file.path);
    if (!(await verifyUploadedFileType(uploadsRoot, relative, d.file.type))) {
      throw new HttpError(415, 'Uploaded bytes do not match the declared media type', 'stimulus_media_signature_mismatch');
    }
    const preview = await prepareMedia(req, req.file.path, d.file.type, d.file.sha256);
    const result = await operationWrite(req, 201,
      row => ({ ...publicStimulus(row), content_available: true }), async client => {
        const inserted = (await client.query(
          `INSERT INTO stimuli(project_id,folder_id,name,mime_type,size_bytes,metadata,created_by,visibility)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
          [d.project_id,d.folder_id,d.name,d.file.type,d.file.size,
            JSON.stringify({ ...d.metadata, content_path: relative }),req.user.sub,d.visibility])).rows[0];
        const version = await ensureStimulusVersion(client, inserted);
        await persistPreview(client, version, uploadsRoot, preview);
        return inserted;
      });
    return res.status(201).json(result);
  } catch (error) {
    if (rejectMediaError(res, error)) return;
    return res.status(500).json({ error: 'Failed to upload stimulus', code: 'media_upload_failed' });
  } finally { await finishMediaRequest(req); }
});

router.post('/convert', mediaIncoming('convert', documentUpload), async (req, res) => {
  let conversion;
  try {
    const d = req.mediaDescriptor;
    conversion = await convertDocument({
      inputPath: req.file.path, originalName: d.file.name, declaredMime: d.file.type, uploadsRoot,
      maxBytes: config.storage.conversion.maxDocumentBytes, maxPages: config.storage.conversion.maxPages,
      timeoutMs: config.storage.conversion.timeoutMs, dpi: config.storage.conversion.dpi,
      maxConcurrent: config.storage.conversion.maxConcurrent,
      libreOfficeBin: config.storage.conversion.libreOfficeBin,
      pdfInfoBin: config.storage.conversion.pdfInfoBin, pdfToPpmBin: config.storage.conversion.pdfToPpmBin,
      onWorkspace: relative => rememberMediaArtifact(req, relative, true),
    });
    const sourceBase = path.basename(d.file.name).replace(/[\r\n]/g, '_').slice(0,180);
    const stem = sourceBase.replace(/\.[^.]+$/, '').slice(0,120) || 'document';
    // Native decoding/rasterization is outside the global publication lock.
    // Files are unreferenced until the backup-protected transaction below.
    const prepared = [];
    for (const [index, page] of conversion.pages.entries()) {
      const sha256 = await hashFile(page);
      const finalName = crypto.randomUUID() + '_page_' + (index+1) + '.jpg';
      await rememberMediaArtifact(req, finalName);
      prepared.push({ page, finalName, preview: await prepareMedia(req, page, 'image/jpeg', sha256) });
    }
    const result = await operationWrite(req, 201, rows => ({
      source: { name: sourceBase, page_count: conversion.pageCount },
      stimuli: rows.map(row => ({ ...publicStimulus(row), content_available: true })),
    }), async client => {
      const rows = [];
      for (let index=0; index<prepared.length; index++) {
        const finalName = prepared[index].finalName;
        const finalFile = path.join(uploadsRoot, finalName);
        await fs.promises.rename(prepared[index].page, finalFile);
        req.mediaArtifacts.push(finalFile);
        const stat = await fs.promises.stat(finalFile);
        const metadata = { content_path: finalName, source_document_name: sourceBase, source_page: index+1,
          source_page_count: conversion.pageCount, conversion_dpi: config.storage.conversion.dpi,
          conversion_engine: 'libreoffice_poppler' };
        const row = (await client.query(
          `INSERT INTO stimuli(project_id,folder_id,name,mime_type,size_bytes,metadata,created_by,visibility)
            VALUES($1,$2,$3,'image/jpeg',$4,$5::jsonb,$6,$7) RETURNING *`,
          [d.project_id,d.folder_id,stem+'_page_'+(index+1)+'.jpg',stat.size,JSON.stringify(metadata),req.user.sub,d.visibility])).rows[0];
        const version = await ensureStimulusVersion(client, row);
        await persistPreview(client, version, uploadsRoot, prepared[index].preview);
        rows.push(row);
      }
      // Source/workspace cleanup must settle before publication releases its
      // reservation. Otherwise a completed operation cannot recover leftovers.
      await cleanupConversion(conversion);
      await removeIncomingDocument(req.file);
      return rows;
    });
    return res.status(201).json(result);
  } catch (error) {
    if (rejectMediaError(res, error)) return;
    if (error instanceof ConversionError) return res.status(error.status).json({ error: error.message, code: error.code });
    return res.status(500).json({ error: 'Document conversion failed', code: 'document_conversion_failed' });
  } finally {
    // These are only source/workspace files, never promoted version originals.
    // Unknown COMMIT preserves all promoted originals and prepared posters.
    const cleanup = await Promise.allSettled([cleanupConversion(conversion), removeIncomingDocument(req.file)]);
    if (cleanup.some(result => result.status === 'rejected')) req.mediaUncertain = true;
    await finishMediaRequest(req);
  }
});

router.post('/:id/content', mediaIncoming('replace', upload), async (req, res) => {
  try {
    const d = req.mediaDescriptor;
    const relative = path.relative(uploadsRoot, req.file.path);
    if (!(await verifyUploadedFileType(uploadsRoot, relative, d.file.type))) {
      throw new HttpError(415, 'Uploaded bytes do not match the declared media type', 'stimulus_media_signature_mismatch');
    }
    const preview = await prepareMedia(req, req.file.path, d.file.type, d.file.sha256);
    const result = await operationWrite(req, 200,
      row => ({ ...publicStimulus(row), content_available: true }), async client => {
        const locked = (await client.query('SELECT * FROM stimuli WHERE id=$1 FOR UPDATE', [d.stimulus_id])).rows[0];
        if (!locked || !mayReadStimulus(locked, req.user)) throw new HttpError(403, 'Access denied', 'stimulus_access_denied');
        await freezeLegacyBindings(client, locked.project_id, locked.id);
        const previous = await resolveReadableServerOwnedUploadPath(uploadsRoot, getStoredContentPath(locked.metadata));
        if (previous.ok) await ensureStimulusVersion(client, locked);
        const row = (await client.query(`UPDATE stimuli SET mime_type=$1,size_bytes=$2,metadata=$3::jsonb,
          updated_at=now() WHERE id=$4 RETURNING *`,
        [d.file.type,d.file.size,JSON.stringify({ ...locked.metadata, content_path: relative }),locked.id])).rows[0];
        const version = await ensureStimulusVersion(client, row);
        await persistPreview(client, version, uploadsRoot, preview);
        return row;
      });
    return res.json(result);
  } catch (error) {
    if (rejectMediaError(res, error)) return;
    return res.status(500).json({ error: 'Failed to replace stimulus content', code: 'media_replace_failed' });
  } finally { await finishMediaRequest(req); }
});

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
    const validated = await hasUsablePreview(version, uploadsRoot);
    if (!validated) {
      version = await withMediaWrite(pool, async client => {
        const locked = (await client.query('SELECT * FROM stimuli WHERE id = $1 FOR UPDATE', [stim.id])).rows[0];
        if (!locked) throw new HttpError(404, 'Stimulus not found', 'stimulus_not_found');
        if (!(await hasProjectMembership(client, locked.project_id, req.user))
          || !(await mayReadVersion(locked, req.user, version, client))) {
          throw new HttpError(403, 'Access denied', 'stimulus_access_denied');
        }
        if (!version) version = await ensureStimulusVersion(client, locked);
        return ensurePreview(client, version, uploadsRoot);
      });
    }
    if (version.preview_status !== 'ready') {
      if (version.preview_status !== 'unsupported') res.setHeader('Retry-After', '1');
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
      }).then(files => withMediaWrite(pool, async client => {
        const organizationId = await organizationForProject(client, current.rows[0].project_id);
        await lockOrganization(client, organizationId);
        for (const file of files) {
          const referenced = await client.query(`SELECT 1 FROM stimulus_versions WHERE content_path=$1 OR preview_path=$1
            UNION ALL SELECT 1 FROM stimuli WHERE metadata->>'content_path'=$1 OR metadata->>'contentPath'=$1 LIMIT 1`, [file.relativePath]);
          if (referenced.rows.length) continue;
          await fs.promises.unlink(file.absolutePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
          await client.query('DELETE FROM media_storage_objects WHERE organization_id=$1 AND content_path=$2',
            [organizationId, file.relativePath]);
        }
      }));
      res.status(204).send();
    } catch (err) {
      if (rejectMediaError(res, err)) return;
      res.status(500).json({ error: 'Failed to delete stimulus' });
    }
  }
);

module.exports = router;
