async function findInvitationByCode(queryable, code, options = {}) {
  const lockClause = options.forUpdate ? ' FOR UPDATE OF i' : '';
  const result = await queryable.query(
    `SELECT i.id, i.protocol_id, i.code, i.max_runs, i.used_runs, i.expires_at,
            pr.name AS protocol_name, pr.project_id,
            pr.definition AS protocol_definition
     FROM invitations i
     INNER JOIN protocols pr ON pr.id = i.protocol_id
     WHERE i.code = $1${lockClause}`,
    [String(code)]
  );
  return result.rows[0] || null;
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
  reserveInvitationRun,
};
