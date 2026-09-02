/**
 * Separate an organization administrator from the internal platform admin.
 * Platform bootstrap keeps the legacy `admin` role; user-facing laboratory
 * administrators use `org_admin` and remain tenant-scoped.
 */
exports.up = pgm => {
  pgm.sql('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('admin','org_admin','PI','researcher','analyst','assistant','developer','respondent'))"
  );
};

exports.down = pgm => {
  pgm.sql("UPDATE users SET role = 'PI' WHERE role = 'org_admin'");
  pgm.sql('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('admin','PI','researcher','analyst','assistant','developer','respondent'))"
  );
};
