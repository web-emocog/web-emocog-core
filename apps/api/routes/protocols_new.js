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
const {
  inspectProtocolStimuli,
  rejectUnavailableProtocolStimuli,
} = require('../stimuli/protocol-availability');

const { withMediaWrite, pinProtocolMedia } = require('../stimuli/versions');
const { HttpError } = require('../security/http-error');
const { publicProtocol, protocolRevision } = require('../stimuli/public-projection');
const { referencedDatabaseStimulusIds } = require('../../shared/protocol-stimuli');
const { mayReadStimulus } = require('../stimuli/access');
const { listProtocolVersions } = require('../analytics/protocol-versions');
const protocolQuality = require('../../shared/protocol-quality');

const router = express.Router();
router.use(requireAuth);

async function checkDraftStimulusAccess(client, projectId, definition, user) {
  const ids = referencedDatabaseStimulusIds(definition, { includeBuilderState: true });
  if (!ids.length) return;
  const rows = await client.query('SELECT * FROM stimuli WHERE project_id = $1 AND id = ANY($2::int[])', [projectId, ids]);
  if (rows.rows.some(row => !mayReadStimulus(row, user))) {
    throw new HttpError(422, 'Protocol references unavailable or private stimuli', 'protocol_stimulus_access_denied');
  }
}

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
  if (!protocolQuality.validate(definition)) {
    res.status(422).json({ error: 'Invalid protocol quality policy', code: 'protocol_quality_invalid' });
    return true;
  }
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
               (active_invitation.id IS NULL OR pr.definition IS DISTINCT FROM active_invitation.protocol_definition) AS has_unpublished_changes,
               active_invitation.id AS invitation_id,
               CASE WHEN active_invitation.id IS NOT NULL THEN publication.code END AS invitation_code,
               publication.version AS publication_version,
               active_invitation.max_runs AS invitation_max_runs,
               active_invitation.used_runs AS invitation_used_runs,
               active_invitation.expires_at AS invitation_expires_at,
               active_invitation.created_at AS invitation_created_at
        FROM protocols pr
        INNER JOIN projects p ON p.id = pr.project_id
        LEFT JOIN protocol_publications publication ON publication.protocol_id = pr.id
        LEFT JOIN LATERAL (
          SELECT i.id, i.code, i.max_runs, i.used_runs, i.expires_at, i.created_at, i.protocol_definition
          FROM invitations i
          WHERE i.protocol_id = pr.id AND i.id = publication.invitation_id
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
      const versions = await listProtocolVersions(pool, r.rows.map(row => row.id));
      res.json(r.rows.map(row => ({ ...publicProtocol(row), versions: versions.get(Number(row.id)) || [] })));
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
    body('save_mode').optional().isIn(['draft', 'publish']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { project_id, name } = req.body;
      const definition = normalizeMandatoryParticipantShell(req.body.definition);
      delete definition.mediaManifest;
      definition.isDraft = req.body.save_mode === 'draft';
      if (!definition.isDraft && rejectInvalidAois(res, definition)) return;
      if (!definition.isDraft && rejectInvalidSurveys(res, definition)) return;
      const projectAllowed = await hasProjectMembership(pool, project_id, req.user);
      if (!projectAllowed) return res.status(403).json({ error: 'Not member of project' });
      const r = await withMediaWrite(pool, async client => {
        if (!(await hasProjectMembership(client, project_id, req.user))) throw new HttpError(403, 'Not member of project', 'project_access_denied');
        if (!definition.isDraft) {
          const report = await inspectProtocolStimuli(client, project_id, definition, { user: req.user });
          if (!report.ok) throw new HttpError(422, 'Protocol references unavailable or private stimulus files', 'protocol_stimulus_unavailable');
        }
        if (definition.isDraft) await checkDraftStimulusAccess(client, project_id, definition, req.user);
        const pinned = definition.isDraft ? definition : await pinProtocolMedia(client, project_id, definition, req.user);
        return client.query(
        `INSERT INTO protocols (project_id, name, definition) VALUES ($1, $2, $3)
         RETURNING id, project_id, name, definition, created_at, updated_at`,
        [project_id, name, JSON.stringify(pinned)]
      );
      });
      res.status(201).json(publicProtocol(r.rows[0]));
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
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
      res.json(publicProtocol(r.rows[0]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.patch('/:id', requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.PROTOCOL_WRITE), [param('id').isInt({ min: 1 }),
    body('name').optional().trim().notEmpty().isLength({ max: 255 }), body('definition').optional().isObject(),
    body('save_mode').optional().isIn(['draft', 'publish']), body('expected_updated_at').optional().isISO8601(),
    body('expected_revision').optional().isHexadecimal().isLength({ min: 64, max: 64 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      if (req.body.name === undefined && req.body.definition === undefined) return res.status(400).json({ error: 'No fields to update' });
      const definition = req.body.definition === undefined ? undefined : normalizeMandatoryParticipantShell(req.body.definition);
      if (definition) {
        delete definition.mediaManifest;
        definition.isDraft = req.body.save_mode === 'draft';
      }
      if (definition && !definition.isDraft && (rejectInvalidAois(res, definition) || rejectInvalidSurveys(res, definition))) return;
      const row = await withMediaWrite(pool, async client => {
        const current = (await client.query('SELECT * FROM protocols WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
        if (!current || !(await hasProjectMembership(client, current.project_id, req.user))) throw new HttpError(404, 'Not found', 'protocol_not_found');
        if ((req.body.expected_revision && req.body.expected_revision !== protocolRevision(current))
          || (req.body.expected_updated_at && new Date(req.body.expected_updated_at).getTime() !== new Date(current.updated_at).getTime())) {
          throw new HttpError(409, 'Protocol was changed by another researcher. Reload before saving.', 'protocol_revision_conflict');
        }
        if (definition && !definition.isDraft) {
          const report = await inspectProtocolStimuli(client, current.project_id, definition, { user: req.user });
          if (!report.ok) throw new HttpError(422, 'Protocol references unavailable or private stimulus files', 'protocol_stimulus_unavailable');
        }
        if (definition?.isDraft) await checkDraftStimulusAccess(client, current.project_id, definition, req.user);
        const pinned = definition ? (definition.isDraft ? definition : await pinProtocolMedia(client, current.project_id, definition, req.user)) : current.definition;
        return (await client.query(`UPDATE protocols SET name = $1, definition = $2::jsonb, updated_at = current_timestamp
           WHERE id = $3 RETURNING id, project_id, name, definition, updated_at`,
          [req.body.name === undefined ? current.name : req.body.name, JSON.stringify(pinned), current.id])).rows[0];
      });
      return res.json(publicProtocol(row));
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ error: error.message, code: error.code });
      if (error.code === '23505') return rejectProtocolConflict(res, error);
      return res.status(500).json({ error: 'Update failed' });
    }
  });

router.delete(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.PROTOCOL_WRITE),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      await withMediaWrite(pool, async client => {
        const row = (await client.query('SELECT * FROM protocols WHERE id = $1', [req.params.id])).rows[0];
        if (!row || !(await hasProjectMembership(client, row.project_id, req.user))) throw new HttpError(404, 'Not found', 'protocol_not_found');
        // Admission locks invitations too. Serialize deletion with a participant starting a run.
        await client.query('SELECT id FROM invitations WHERE protocol_id = $1 ORDER BY id FOR UPDATE', [row.id]);
        await client.query('SELECT id FROM protocols WHERE id = $1 FOR UPDATE', [row.id]);
        const sessions = await client.query('SELECT 1 FROM sessions WHERE protocol_id = $1 LIMIT 1', [row.id]);
        if (sessions.rows.length) throw new HttpError(409, 'Protocol has collected sessions and cannot be deleted', 'protocol_has_sessions');
        await client.query('DELETE FROM protocols WHERE id = $1', [row.id]);
      });
      res.status(204).send();
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
      console.error(err);
      res.status(500).json({ error: 'Delete failed' });
    }
  }
);

module.exports = router;
