/**
 * Миграция: протоколы и приглашения (FK для sessions.protocol_id).
 */
exports.up = (pgm) => {
  pgm.createTable('protocols', {
    id: 'id',
    project_id: { type: 'integer', references: 'projects', onDelete: 'CASCADE' },
    name: { type: 'varchar(255)', notNull: true },
    definition: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('protocols', 'project_id');

  pgm.createTable('invitations', {
    id: 'id',
    protocol_id: { type: 'integer', notNull: true, references: 'protocols', onDelete: 'CASCADE' },
    code: { type: 'varchar(64)', notNull: true, unique: true },
    max_runs: { type: 'integer' },
    expires_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('invitations', 'code');
  pgm.createIndex('invitations', 'protocol_id');
};

exports.down = (pgm) => {
  pgm.dropTable('invitations');
  pgm.dropTable('protocols');
};
