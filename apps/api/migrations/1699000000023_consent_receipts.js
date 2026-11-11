exports.up = pgm => {
  pgm.sql(`CREATE TABLE session_consent_receipts (
    session_db_id integer PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    informed_consent_version text NOT NULL CHECK (informed_consent_version = 'informed-consent-v1.0'),
    privacy_policy_version text NOT NULL CHECK (privacy_policy_version = 'privacy-policy-v1.0'),
    received_at timestamptz NOT NULL DEFAULT current_timestamp
  )`);
};

exports.down = pgm => pgm.dropTable('session_consent_receipts');
