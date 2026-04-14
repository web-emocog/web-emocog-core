/**
 * Миграция: библиотека стимулов (папки + элементы) для researcher UI.
 */
exports.up = (pgm) => {
  pgm.createTable('stimulus_folders', {
    id: 'id',
    project_id: { type: 'integer', notNull: true, references: 'projects', onDelete: 'CASCADE' },
    name: { type: 'varchar(255)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('stimulus_folders', 'project_id');
  pgm.createIndex('stimulus_folders', ['project_id', 'name']);

  pgm.createTable('stimuli', {
    id: 'id',
    project_id: { type: 'integer', notNull: true, references: 'projects', onDelete: 'CASCADE' },
    folder_id: { type: 'integer', references: 'stimulus_folders', onDelete: 'SET NULL' },
    name: { type: 'varchar(512)', notNull: true },
    mime_type: { type: 'varchar(255)' },
    size_bytes: { type: 'integer' },
    metadata: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('stimuli', 'project_id');
  pgm.createIndex('stimuli', 'folder_id');
  pgm.createIndex('stimuli', ['project_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('stimuli');
  pgm.dropTable('stimulus_folders');
};
