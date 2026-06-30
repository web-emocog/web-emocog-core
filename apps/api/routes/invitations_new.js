/**
 * Invitations CRUD (Фаза 4.3). protocol_id, code, max_runs, expires_at. Публичный GET по коду для участника.
 * Файл новый — исходные не удаляем.
 */
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

const STAFF_ROLES = new Set(['admin', 'PI', 'developer', 'researcher', 'analyst', 'assistant']);

function hasGlobalInvitationAccess(user) {
  return !!user && (user.bypass_admin === true || STAFF_ROLES.has(user.role));
}

/** Генерация короткого кода приглашения */
function generateCode() {
  return crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, (c) => (c === '-' ? 'x' : 'y')).slice(0, 12);
}

/**
 * Resolve participant code → invitation row + protocol definition.
 * 1) invitations.code (canonical index)
 * 2) protocols.definition->>'protocolId' (builder slug); auto-upsert invitation row
 */
async function resolveInvitationByCode(code) {
  const byCode = await pool.query(
    `SELECT i.id, i.protocol_id, i.code, i.max_runs, i.expires_at,
            pr.name AS protocol_name, pr.project_id, pr.definition AS protocol_definition
     FROM invitations i
     INNER JOIN protocols pr ON pr.id = i.protocol_id
     WHERE i.code = $1`,
    [code]
  );
  if (byCode.rows[0]) {
    return { row: byCode.rows[0], resolvedVia: 'invitation_code' };
  }

  const bySlug = await pool.query(
    `SELECT id, name, project_id, definition
     FROM protocols
     WHERE definition->>'protocolId' = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [code]
  );
  if (!bySlug.rows[0]) return null;

  const pr = bySlug.rows[0];
  const upsert = await pool.query(
    `INSERT INTO invitations (protocol_id, code, max_runs, expires_at)
     VALUES ($1, $2, NULL, NULL)
     ON CONFLICT (code) DO UPDATE SET protocol_id = EXCLUDED.protocol_id
     RETURNING id, protocol_id, code, max_runs, expires_at`,
    [pr.id, code]
  );
  const inv = upsert.rows[0];
  return {
    row: {
      id: inv.id,
      protocol_id: inv.protocol_id,
      code: inv.code,
      max_runs: inv.max_runs,
      expires_at: inv.expires_at,
      protocol_name: pr.name,
      project_id: pr.project_id,
      protocol_definition: pr.definition,
    },
    resolvedVia: 'protocol_slug',
  };
}

/**
 * GET /invitations/by-code/:code — публичный: по коду вернуть протокол для участника (без auth).
 * Проверка: срок действия, лимит прогонов (если задан).
 */
router.get(
  '/by-code/:code',
  [param('code').trim().notEmpty()],
  async (req, res) => {
    try {
      const code = req.params.code.trim();
      const resolved = await resolveInvitationByCode(code);
      if (!resolved) {
        return res.status(404).json({
          error: 'Invitation not found',
          code,
          hint: 'Код приглашения не зарегистрирован в API. В конструкторе нажмите «Сохранить протокол» (нужен вход в API) или создайте приглашение через POST /invitations.',
        });
      }
      const inv = resolved.row;
      if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
        return res.status(410).json({ error: 'Invitation expired' });
      }
      if (inv.max_runs != null) {
        const count = await pool.query(
          `SELECT COUNT(*) AS n
           FROM session_features sf
           WHERE sf.payload->'ids'->>'invitationCode' = $1`,
          [inv.code]
        );
        const n = parseInt(count.rows[0].n, 10);
        if (n >= inv.max_runs) return res.status(410).json({ error: 'Invitation run limit reached' });
      }
      res.json({
        invitation_id: inv.id,
        code: inv.code,
        protocol_id: inv.protocol_id,
        protocol_name: inv.protocol_name,
        project_id: inv.project_id,
        max_runs: inv.max_runs,
        expires_at: inv.expires_at,
        definition: inv.protocol_definition,
        source: {
          type: resolved.resolvedVia === 'protocol_slug' ? 'protocol_slug' : 'invitation_code',
          value: inv.code,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** Все остальные маршруты — с авторизацией */
router.use(requireAuth);

router.get(
  '/',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  [query('protocol_id').optional().isInt()],
  async (req, res) => {
    try {
      const globalAccess = hasGlobalInvitationAccess(req.user);
      let sql = `
        SELECT i.id, i.protocol_id, i.code, i.max_runs, i.expires_at, i.created_at, pr.name AS protocol_name,
               COALESCE((
                 SELECT COUNT(*)::int
                 FROM session_features sf
                 WHERE sf.payload->'ids'->>'invitationCode' = i.code
               ), 0) AS runs_used
        FROM invitations i
        INNER JOIN protocols pr ON pr.id = i.protocol_id
        INNER JOIN projects p ON p.id = pr.project_id
      `;
      if (!globalAccess) {
        sql += ' INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id';
      }
      sql += globalAccess ? ' WHERE 1=1' : ' WHERE uo.user_id = $1';
      const params = globalAccess ? [] : [req.user.sub];
      if (req.query.protocol_id) {
        params.push(req.query.protocol_id);
        sql += ` AND i.protocol_id = $${params.length}`;
      }
      sql += ' ORDER BY i.created_at DESC';
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
  [
    body('protocol_id').isInt(),
    body('code').optional().matches(/^[a-zA-Z0-9_-]{1,64}$/),
    body('max_runs').optional().isInt({ min: 1 }),
    body('expires_at').optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { protocol_id, max_runs, expires_at } = req.body;
      const globalAccess = hasGlobalInvitationAccess(req.user);
      const check = globalAccess
        ? await pool.query('SELECT 1 FROM protocols WHERE id = $1', [protocol_id])
        : await pool.query(
          `SELECT 1 FROM protocols pr
           INNER JOIN projects p ON p.id = pr.project_id
           INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id
           WHERE pr.id = $1 AND uo.user_id = $2`,
          [protocol_id, req.user.sub]
        );
      if (!check.rows[0]) return res.status(403).json({ error: 'Protocol not found or access denied' });
      let code = req.body.code ? String(req.body.code).trim() : '';
      if (code) {
        const taken = await pool.query(
          'SELECT id, protocol_id FROM invitations WHERE code = $1',
          [code]
        );
        if (taken.rows[0] && parseInt(taken.rows[0].protocol_id, 10) !== parseInt(protocol_id, 10)) {
          return res.status(409).json({ error: 'Invitation code already used for another protocol' });
        }
      } else {
        code = generateCode();
        let exists = await pool.query('SELECT 1 FROM invitations WHERE code = $1', [code]);
        while (exists.rows[0]) {
          code = generateCode();
          exists = await pool.query('SELECT 1 FROM invitations WHERE code = $1', [code]);
        }
      }
      const r = await pool.query(
        `INSERT INTO invitations (protocol_id, code, max_runs, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET
           protocol_id = EXCLUDED.protocol_id,
           max_runs = COALESCE(EXCLUDED.max_runs, invitations.max_runs),
           expires_at = COALESCE(EXCLUDED.expires_at, invitations.expires_at)
         RETURNING id, protocol_id, code, max_runs, expires_at, created_at`,
        [protocol_id, code, max_runs || null, expires_at || null]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === '23503') return res.status(400).json({ error: 'Protocol not found' });
      console.error(err);
      res.status(500).json({ error: 'Create failed' });
    }
  }
);

router.get(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const globalAccess = hasGlobalInvitationAccess(req.user);
      const r = globalAccess
        ? await pool.query(
          `SELECT i.id, i.protocol_id, i.code, i.max_runs, i.expires_at, i.created_at, pr.name AS protocol_name,
                  COALESCE((
                    SELECT COUNT(*)::int
                    FROM session_features sf
                    WHERE sf.payload->'ids'->>'invitationCode' = i.code
                  ), 0) AS runs_used
           FROM invitations i
           INNER JOIN protocols pr ON pr.id = i.protocol_id
           WHERE i.id = $1`,
          [req.params.id]
        )
        : await pool.query(
          `SELECT i.id, i.protocol_id, i.code, i.max_runs, i.expires_at, i.created_at, pr.name AS protocol_name,
                  COALESCE((
                    SELECT COUNT(*)::int
                    FROM session_features sf
                    WHERE sf.payload->'ids'->>'invitationCode' = i.code
                  ), 0) AS runs_used
           FROM invitations i
           INNER JOIN protocols pr ON pr.id = i.protocol_id
           INNER JOIN projects p ON p.id = pr.project_id
           INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id
           WHERE i.id = $1 AND uo.user_id = $2`,
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

router.delete(
  '/:id',
  requireRole('admin', 'PI', 'researcher', 'developer'),
  [param('id').isInt()],
  async (req, res) => {
    try {
      const globalAccess = hasGlobalInvitationAccess(req.user);
      const r = globalAccess
        ? await pool.query(
          'DELETE FROM invitations WHERE id = $1 RETURNING id',
          [req.params.id]
        )
        : await pool.query(
          `DELETE FROM invitations i
           USING protocols pr, projects p, user_organizations uo
           WHERE i.protocol_id = pr.id AND pr.project_id = p.id AND p.organization_id = uo.organization_id AND uo.user_id = $1 AND i.id = $2
           RETURNING i.id`,
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
