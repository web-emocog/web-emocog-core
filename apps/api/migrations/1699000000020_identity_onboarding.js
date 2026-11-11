exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
    CREATE TABLE identity_challenges (
      id uuid PRIMARY KEY,
      purpose text NOT NULL CHECK (purpose IN ('signup', 'claim', 'reset', 'verify')),
      email varchar(255) NOT NULL,
      user_id integer REFERENCES users(id) ON DELETE CASCADE,
      token_version integer,
      token_hash char(64) NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT current_timestamp,
      CHECK ((purpose = 'signup' AND user_id IS NULL AND token_version IS NULL)
        OR (purpose IN ('claim','reset','verify') AND user_id IS NOT NULL AND token_version IS NOT NULL))
    );
    CREATE INDEX identity_challenges_email ON identity_challenges(email, purpose);
    CREATE TABLE identity_email_throttles (
      bucket char(64) PRIMARY KEY,
      requested_at timestamptz NOT NULL DEFAULT current_timestamp
    );
    CREATE TABLE workspace_invitations (
      id uuid PRIMARY KEY,
      organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      email varchar(255) NOT NULL,
      role text NOT NULL DEFAULT 'member' CHECK (role = 'member'),
      token_hash char(64) NOT NULL UNIQUE,
      created_by integer REFERENCES users(id) ON DELETE SET NULL,
      expires_at timestamptz NOT NULL,
      accepted_at timestamptz,
      accepted_by integer REFERENCES users(id) ON DELETE SET NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT current_timestamp
    );
    CREATE INDEX workspace_invitations_scope ON workspace_invitations(organization_id, project_id);
    CREATE TABLE identity_mail_outbox (
      id uuid PRIMARY KEY,
      challenge_id uuid REFERENCES identity_challenges(id) ON DELETE CASCADE,
      invitation_id uuid REFERENCES workspace_invitations(id) ON DELETE CASCADE,
      payload_cipher text,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
      next_attempt_at timestamptz NOT NULL DEFAULT current_timestamp,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT current_timestamp,
      finished_at timestamptz,
      CHECK ((challenge_id IS NULL) <> (invitation_id IS NULL))
    );
    CREATE INDEX identity_mail_outbox_pending ON identity_mail_outbox(next_attempt_at) WHERE status = 'pending';
  `);
};

exports.down = pgm => pgm.sql(`
  DROP TABLE identity_mail_outbox;
  DROP TABLE workspace_invitations;
  DROP TABLE identity_email_throttles;
  DROP TABLE identity_challenges;
  ALTER TABLE users DROP COLUMN email_verified_at;
`);
