/**
 * Immutable analytics selections and protocol-name integrity.
 */
exports.up = pgm => {
  pgm.createTable('analysis_snapshots', {
    id: { type: 'uuid', primaryKey: true },
    project_id: {
      type: 'integer',
      notNull: true,
      references: 'projects',
      onDelete: 'CASCADE',
    },
    protocol_id: {
      type: 'integer',
      notNull: true,
      references: 'protocols',
      onDelete: 'CASCADE',
    },
    created_by_user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    query: { type: 'jsonb', notNull: true },
    included_session_ids: { type: 'jsonb', notNull: true, default: '[]' },
    excluded_sessions: { type: 'jsonb', notNull: true, default: '[]' },
    dataset_hash: { type: 'varchar(80)', notNull: true },
    versions: { type: 'jsonb', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });
  pgm.createIndex('analysis_snapshots', ['project_id', 'created_at']);
  pgm.createIndex('analysis_snapshots', ['protocol_id', 'created_at']);
  pgm.createIndex('analysis_snapshots', 'created_by_user_id');
  pgm.sql(`
    CREATE UNIQUE INDEX protocols_project_name_ci_unique
    ON protocols (project_id, lower(name));
  `);
};

exports.down = pgm => {
  pgm.sql('DROP INDEX IF EXISTS protocols_project_name_ci_unique');
  pgm.dropTable('analysis_snapshots', { ifExists: true });
};
