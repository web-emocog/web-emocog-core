exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE invitations ADD COLUMN publication_version integer;
    CREATE TABLE protocol_publications (
      protocol_id integer PRIMARY KEY REFERENCES protocols(id) ON DELETE CASCADE,
      code varchar(64) UNIQUE NOT NULL,
      invitation_id integer REFERENCES invitations(id) ON DELETE SET NULL,
      version integer NOT NULL CHECK (version > 0)
    );
    UPDATE invitations i SET publication_version = ranked.version
      FROM (SELECT id, row_number() OVER (PARTITION BY protocol_id ORDER BY created_at, id)::integer AS version
            FROM invitations) ranked WHERE ranked.id = i.id;
    INSERT INTO protocol_publications(protocol_id, code, invitation_id, version)
      SELECT DISTINCT ON (protocol_id) protocol_id, code, id,
        max(publication_version) OVER (PARTITION BY protocol_id)
      FROM invitations ORDER BY protocol_id,
        ((expires_at IS NULL OR expires_at > current_timestamp) AND (max_runs IS NULL OR used_runs < max_runs)) DESC,
        created_at DESC, id DESC;
  `);
};

exports.down = pgm => {
  pgm.sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM protocol_publications p JOIN invitations i ON i.id = p.invitation_id
               WHERE p.code <> i.code) THEN
      RAISE EXCEPTION 'Stable links have been published: restore a coordinated backup instead of dropping them';
    END IF;
  END $$;
  DROP TABLE protocol_publications;
  ALTER TABLE invitations DROP COLUMN publication_version;`);
};
