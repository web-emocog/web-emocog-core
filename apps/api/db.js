const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.poolMax,
  idleTimeoutMillis: config.database.idleTimeoutMs,
  connectionTimeoutMillis: config.database.connectionTimeoutMs,
  statement_timeout: config.database.statementTimeoutMs,
  application_name: 'wecog-api',
});

pool.on('error', (error) => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'postgres_idle_client_error',
    code: error?.code || 'unknown',
  }));
});

module.exports = { pool };
