/**
 * Scoped access for proxy metrics (inherits session/project org boundaries).
 */
const { pool } = require('../db');

function scopedSessionJoin(userParamIdx) {
  return `
    LEFT JOIN protocols sp ON sp.id = s.protocol_id
    INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
    INNER JOIN user_organizations uo_scope
      ON uo_scope.organization_id = p_scope.organization_id
     AND uo_scope.user_id = $${userParamIdx}
  `;
}

async function getSessionForUser(sessionRef, userId) {
  const isNumericId = /^\d+$/.test(String(sessionRef));
  const sql = `
    SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id,
           s.started_at, s.stopped_at
    FROM sessions s
    ${scopedSessionJoin(2)}
    WHERE ${isNumericId ? 's.id = $1' : 's.session_id = $1'}
  `;
  const r = await pool.query(sql, [sessionRef, userId]);
  return r.rows[0] || null;
}

async function ensureProjectAccess(projectId, user, globalAccessFn) {
  const globalAccess = globalAccessFn(user);
  if (globalAccess) {
    const r = await pool.query('SELECT id FROM projects WHERE id = $1', [projectId]);
    return !!r.rows[0];
  }
  const r = await pool.query(
    `SELECT 1 FROM projects p
     INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id
     WHERE p.id = $1 AND uo.user_id = $2`,
    [projectId, user.sub]
  );
  return !!r.rows[0];
}

async function ensureProtocolAccess(protocolId, user, globalAccessFn) {
  const globalAccess = globalAccessFn(user);
  if (globalAccess) {
    const r = await pool.query('SELECT id, project_id FROM protocols WHERE id = $1', [protocolId]);
    return r.rows[0] || null;
  }
  const r = await pool.query(
    `SELECT pr.id, pr.project_id
     FROM protocols pr
     INNER JOIN projects p ON p.id = pr.project_id
     INNER JOIN user_organizations uo ON uo.organization_id = p.organization_id
     WHERE pr.id = $1 AND uo.user_id = $2`,
    [protocolId, user.sub]
  );
  return r.rows[0] || null;
}

module.exports = {
  scopedSessionJoin,
  getSessionForUser,
  ensureProjectAccess,
  ensureProtocolAccess,
};
