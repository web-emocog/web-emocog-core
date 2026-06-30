/**
 * session_proxy_metrics — proxy indices written by POST /ingest, read by sessions & experiments.
 */
exports.up = (pgm) => {
  pgm.createTable(
    'session_proxy_metrics',
    {
      id: 'id',
      session_id: {
        type: 'integer',
        notNull: true,
        unique: true,
        references: 'sessions',
        onDelete: 'CASCADE',
      },
      project_id: { type: 'integer', references: 'projects', onDelete: 'SET NULL' },
      protocol_id: { type: 'integer', references: 'protocols', onDelete: 'SET NULL' },
      qc_validity: {
        type: 'varchar(20)',
        check: "qc_validity IN ('valid','borderline','invalid')",
      },
      emotion_valence_mean: { type: 'real' },
      emotion_arousal_mean: { type: 'real' },
      attention_score: { type: 'real' },
      mean_rt_ms: { type: 'real' },
      omissions_pct: { type: 'real' },
      blink_count: { type: 'real' },
      bpm_mean: { type: 'real' },
      rppg_sample_count: { type: 'integer' },
      payload: { type: 'jsonb', notNull: true, default: '{}' },
      source_payload: { type: 'jsonb', notNull: true, default: '{}' },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('current_timestamp'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('current_timestamp'),
      },
    },
    { ifNotExists: true }
  );

  pgm.createIndex('session_proxy_metrics', 'session_id', { ifNotExists: true });
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS session_proxy_metrics_proxy_ready_idx
    ON session_proxy_metrics ((payload->>'proxy_ready'));
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS session_proxy_metrics_proxy_ready_idx;');
  pgm.dropTable('session_proxy_metrics', { ifExists: true });
};
