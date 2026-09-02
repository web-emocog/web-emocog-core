/**
 * Developer access allowlist managed from admin panel.
 */
exports.up = (pgm) => {
  pgm.createTable('developer_access_emails', {
    id: 'id',
    email: { type: 'varchar(320)', notNull: true, unique: true },
    granted_by_user_id: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('developer_access_emails', 'email');
};

exports.down = (pgm) => {
  pgm.dropTable('developer_access_emails');
};
