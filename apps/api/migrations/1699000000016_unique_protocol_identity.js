exports.up = (pgm) => {
  pgm.sql(`
    WITH duplicate_protocol_ids AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY project_id, lower(btrim(definition->>'protocolId'))
               ORDER BY updated_at DESC, id DESC
             ) AS duplicate_rank
      FROM protocols
      WHERE nullif(btrim(definition->>'protocolId'), '') IS NOT NULL
    )
    UPDATE protocols AS protocol
    SET definition = jsonb_set(
          protocol.definition,
          '{protocolId}',
          to_jsonb((btrim(protocol.definition->>'protocolId') || '-legacy-' || protocol.id)::text),
          true
        ),
        updated_at = current_timestamp
    FROM duplicate_protocol_ids AS duplicate
    WHERE protocol.id = duplicate.id
      AND duplicate.duplicate_rank > 1;

    CREATE UNIQUE INDEX protocols_project_protocol_id_unique
      ON protocols (project_id, lower(btrim(definition->>'protocolId')))
      WHERE nullif(btrim(definition->>'protocolId'), '') IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS protocols_project_protocol_id_unique');
};
