/**
 * Миграция: пользователи и роли (Фаза 2.2).
 * Роли: admin, PI, researcher, analyst, assistant.
 */
exports.up = (pgm) => {
  pgm.createTable('users', {
    id: 'id',
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    role: {
      type: 'varchar(50)',
      notNull: true,
      default: 'assistant',
      check: "role IN ('admin','PI','researcher','analyst','assistant')",
    },
    display_name: { type: 'varchar(255)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('users', 'email');
  pgm.createIndex('users', 'role');
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
