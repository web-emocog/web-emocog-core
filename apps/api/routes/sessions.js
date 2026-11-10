const { logUnexpectedError } = require('../security/error-log');
/**
 * Experiment Runtime API: старт/стоп сессии (Фаза 2.4).
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
  hasSessionMembership,
  sessionMembershipPredicate,
} = require('../middleware/auth');
const { getSessionProxyMetrics } = require('./proxy_metrics');
const { withTransaction, lockSessionKey } = require('../db/transaction');
const { HttpError } = require('../security/http-error');

const router = express.Router();

async function ensureProjectAccess(queryable, projectId, user) {
  return hasProjectMembership(queryable, projectId, user);
}

async function getProtocolProjectId(queryable, protocolId) {
  if (!protocolId) return null;
  const r = await queryable.query('SELECT project_id FROM protocols WHERE id = $1', [protocolId]);
  return r.rows[0] ? r.rows[0].project_id : null;
}

function scopedJoinAndWhere(userParamIdx, user) {
  if (isPlatformAdmin(user)) return '';
  return `
    LEFT JOIN protocols sp ON sp.id = s.protocol_id
    INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
    INNER JOIN user_organizations uo_scope ON uo_scope.organization_id = p_scope.organization_id AND uo_scope.user_id = $${userParamIdx}
    INNER JOIN user_projects up_scope ON up_scope.project_id = p_scope.id AND up_scope.user_id = uo_scope.user_id
  `;
}

router.post(
  '/start',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_WRITE),
  [
    body('session_id').trim().notEmpty().isLength({ max: 64 }),
    body('participant_id').optional().trim().isLength({ max: 64 }),
    body('project_id').optional().isInt(),
    body('protocol_id').optional().isInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const result = await withTransaction(pool, async (client) => {
        const { session_id, participant_id } = req.body;
        await lockSessionKey(client, session_id);
        let projectId = req.body.project_id ? parseInt(req.body.project_id, 10) : null;
        const protocolId = req.body.protocol_id ? parseInt(req.body.protocol_id, 10) : null;
        if (protocolId) {
          const protocolProjectId = await getProtocolProjectId(client, protocolId);
          if (!protocolProjectId) throw new HttpError(400, 'Protocol not found');
          if (projectId && projectId !== protocolProjectId) {
            throw new HttpError(400, 'project_id does not match protocol project');
          }
          projectId = protocolProjectId;
        }
        if (!projectId) {
          throw new HttpError(400, 'project_id or protocol_id is required');
        }
        if (!(await ensureProjectAccess(client, projectId, req.user))) {
          throw new HttpError(403, 'Access denied for project');
        }

        const existing = await client.query(
          `SELECT id, session_id, participant_id, project_id, protocol_id,
                  invitation_id, started_at, stopped_at, created_at
           FROM sessions
           WHERE session_id = $1
           FOR UPDATE`,
          [session_id]
        );
        if (existing.rows[0]) {
          const row = existing.rows[0];
          if (!(await hasSessionMembership(client, session_id, req.user))) {
            throw new HttpError(
              409,
              'session_id already belongs to another project',
              'foreign_session_conflict'
            );
          }
          if (
            Number(row.project_id) !== Number(projectId)
            || Number(row.protocol_id || 0) !== Number(protocolId || 0)
          ) {
            throw new HttpError(409, 'session_id scope mismatch', 'session_scope_mismatch');
          }
          if (
            row.participant_id
            && participant_id
            && String(row.participant_id) !== String(participant_id)
          ) {
            throw new HttpError(
              409,
              'session_id participant mismatch',
              'session_participant_mismatch'
            );
          }
          return {
            status: 200,
            body: {
              ...row,
              idempotent: true,
              session_status: row.stopped_at ? 'completed' : 'in_progress',
              completed_at: row.stopped_at || null,
            },
          };
        }

        const inserted = await client.query(
          `INSERT INTO sessions (
             session_id, participant_id, project_id, protocol_id, started_at
           )
           VALUES ($1, $2, $3, $4, current_timestamp)
           RETURNING id, session_id, participant_id, project_id, protocol_id,
                     invitation_id, started_at, stopped_at, created_at`,
          [session_id, participant_id || null, projectId, protocolId]
        );
        const row = inserted.rows[0];
        return {
          status: 201,
          body: {
            ...row,
            idempotent: false,
            session_status: 'in_progress',
            completed_at: null,
          },
        };
      });
      return res.status(result.status).json(result.body);
    } catch (err) {
      if (err.constraint === 'session_erasure_tombstone') {
        return res.status(410).json({ error: 'Session has been erased', code: 'session_erased' });
      }
      if (err instanceof HttpError) {
        return res.status(err.status).json({
          error: err.message,
          code: err.code || 'session_start_rejected',
        });
      }
      logUnexpectedError(err, 'sessions');
      return res.status(500).json({ error: 'Start session failed' });
    }
  }
);

router.post(
  '/stop',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_WRITE),
  [body('session_id').trim().notEmpty().isLength({ max: 64 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const now = new Date();
      const params = [now, req.body.session_id];
      if (!isPlatformAdmin(req.user)) params.push(req.user.sub);
      const r = await pool.query(
        `UPDATE sessions s SET stopped_at = $1, updated_at = current_timestamp
         WHERE s.session_id = $2 AND ${sessionMembershipPredicate(req.user, 3)}
         RETURNING id, session_id, started_at, stopped_at`,
        params
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Session not found or access denied' });
      const row = r.rows[0];
      res.json({
        ...row,
        session_status: row.stopped_at ? 'completed' : 'in_progress',
        completed_at: row.stopped_at || null
      });
    } catch (err) {
      logUnexpectedError(err, 'sessions');
      res.status(500).json({ error: 'Stop session failed' });
    }
  }
);

router.get(
  '/',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_READ),
  [
    query('project_id').optional().isInt(),
    query('protocol_id').optional().isInt(),
    query('protocol_version').optional().isString().isLength({ min: 1, max: 64 }),
    query('include_incomplete').optional().isBoolean(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('qc_validity').optional().isIn(['valid', 'borderline', 'invalid']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      let sql = `
        SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id, s.started_at, s.stopped_at, s.created_at,
               CASE WHEN i.publication_version IS NOT NULL THEN 'publication:' || i.publication_version
                    WHEN i.id IS NOT NULL THEN 'invitation:' || i.id ELSE 'legacy' END AS protocol_version,
               i.publication_version,
               CASE WHEN sf.payload->'experimentMeta'->>'protocolTermination' IS NOT NULL THEN 'aborted'
                    WHEN s.stopped_at IS NULL THEN 'in_progress' ELSE 'completed' END AS session_status,
               s.stopped_at AS completed_at,
               q.qc_score, q.validity AS qc_validity,
               q.fail_reasons AS qc_fail_reasons,
               COALESCE((pm.payload->>'proxy_ready')::boolean, false) AS proxy_ready,
               pm.attention_score, pm.mean_rt_ms, pm.omissions_pct,
               pm.emotion_valence_mean, pm.emotion_arousal_mean, pm.bpm_mean, pm.rppg_sample_count,
               pm.respiration_rate_mean, pm.respiration_sample_count, pm.respiration_available,
               pm.payload AS proxy_metrics
        FROM sessions s
        LEFT JOIN invitations i ON i.id = s.invitation_id
        LEFT JOIN session_features sf ON sf.session_id = s.id
        LEFT JOIN session_qc_summary q ON q.session_id = s.id
        LEFT JOIN session_proxy_metrics pm ON pm.session_id = s.id
        ${scopedJoinAndWhere(1, req.user)}
        WHERE 1=1
      `;
      const params = isPlatformAdmin(req.user) ? [] : [req.user.sub];
      let i = params.length + 1;
      if (req.query.project_id) { params.push(req.query.project_id); sql += ` AND s.project_id = $${i++}`; }
      if (req.query.protocol_id) { params.push(req.query.protocol_id); sql += ` AND s.protocol_id = $${i++}`; }
      if (req.query.include_incomplete === 'false') sql += " AND s.stopped_at IS NOT NULL AND sf.payload->'experimentMeta'->>'protocolTermination' IS NULL";
      if (req.query.protocol_version) {
        const version = String(req.query.protocol_version);
        if (/^(publication|invitation):/.test(version) && Number(version.split(':')[1]) > 2147483647) return res.status(400).json({ error: 'Invalid protocol version' });
        if (version === 'legacy') sql += ' AND s.invitation_id IS NULL';
        else if (/^publication:[1-9]\d*$/.test(version)) { params.push(version.split(':')[1]); sql += ` AND i.publication_version = $${i++}`; }
        else if (/^invitation:[1-9]\d*$/.test(version)) { params.push(version.split(':')[1]); sql += ` AND i.id = $${i++}`; }
        else if (/^(publication|invitation):/.test(version)) return res.status(400).json({ error: 'Invalid protocol version' });
      }
      if (req.query.date_from) { params.push(req.query.date_from); sql += ` AND s.started_at >= $${i++}`; }
      if (req.query.date_to) { params.push(req.query.date_to); sql += ` AND s.started_at <= $${i++}`; }
      if (req.query.qc_validity) { params.push(req.query.qc_validity); sql += ` AND q.validity = $${i++}`; }
      sql += ' ORDER BY s.started_at DESC NULLS LAST LIMIT 500';
      const r = await pool.query(sql, params);
      res.json(r.rows);
    } catch (err) {
      logUnexpectedError(err, 'sessions');
      res.status(500).json({ error: 'Server error' });
    }
  }
);

router.get(
  '/:sessionRef/proxy-metrics',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'developer'),
  requireOperation(OPERATIONS.ANALYTICS_READ),
  [param('sessionRef').trim().notEmpty().isLength({ max: 64 })],
  getSessionProxyMetrics
);

router.get(
  '/:id',
  requireAuth,
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  requireOperation(OPERATIONS.SESSION_READ),
  [param('id').isInt({ min: 1, max: 2147483647 })],
  async (req, res) => {
    try {
      if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid session reference' });
      const params = [req.params.id];
      if (!isPlatformAdmin(req.user)) params.push(req.user.sub);
      const r = await pool.query(
        `SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id, s.started_at, s.stopped_at, s.created_at,
                CASE WHEN s.stopped_at IS NULL THEN 'in_progress' ELSE 'completed' END AS session_status,
                s.stopped_at AS completed_at,
                q.qc_score, q.validity AS qc_validity, q.fail_reasons, q.payload AS qc_payload,
                COALESCE((pm.payload->>'proxy_ready')::boolean, false) AS proxy_ready,
                pm.attention_score, pm.mean_rt_ms, pm.omissions_pct,
                pm.emotion_valence_mean, pm.emotion_arousal_mean, pm.bpm_mean, pm.rppg_sample_count,
                pm.respiration_rate_mean, pm.respiration_sample_count, pm.respiration_available,
                pm.payload AS proxy_metrics, pm.source_payload AS proxy_source_data, sf.payload AS features
         FROM sessions s
         LEFT JOIN session_qc_summary q ON q.session_id = s.id
         LEFT JOIN session_proxy_metrics pm ON pm.session_id = s.id
         LEFT JOIN session_features sf ON sf.session_id = s.id
         WHERE s.id = $1 AND ${sessionMembershipPredicate(req.user, 2)}`,
        params
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      const session = r.rows[0];
      if (session.features?.experimentMeta?.protocolTermination) session.session_status = 'aborted';
      res.json(session);
    } catch (err) {
      logUnexpectedError(err, 'sessions');
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Erasure is deliberately narrower than session.write (assistants cannot erase).
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'PI', 'org_admin', 'researcher'),
  requireOperation(OPERATIONS.SESSION_WRITE),
  [param('id').isInt({ min: 1, max: 2147483647 })],
  async (req, res) => {
    if (!validationResult(req).isEmpty()) {
      return res.status(400).json({ error: 'Invalid session reference', code: 'session_reference_invalid' });
    }
    try {
      const result = await withTransaction(pool, async client => {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        const reference = await client.query('SELECT session_id FROM sessions WHERE id = $1', [req.params.id]);
        if (!reference.rows[0]) throw new HttpError(404, 'Session not found', 'session_not_found');
        await lockSessionKey(client, reference.rows[0].session_id);
        const principal = (await client.query(
          'SELECT id, role, token_version FROM users WHERE id = $1 FOR SHARE', [req.user.sub]
        )).rows[0];
        if (!principal || Number(principal.token_version) !== req.user.ver) {
          throw new HttpError(401, 'Staff access revoked', 'staff_token_revoked');
        }
        if (!['admin', 'PI', 'org_admin', 'researcher'].includes(principal.role)) {
          throw new HttpError(403, 'Session erasure is not permitted', 'session_erasure_denied');
        }
        const row = (await client.query(
          `SELECT s.id, s.session_id, COALESCE(s.project_id, pr.project_id) AS project_id
           FROM sessions s LEFT JOIN protocols pr ON pr.id = s.protocol_id
           WHERE s.id = $1 FOR UPDATE OF s`, [req.params.id]
        )).rows[0];
        if (!row) throw new HttpError(404, 'Session not found', 'session_not_found');
        if (principal.role !== 'admin') {
          const membership = await client.query(
            `SELECT p.id FROM projects p
             JOIN user_organizations uo ON uo.organization_id = p.organization_id AND uo.user_id = $2
             JOIN user_projects up ON up.project_id = p.id AND up.user_id = $2
             WHERE p.id = $1 FOR SHARE OF p, uo, up`, [row.project_id, principal.id]
          );
          if (!membership.rows[0]) throw new HttpError(404, 'Session not found', 'session_not_found');
        }
        await client.query(
          `INSERT INTO session_erasure_tombstones (session_key_hash)
           VALUES (encode(sha256(convert_to($1::text, 'UTF8')), 'hex'))
           ON CONFLICT (session_key_hash) DO NOTHING`, [row.session_id]
        );
        // Snapshots contain IDs and selection filters; exports are computed, not stored.
        const snapshots = await client.query(
          `DELETE FROM analysis_snapshots WHERE project_id = $1 AND (
             included_session_ids @> jsonb_build_array($2::integer)
             OR excluded_sessions @> jsonb_build_array(jsonb_build_object('sessionId', $2::integer))
             OR query->'filters'->'sessionIds' @> jsonb_build_array($2::integer)
             OR query->'filters'->'sessionIds' @> jsonb_build_array($2::text)
             OR query->'filters'->'sessionIds' @> jsonb_build_array($3::text))`,
          [row.project_id, row.id, row.session_id]
        );
        // FK cascades remove features, QC, proxy/source payloads and events together.
        await client.query('DELETE FROM sessions WHERE id = $1', [row.id]);
        return { erased: true, resurrectionBlocked: true, snapshotsRemoved: snapshots.rowCount };
      });
      res.set('Cache-Control', 'no-store');
      return res.json(result);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
      logUnexpectedError(err, 'sessions');
      // COMMIT may have succeeded before a connection error. Do not claim a rollback.
      return res.status(503).json({ error: 'Erasure was not confirmed; verify session state', code: 'session_erasure_unconfirmed' });
    }
  }
);

module.exports = router;
