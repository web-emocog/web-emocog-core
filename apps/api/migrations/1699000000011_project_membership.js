/**
 * Explicit project membership. Existing organization members are backfilled
 * into existing projects so the migration does not revoke current access.
 */
exports.up = pgm => {
  pgm.createTable('user_projects', {
    id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    project_id: {
      type: 'integer',
      notNull: true,
      references: 'projects',
      onDelete: 'CASCADE',
    },
    role: { type: 'varchar(50)', notNull: true, default: 'member' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('user_projects', ['user_id', 'project_id'], { unique: true });
  pgm.createIndex('user_projects', 'project_id');
  pgm.sql(`
    INSERT INTO user_projects (user_id, project_id, role)
    SELECT uo.user_id, p.id, COALESCE(NULLIF(uo.role, ''), 'member')
    FROM user_organizations uo
    INNER JOIN projects p ON p.organization_id = uo.organization_id
    ON CONFLICT (user_id, project_id) DO NOTHING;
  `);
};

exports.down = pgm => {
  pgm.dropTable('user_projects');
};
