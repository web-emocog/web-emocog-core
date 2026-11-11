exports.up = pgm => {
  pgm.sql(`CREATE TABLE http_rate_windows (
    key_hash char(64) PRIMARY KEY,
    hits bigint NOT NULL CHECK (hits >= 0),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX http_rate_windows_expiration ON http_rate_windows(expires_at);`);
};

exports.down = pgm => {
  pgm.sql('DROP TABLE http_rate_windows');
};
