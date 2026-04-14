/**
 * Миграция: организации, проекты, привязка пользователей (Фаза 2.3).
 */
exports.up = (pgm) => {
  pgm.createTable('organizations', {
    id: 'id',
    name: { type: 'varchar(255)', notNull: true },
    slug: { type: 'varchar(100)', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('organizations', 'slug');

  pgm.createTable('projects', {
    id: 'id',
    organization_id: { type: 'integer', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    name: { type: 'varchar(255)', notNull: true },
    slug: { type: 'varchar(100)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('projects', 'organization_id');
  pgm.createIndex('projects', ['organization_id', 'slug'], { unique: true });

  pgm.createTable('user_organizations', {
    id: 'id',
    user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    organization_id: { type: 'integer', notNull: true, references: 'organizations', onDelete: 'CASCADE' },
    role: { type: 'varchar(50)', default: 'member' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('user_organizations', ['user_id', 'organization_id'], { unique: true });
};

exports.down = (pgm) => {
  pgm.dropTable('user_organizations');
  pgm.dropTable('projects');
  pgm.dropTable('organizations');
};
