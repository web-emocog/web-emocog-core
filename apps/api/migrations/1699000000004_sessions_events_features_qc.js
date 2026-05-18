/**
 * Миграция: сессии, события, SessionFeatures, SessionQcSummary (Фаза 2.4, 2.5, 2.6).
 */
exports.up = (pgm) => {
  pgm.createTable('sessions', {
    id: 'id',
    session_id: { type: 'varchar(64)', notNull: true, unique: true },
    project_id: { type: 'integer', references: 'projects', onDelete: 'SET NULL' },
    protocol_id: { type: 'integer', references: 'protocols', onDelete: 'SET NULL' },
    participant_id: { type: 'varchar(64)' },
    started_at: { type: 'timestamptz' },
    stopped_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('sessions', 'session_id');
  pgm.createIndex('sessions', 'project_id');
  pgm.createIndex('sessions', 'protocol_id');
  pgm.createIndex('sessions', 'started_at');

  pgm.createTable('events', {
    id: 'id',
    session_id: { type: 'integer', notNull: true, references: 'sessions', onDelete: 'CASCADE' },
    payload: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('events', 'session_id');

  pgm.createTable('session_features', {
    id: 'id',
    session_id: { type: 'integer', notNull: true, references: 'sessions', onDelete: 'CASCADE', unique: true },
    payload: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('session_features', 'session_id');

  pgm.createTable('session_qc_summary', {
    id: 'id',
    session_id: { type: 'integer', notNull: true, references: 'sessions', onDelete: 'CASCADE', unique: true },
    qc_score: { type: 'real' },
    validity: { type: 'varchar(20)', check: "validity IN ('valid','borderline','invalid')" },
    fail_reasons: { type: 'jsonb' },
    payload: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('session_qc_summary', 'session_id');
  pgm.createIndex('session_qc_summary', 'validity');
};

exports.down = (pgm) => {
  pgm.dropTable('session_qc_summary');
  pgm.dropTable('session_features');
  pgm.dropTable('events');
  pgm.dropTable('sessions');
};
