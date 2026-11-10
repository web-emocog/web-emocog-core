const { HttpError } = require('../security/http-error');
const { logUnexpectedError } = require('../security/error-log');
const { resolveCurrentStaffPrincipal, canRolePerform, isPlatformAdmin, OPERATIONS } = require('../middleware/auth');
const config = require('../config');
const { LIMITS, buildReproducibilityExport, reproducibilityCsv } = require('./reproducibility');

let active = 0;
function parseSelection(query) {
  const allowed = new Set(['project_id', 'protocol_id', 'protocol_version', 'session_id', 'session_db_id', 'date_from', 'date_to', 'format']);
  if (Object.keys(query).some(key => !allowed.has(key)) || Object.values(query).some(value => typeof value !== 'string')) {
    throw new HttpError(400, 'Unknown or repeated export parameter', 'export_selection_invalid');
  }
  const dbId = value => /^[1-9]\d*$/.test(value || '') && Number(value) <= 2147483647 ? Number(value) : null;
  const projectId = dbId(query.project_id), protocolId = query.protocol_id == null ? null : dbId(query.protocol_id);
  if (!projectId || (query.protocol_id != null && !protocolId)) throw new HttpError(400, 'Select a project and valid protocol', 'export_selection_invalid');
  const sessionDbId = query.session_db_id == null ? null : dbId(query.session_db_id);
  if (query.session_db_id != null && (!sessionDbId || query.session_id != null)) throw new HttpError(400, 'Invalid session selector', 'export_selection_invalid');
  if (query.session_id != null && !/^[A-Za-z0-9_-]{1,128}$/.test(query.session_id)) throw new HttpError(400, 'Invalid session selector', 'export_selection_invalid');
  if (query.protocol_version != null && (!protocolId || (query.protocol_version !== 'legacy'
    && (!/^(?:publication|invitation):[1-9]\d{0,9}$/.test(query.protocol_version)
      || !dbId(query.protocol_version.split(':')[1]))))) {
    throw new HttpError(400, 'Select a publication identity', 'export_selection_invalid');
  }
  if (query.format != null && !['json', 'csv'].includes(query.format)) throw new HttpError(400, 'Invalid export format', 'export_selection_invalid');
  for (const field of ['date_from', 'date_to']) if (query[field] != null
    && (!/^\d{4}-\d{2}-\d{2}T/.test(query[field]) || !Number.isFinite(Date.parse(query[field])))) {
    throw new HttpError(400, 'Use ISO date-time boundaries', 'export_selection_invalid');
  }
  if (query.date_from && query.date_to && Date.parse(query.date_from) > Date.parse(query.date_to)) {
    throw new HttpError(400, 'Invalid date range', 'export_selection_invalid');
  }
  return { projectId, protocolId, sessionId: query.session_id, sessionDbId, version: query.protocol_version,
    from: query.date_from, to: query.date_to, format: query.format || 'json' };
}

async function requireProjectAccess(db, user, projectId) {
  const result = await db.query(`SELECT p.id FROM projects p WHERE p.id = $1 AND ($3::boolean OR (
    EXISTS (SELECT 1 FROM user_organizations uo WHERE uo.organization_id = p.organization_id AND uo.user_id = $2)
    AND EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id = p.id AND up.user_id = $2)))`,
  [projectId, user.sub, isPlatformAdmin(user)]);
  if (result.rows.length !== 1) throw new HttpError(403, 'Project export is not permitted', 'export_project_forbidden');
}

function selectionSql(selection) {
  const params = [selection.projectId], where = ['s.project_id = $1'];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (selection.protocolId) add('s.protocol_id = ?', selection.protocolId);
  if (selection.sessionId) add('s.session_id = ?', selection.sessionId);
  if (selection.sessionDbId) add('s.id = ?', selection.sessionDbId);
  if (selection.from) add('s.started_at >= ?::timestamptz', selection.from);
  if (selection.to) add('s.started_at <= ?::timestamptz', selection.to);
  if (selection.version === 'legacy') where.push('s.invitation_id IS NULL');
  else if (selection.version?.startsWith('publication:')) add('i.publication_version = ?::int', selection.version.split(':')[1]);
  else if (selection.version?.startsWith('invitation:')) {
    add('i.id = ?::int', selection.version.split(':')[1]);
    where.push('i.publication_version IS NULL');
  }
  return { params, where: where.join(' AND ') };
}

