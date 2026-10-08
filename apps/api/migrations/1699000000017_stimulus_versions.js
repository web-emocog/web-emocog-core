exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE stimuli ADD COLUMN created_by integer REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE stimuli ADD COLUMN visibility text NOT NULL DEFAULT 'project'
      CHECK (visibility IN ('private', 'project'));
    ALTER TABLE stimulus_folders ADD COLUMN created_by integer REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE stimulus_folders ADD COLUMN visibility text NOT NULL DEFAULT 'project'
      CHECK (visibility IN ('private', 'project'));
    CREATE INDEX stimuli_owner_scope ON stimuli(project_id, visibility, created_by);
    CREATE TABLE stimulus_versions (
      id uuid PRIMARY KEY,
      stimulus_id integer NOT NULL REFERENCES stimuli(id) ON DELETE CASCADE,
      content_path text NOT NULL,
      mime_type text NOT NULL,
      size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
      sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      preview_path text,
      media_info jsonb NOT NULL DEFAULT '{}'::jsonb,
      preview_status text NOT NULL DEFAULT 'pending'
        CHECK (preview_status IN ('pending', 'ready', 'unsupported', 'failed')),
      created_at timestamptz NOT NULL DEFAULT current_timestamp,
      UNIQUE (stimulus_id, content_path)
    );
    ALTER TABLE stimuli ADD COLUMN current_version_id uuid REFERENCES stimulus_versions(id) ON DELETE SET NULL;
    ALTER TABLE stimulus_versions ADD CONSTRAINT stimulus_version_identity UNIQUE(stimulus_id, id);
    ALTER TABLE stimuli ADD CONSTRAINT stimulus_current_version_identity FOREIGN KEY(id, current_version_id)
      REFERENCES stimulus_versions(stimulus_id, id) DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE invitations ADD COLUMN protocol_definition jsonb;
    UPDATE invitations i SET protocol_definition = pr.definition
      FROM protocols pr WHERE pr.id = i.protocol_id;
    CREATE INDEX stimulus_versions_stimulus ON stimulus_versions(stimulus_id);
    CREATE FUNCTION protect_stimulus_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF (NEW.stimulus_id, NEW.content_path, NEW.mime_type, NEW.size_bytes, NEW.created_at)
         IS DISTINCT FROM (OLD.stimulus_id, OLD.content_path, OLD.mime_type, OLD.size_bytes, OLD.created_at)
         OR (OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256) THEN
        RAISE EXCEPTION 'Immutable media version cannot be changed';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER immutable_stimulus_version BEFORE UPDATE ON stimulus_versions
      FOR EACH ROW EXECUTE FUNCTION protect_stimulus_version();
    CREATE FUNCTION protect_invitation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.protocol_definition ? 'mediaManifest' AND NEW.protocol_definition IS DISTINCT FROM OLD.protocol_definition THEN
        RAISE EXCEPTION 'Published invitation definition cannot be changed';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER immutable_invitation_snapshot BEFORE UPDATE ON invitations
      FOR EACH ROW EXECUTE FUNCTION protect_invitation_snapshot();
  `);
};

exports.down = pgm => {
  // Refuse a destructive rollback once immutable media has been adopted.
  pgm.sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM stimulus_versions)
       OR EXISTS (SELECT 1 FROM stimuli WHERE visibility = 'private')
       OR EXISTS (SELECT 1 FROM stimulus_folders WHERE visibility = 'private')
       OR EXISTS (SELECT 1 FROM invitations i JOIN protocols pr ON pr.id = i.protocol_id
         WHERE i.protocol_definition IS DISTINCT FROM pr.definition) THEN
      RAISE EXCEPTION 'Media versions exist: restore the coordinated pre-migration backup instead';
    END IF;
  END $$;
  DROP TRIGGER IF EXISTS immutable_invitation_snapshot ON invitations;
  DROP FUNCTION IF EXISTS protect_invitation_snapshot();
  ALTER TABLE invitations DROP COLUMN protocol_definition;
  ALTER TABLE stimuli DROP COLUMN current_version_id;
  DROP TABLE stimulus_versions;
  DROP FUNCTION IF EXISTS protect_stimulus_version();
  DROP INDEX stimuli_owner_scope;
  ALTER TABLE stimulus_folders DROP COLUMN visibility, DROP COLUMN created_by;
  ALTER TABLE stimuli DROP COLUMN visibility, DROP COLUMN created_by;`);
};
