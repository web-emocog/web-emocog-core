/**
 * Scoped access for proxy metrics (inherits session/project org boundaries).
 */
const { pool } = require('../db');
const {
  isPlatformAdmin,
  hasProjectMembership,
  hasProtocolMembership,
} = require('../security/permissions');

function scopedSessionJoin(userParamIdx) {
  return `
    LEFT JOIN protocols sp ON sp.id = s.protocol_id
    INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
    INNER JOIN user_organizations uo_scope
      ON uo_scope.organization_id = p_scope.organization_id
     AND uo_scope.user_id = $${userParamIdx}
    INNER JOIN user_projects up_scope
      ON up_scope.project_id = p_scope.id
     AND up_scope.user_id = uo_scope.user_id
  `;
}

async function getSessionForUser(sessionRef, user) {
  const isNumericId = /^\d+$/.test(String(sessionRef));
  const platform = isPlatformAdmin(user);
  const sql = `
    SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id,
           s.started_at, s.stopped_at
    FROM sessions s
    ${platform ? '' : scopedSessionJoin(2)}
    WHERE ${isNumericId ? 's.id = $1' : 's.session_id = $1'}
  `;
  const r = await pool.query(sql, platform ? [sessionRef] : [sessionRef, user.sub]);
  return r.rows[0] || null;
}

async function ensureProjectAccess(projectId, user) {
  return hasProjectMembership(pool, projectId, user);
}

async function ensureProtocolAccess(protocolId, user) {
  const allowed = await hasProtocolMembership(pool, protocolId, user);
  if (!allowed) return null;
  const r = await pool.query(
    'SELECT id, project_id FROM protocols WHERE id = $1',
    [protocolId]
  );
  return r.rows[0] || null;
}

module.exports = {
  scopedSessionJoin,
  getSessionForUser,
  ensureProjectAccess,
  ensureProtocolAccess,
};
