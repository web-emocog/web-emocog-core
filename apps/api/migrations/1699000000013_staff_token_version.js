/**
 * Revokes stale staff JWTs after password or role changes.
 */
exports.up = pgm => {
  pgm.addColumns('users', {
    token_version: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint(
    'users',
    'users_token_version_nonnegative',
    'CHECK (token_version >= 0)'
  );
};

exports.down = pgm => {
  pgm.dropConstraint('users', 'users_token_version_nonnegative', {
    ifExists: true,
  });
  pgm.dropColumns('users', ['token_version'], { ifExists: true });
};
