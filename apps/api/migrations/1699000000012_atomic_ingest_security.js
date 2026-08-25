/**
 * S2-01: immutable invitation/session binding and atomic invitation quotas.
 */
exports.up = pgm => {
  pgm.addColumns('invitations', {
    used_runs: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addColumns('sessions', {
    invitation_id: {
      type: 'integer',
      references: 'invitations',
      onDelete: 'SET NULL',
    },
  });
  pgm.createIndex('sessions', 'invitation_id');

  pgm.sql(`
    UPDATE sessions s
    SET invitation_id = i.id
    FROM session_features sf, invitations i, protocols pr
    WHERE sf.session_id = s.id
      AND i.code = sf.payload->'ids'->>'invitationCode'
      AND pr.id = i.protocol_id
      AND s.protocol_id = i.protocol_id
      AND s.project_id = pr.project_id
      AND s.invitation_id IS NULL;

    UPDATE invitations i
    SET used_runs = LEAST(
      CASE WHEN i.max_runs IS NULL THEN counts.n ELSE i.max_runs END,
      counts.n
    )
    FROM (
      SELECT invitation_id, COUNT(*)::integer AS n
      FROM sessions
      WHERE invitation_id IS NOT NULL
      GROUP BY invitation_id
    ) counts
    WHERE counts.invitation_id = i.id;
  `);

  pgm.addConstraint(
    'invitations',
    'invitations_used_runs_nonnegative',
    'CHECK (used_runs >= 0)'
  );
  pgm.addConstraint(
    'invitations',
    'invitations_used_runs_within_limit',
    'CHECK (max_runs IS NULL OR used_runs <= max_runs)'
  );
};

exports.down = pgm => {
  pgm.dropConstraint('invitations', 'invitations_used_runs_within_limit', {
    ifExists: true,
  });
  pgm.dropConstraint('invitations', 'invitations_used_runs_nonnegative', {
    ifExists: true,
  });
  pgm.dropIndex('sessions', 'invitation_id', { ifExists: true });
  pgm.dropColumns('sessions', ['invitation_id'], { ifExists: true });
  pgm.dropColumns('invitations', ['used_runs'], { ifExists: true });
};
