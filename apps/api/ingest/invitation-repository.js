async function findInvitationByCode(queryable, code, options = {}) {
  const lockClause = options.forUpdate ? ' FOR UPDATE OF i' : '';
  const result = await queryable.query(
    `SELECT i.id, i.protocol_id, i.code, i.max_runs, i.used_runs, i.expires_at, i.publication_version,
            COALESCE(i.protocol_definition->>'title', pr.name) AS protocol_name, pr.project_id,
            COALESCE(i.protocol_definition, pr.definition) AS protocol_definition
     FROM invitations i
     INNER JOIN protocols pr ON pr.id = i.protocol_id
     WHERE i.code = $1${lockClause}`,
    [String(code)]
  );
  return result.rows[0] || null;
}

// Only the entry lookup follows a stable link. Media and admission use the
// returned immutable invitation code, even if publication happens mid-session.
async function findPublishedInvitation(queryable, code, sessionId) {
  const publication = (await queryable.query(
    'SELECT protocol_id, invitation_id FROM protocol_publications WHERE code = $1', [String(code)]
  )).rows[0];
  if (!publication) return findInvitationByCode(queryable, code);
  const pinned = sessionId ? (await queryable.query(
    'SELECT invitation_id FROM sessions WHERE session_id = $1 AND protocol_id = $2',
    [String(sessionId), publication.protocol_id]
  )).rows[0] : null;
  const invitationId = pinned?.invitation_id || publication.invitation_id;
  if (!invitationId) return null;
  const invitation = (await queryable.query(
    'SELECT code FROM invitations WHERE id = $1 AND protocol_id = $2', [invitationId, publication.protocol_id]
  )).rows[0];
  return invitation ? findInvitationByCode(queryable, invitation.code) : null;
}

async function reserveInvitationRun(client, invitationId) {
  const result = await client.query(
    `UPDATE invitations
     SET used_runs = used_runs + 1
     WHERE id = $1
       AND (max_runs IS NULL OR used_runs < max_runs)
     RETURNING id, used_runs, max_runs`,
    [invitationId]
  );
  return result.rows[0] || null;
}

module.exports = {
  findInvitationByCode,
  findPublishedInvitation,
  reserveInvitationRun,
};
