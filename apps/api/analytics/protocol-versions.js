const { HttpError } = require('../security/http-error');

function formatVersion(definition) {
  return String(definition?.version || definition?.schemaVersion || '1.0.0');
}

function sessionVersion(row) {
  if (row.publication_version != null) return `publication:${row.publication_version}`;
  if (row.invitation_id != null) return `invitation:${row.invitation_id}`;
  return 'legacy';
}

async function listProtocolVersions(queryable, ids) {
  if (!ids.length) return new Map();
  const result = await queryable.query(`
    SELECT protocol_id, id AS invitation_id, publication_version, created_at
    FROM invitations WHERE protocol_id = ANY($1::int[]) ORDER BY created_at DESC, id DESC`, [ids]);
  const legacy = await queryable.query(`SELECT DISTINCT protocol_id FROM sessions
    WHERE protocol_id = ANY($1::int[]) AND invitation_id IS NULL`, [ids]);
  const map = new Map(ids.map(id => [Number(id), []]));
  result.rows.forEach(row => map.get(Number(row.protocol_id))?.push({
    version: sessionVersion(row), publicationVersion: row.publication_version,
    invitationId: row.invitation_id, createdAt: row.created_at,
  }));
  legacy.rows.forEach(row => map.get(Number(row.protocol_id))?.push({ version: 'legacy', publicationVersion: null, invitationId: null }));
  return map;
}

async function resolveProtocolVersion(queryable, protocol, version) {
  const publication = /^publication:([1-9]\d*)$/.exec(version);
  const invitation = /^invitation:([1-9]\d*)$/.exec(version);
  if (publication || invitation) {
    if (Number((publication || invitation)[1]) > 2147483647) throw new HttpError(400, 'Invalid publication version', 'analytics_protocol_version_invalid');
    const row = (await queryable.query(`SELECT id, protocol_definition, created_at, publication_version
      FROM invitations WHERE protocol_id = $1 AND ${publication ? 'publication_version' : 'id'} = $2`,
    [protocol.id, (publication || invitation)[1]])).rows[0];
    if (!row?.protocol_definition) throw new HttpError(409, 'Published protocol version is unavailable', 'analytics_protocol_version_mismatch');
    return { ...protocol, definition: row.protocol_definition, updated_at: row.created_at,
      analyticsVersion: version, snapshotInvitationId: row.id, publicationVersion: row.publication_version };
  }
  if (version === 'legacy') return { ...protocol, updated_at: null, analyticsVersion: 'legacy', versionUnknown: true,
    definition: { version: 'legacy', blocks: [], mediaManifest: {} } };
  if (version !== formatVersion(protocol.definition)) {
    throw new HttpError(409, 'Protocol version does not match', 'analytics_protocol_version_mismatch');
  }
  // Compatibility for old clients using a format tag; ambiguous histories must
  // never be silently pooled into one experiment version.
  const published = (await queryable.query('SELECT protocol_definition FROM invitations WHERE protocol_id = $1 AND protocol_definition IS NOT NULL', [protocol.id])).rows;
  const signatures = new Set(published.map(row => JSON.stringify(row.protocol_definition)));
  if (signatures.size > 1) throw new HttpError(409, 'Select a publication version, not a JSON format tag', 'analytics_protocol_version_ambiguous');
  return { ...protocol, analyticsVersion: version };
}

module.exports = { formatVersion, sessionVersion, listProtocolVersions, resolveProtocolVersion };
