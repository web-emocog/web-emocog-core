exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE session_erasure_tombstones (
      session_key_hash char(64) PRIMARY KEY CHECK (session_key_hash ~ '^[a-f0-9]{64}$'),
      erased_at timestamptz NOT NULL DEFAULT current_timestamp
    );
    CREATE FUNCTION reject_erased_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.session_erasure_tombstones
        WHERE session_key_hash = encode(sha256(convert_to(NEW.session_id, 'UTF8')), 'hex')) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Session has been erased',
          CONSTRAINT = 'session_erasure_tombstone';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER session_erasure_guard BEFORE INSERT OR UPDATE OF session_id ON sessions
      FOR EACH ROW EXECUTE FUNCTION reject_erased_session();
  `);
};

exports.down = pgm => {
  // Removing a live erasure ledger would allow old participant tokens to recreate data.
  pgm.sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM session_erasure_tombstones) THEN
      RAISE EXCEPTION 'Cannot remove a non-empty session erasure ledger';
    END IF;
  END $$;
  DROP TRIGGER session_erasure_guard ON sessions;
  DROP FUNCTION reject_erased_session();
  DROP TABLE session_erasure_tombstones;`);
};
