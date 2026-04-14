/**
 * Расширение ролей пользователей:
 * - добавлены developer и respondent
 * - default роль меняется на respondent
 */
exports.up = (pgm) => {
  pgm.alterColumn('users', 'role', { default: 'respondent' });
  pgm.sql('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('admin','PI','researcher','analyst','assistant','developer','respondent'))"
  );
};

exports.down = (pgm) => {
  pgm.alterColumn('users', 'role', { default: 'assistant' });
  pgm.sql('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
  pgm.addConstraint(
    'users',
    'users_role_check',
    "CHECK (role IN ('admin','PI','researcher','analyst','assistant'))"
  );
};