function createReproducibilityHandler({ pool, resolvePrincipal = resolveCurrentStaffPrincipal, limits = LIMITS,
  pseudonymKey = config.jwt.secret } = {}) {
  return async (req, res) => {
    let client = null, transaction = false, ownsSlot = false;
    try {
      const selection = parseSelection(req.query);
      if (active >= limits.concurrent) throw new HttpError(503, 'Export capacity is busy; retry later', 'export_busy');
      active++; ownsSlot = true;
      client = await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      transaction = true;
      await client.query("SET LOCAL statement_timeout = '10s'");
      await requireProjectAccess(client, req.user, selection.projectId);
      const { params, where } = selectionSql(selection);
      // Size gate before transferring JSONB to Node; the same read snapshot owns both reads.
      const metadata = await client.query(`SELECT s.id, COALESCE(octet_length(f.payload::text), 0) AS source_bytes
        FROM sessions s LEFT JOIN invitations i ON i.id = s.invitation_id
        LEFT JOIN session_features f ON f.session_id = s.id WHERE ${where}
        ORDER BY s.id ASC LIMIT ${limits.sessions + 1}`, params);
      if (metadata.rows.length > limits.sessions) throw new HttpError(413, 'Select fewer sessions', 'export_session_limit');
      if (metadata.rows.reduce((sum, row) => sum + Number(row.source_bytes), 0) > limits.sourceBytes) {
        throw new HttpError(413, 'Select fewer sessions', 'export_source_limit');
      }
      const ids = metadata.rows.map(row => row.id);
      const rows = ids.length ? (await client.query(`SELECT s.id, s.session_id, s.participant_id, s.project_id,
        s.protocol_id, s.invitation_id, i.publication_version, f.payload AS features_payload
        FROM sessions s LEFT JOIN invitations i ON i.id = s.invitation_id
        LEFT JOIN session_features f ON f.session_id = s.id
        WHERE s.id = ANY($1::int[]) AND s.project_id = $2 ORDER BY s.id ASC`, [ids, selection.projectId])).rows : [];
      if (rows.length !== ids.length) throw new HttpError(409, 'Session selection changed', 'export_selection_changed');
      await client.query('COMMIT'); transaction = false;
      client.release(); client = null;
      const exportSelection = { projectId: selection.projectId, protocolId: selection.protocolId,
        protocolVersion: selection.version || null, dateFrom: selection.from || null, dateTo: selection.to || null,
        sessionDbId: selection.sessionDbId, filterSemantics: 'explicit_selection_not_analytics_snapshot' };
      const bundle = buildReproducibilityExport(rows, { pseudonymKey, limits, selection: exportSelection });
      const body = selection.format === 'csv' ? reproducibilityCsv(bundle) : JSON.stringify(bundle);
      if (Buffer.byteLength(body) > limits.outputBytes) throw new HttpError(413, 'Select fewer sessions', 'export_output_limit');
      // A new committed view, not the old REPEATABLE READ membership snapshot.
      const principal = await resolvePrincipal(pool, req.headers.authorization,
        req.headers.authorization?.startsWith('Bearer ') ? null : req.cookies?.[config.auth.staffCookieName]);
      if (!principal || String(principal.sub) !== String(req.user.sub)
        || (!isPlatformAdmin(principal) && !canRolePerform(principal.role, OPERATIONS.EXPORT_READ))) {
        throw new HttpError(403, 'Export permission was revoked', 'export_permission_revoked');
      }
      await requireProjectAccess(pool, principal, selection.projectId);
      if (ids.length) {
        const current = await pool.query('SELECT id FROM sessions WHERE project_id = $1 AND id = ANY($2::int[])', [selection.projectId, ids]);
        if (current.rows.length !== ids.length) throw new HttpError(409, 'Session selection changed', 'export_selection_changed');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Contract', bundle.schemaVersion);
      res.setHeader('Content-Type', selection.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="wecog-reproducibility.${selection.format}"`);
      return res.send(body);
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 503) res.setHeader('Retry-After', '5');
        return res.status(error.status).json({ code: error.code, error: error.message });
      }
      logUnexpectedError(error, 'reproducibility_export');
      return res.status(500).json({ code: 'export_failed', error: 'Export failed' });
    } finally {
      if (transaction) await client.query('ROLLBACK').catch(() => {});
      client?.release();
      if (ownsSlot) active--;
    }
  };
}

module.exports = { createReproducibilityHandler, parseSelection, selectionSql };
