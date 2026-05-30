/**
 * Proxy metrics v1 read contract columns (no calculation logic).
 * Existing scalar columns + payload remain for ingest backward compatibility.
 */
exports.up = (pgm) => {
  pgm.addColumns(
    'session_proxy_metrics',
    {
      participant_id: { type: 'varchar(64)' },
      schema_version: { type: 'text', notNull: true, default: 'proxy_metrics.v1' },
      status: {
        type: 'text',
        notNull: true,
        default: 'not_computed',
        check: "status IN ('not_computed','partial','computed','failed')",
      },
      metrics: { type: 'jsonb', notNull: true, default: '{}' },
      missing_metrics: { type: 'jsonb', notNull: true, default: '[]' },
      error: { type: 'text' },
      computed_at: { type: 'timestamptz' },
    },
    { ifNotExists: true }
  );

  pgm.createIndex('session_proxy_metrics', 'project_id', { ifNotExists: true });
  pgm.createIndex('session_proxy_metrics', 'protocol_id', { ifNotExists: true });
  pgm.createIndex('session_proxy_metrics', 'status', { ifNotExists: true });
  pgm.createIndex('session_proxy_metrics', 'computed_at', { ifNotExists: true });
  pgm.createIndex('session_proxy_metrics', ['project_id', 'protocol_id', 'status'], {
    ifNotExists: true,
    name: 'session_proxy_metrics_project_protocol_status_idx',
  });
  pgm.createIndex('session_proxy_metrics', ['session_id', 'schema_version'], {
    ifNotExists: true,
    name: 'session_proxy_metrics_session_schema_idx',
  });
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS session_proxy_metrics_metrics_gin_idx
    ON session_proxy_metrics USING GIN (metrics);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS session_proxy_metrics_metrics_gin_idx;');
  pgm.dropIndex('session_proxy_metrics', ['session_id', 'schema_version'], {
    ifExists: true,
    name: 'session_proxy_metrics_session_schema_idx',
  });
  pgm.dropIndex('session_proxy_metrics', ['project_id', 'protocol_id', 'status'], {
    ifExists: true,
    name: 'session_proxy_metrics_project_protocol_status_idx',
  });
  pgm.dropIndex('session_proxy_metrics', 'computed_at', { ifExists: true });
  pgm.dropIndex('session_proxy_metrics', 'status', { ifExists: true });
  pgm.dropIndex('session_proxy_metrics', 'protocol_id', { ifExists: true });
  pgm.dropIndex('session_proxy_metrics', 'project_id', { ifExists: true });
  pgm.dropColumns(
    'session_proxy_metrics',
    ['participant_id', 'schema_version', 'status', 'metrics', 'missing_metrics', 'error', 'computed_at'],
    { ifExists: true }
  );
};
