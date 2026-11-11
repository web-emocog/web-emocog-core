exports.up = pgm => pgm.sql(`
  CREATE TABLE media_storage_objects (
    organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    content_path text NOT NULL,
    size_bytes bigint CHECK (size_bytes >= 0),
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (organization_id, content_path)
  );
  INSERT INTO media_storage_objects(organization_id, content_path, size_bytes)
    SELECT p.organization_id, v.content_path, max(v.size_bytes)
    FROM stimulus_versions v JOIN stimuli s ON s.id=v.stimulus_id
    JOIN projects p ON p.id=s.project_id GROUP BY p.organization_id,v.content_path;
  INSERT INTO media_storage_objects(organization_id, content_path, size_bytes)
    SELECT p.organization_id, COALESCE(s.metadata->>'content_path', s.metadata->>'contentPath'), NULL
    FROM stimuli s JOIN projects p ON p.id=s.project_id
    WHERE COALESCE(s.metadata->>'content_path', s.metadata->>'contentPath') IS NOT NULL
    ON CONFLICT DO NOTHING;
  INSERT INTO media_storage_objects(organization_id, content_path, size_bytes)
    SELECT p.organization_id,v.preview_path,NULL FROM stimulus_versions v
    JOIN stimuli s ON s.id=v.stimulus_id JOIN projects p ON p.id=s.project_id
    WHERE v.preview_path IS NOT NULL ON CONFLICT DO NOTHING;
  CREATE TABLE media_operations (
    id uuid PRIMARY KEY,
    actor_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    operation_key varchar(128) NOT NULL,
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    descriptor jsonb NOT NULL,
    artifacts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(artifacts)='array'),
    state text NOT NULL CHECK (state IN ('reserved','receiving','processing','completed','failed','uncertain')),
    reserved_bytes bigint NOT NULL CHECK (reserved_bytes >= 0),
    disk_bytes bigint NOT NULL CHECK (disk_bytes >= 0),
    result_status integer,
    result jsonb,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT current_timestamp,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp,
    expires_at timestamptz NOT NULL,
    UNIQUE(actor_id,operation_key),
    CHECK ((state IN ('completed','failed')) = (reserved_bytes=0 AND disk_bytes=0)),
    CHECK (state <> 'completed' OR (result IS NOT NULL AND result_status IN (200,201)))
  );
  CREATE INDEX media_operations_active ON media_operations(organization_id,actor_id)
    WHERE state IN ('reserved','receiving','processing','uncertain');
  CREATE FUNCTION guard_active_media_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS (SELECT 1 FROM media_operations WHERE state IN ('reserved','receiving','processing','uncertain')
      AND CASE TG_TABLE_NAME WHEN 'users' THEN actor_id=OLD.id
        WHEN 'projects' THEN project_id=OLD.id ELSE organization_id=OLD.id END) THEN
      RAISE EXCEPTION 'Active media operations require reconciliation before deletion' USING ERRCODE='23503';
    END IF;
    RETURN OLD;
  END $$;
  CREATE TRIGGER media_actor_deletion BEFORE DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION guard_active_media_deletion();
  CREATE TRIGGER media_project_deletion BEFORE DELETE ON projects
    FOR EACH ROW EXECUTE FUNCTION guard_active_media_deletion();
  CREATE TRIGGER media_organization_deletion BEFORE DELETE ON organizations
    FOR EACH ROW EXECUTE FUNCTION guard_active_media_deletion();
`);

exports.down = pgm => pgm.sql(`
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM media_operations) THEN
      RAISE EXCEPTION 'Media operation history exists; restore a coordinated backup instead';
    END IF;
  END $$;
  DROP TRIGGER media_actor_deletion ON users;
  DROP TRIGGER media_project_deletion ON projects;
  DROP TRIGGER media_organization_deletion ON organizations;
  DROP FUNCTION guard_active_media_deletion();
  DROP TABLE media_operations;
  DROP TABLE media_storage_objects;
`);
