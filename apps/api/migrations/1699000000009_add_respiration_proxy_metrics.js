/**
 * session_proxy_metrics — respiration summary columns (ingest from respiration_summary).
 */
exports.up = (pgm) => {
  pgm.addColumns(
    'session_proxy_metrics',
    {
      respiration_rate_mean: { type: 'real' },
      respiration_rate_min: { type: 'real' },
      respiration_rate_max: { type: 'real' },
      respiration_sample_count: { type: 'integer', notNull: true, default: 0 },
      respiration_available: { type: 'boolean', notNull: true, default: false },
    },
    { ifNotExists: true }
  );

  pgm.createIndex('session_proxy_metrics', 'respiration_available', { ifNotExists: true });
};

exports.down = (pgm) => {
  pgm.dropIndex('session_proxy_metrics', 'respiration_available', { ifExists: true });
  pgm.dropColumns(
    'session_proxy_metrics',
    [
      'respiration_rate_mean',
      'respiration_rate_min',
      'respiration_rate_max',
      'respiration_sample_count',
      'respiration_available',
    ],
    { ifExists: true }
  );
};
