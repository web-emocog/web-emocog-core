const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const apiRoot = path.resolve(__dirname, '..');

describe('S3-01 release hardening', () => {
  it('keeps one canonical API entrypoint', () => {
    const packageJson = require('../package.json');
    assert.equal(packageJson.main, 'server.js');
    assert.equal(packageJson.scripts.start, 'node server.js');
    assert.equal(packageJson.scripts['start:phase4'], undefined);
    for (const legacy of ['app_updated.js', 'app_phase4_updated.js']) {
      assert.match(fs.readFileSync(path.join(apiRoot, legacy), 'utf8'), /require\(['"]\.\/app['"]\)/);
    }
  });

  it('fails production startup without explicit secure configuration', () => {
    const result = spawnSync(process.execPath, ['-e', "require('./config')"], {
      cwd: apiRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: '',
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /JWT_SECRET/);
  });

  it('declares bounded HTTP, DB and shutdown settings', () => {
    const config = require('../config');
    assert.ok(config.http.headersTimeoutMs <= config.http.requestTimeoutMs);
    assert.ok(config.http.shutdownGraceMs <= 120_000);
    assert.ok(config.http.maxHeadersCount <= 1_000);
    assert.ok(config.database.bulkInsertBatchSize <= 1_000);
    assert.ok(config.database.statementTimeoutMs <= 600_000);
  });

  it('passes database URLs explicitly to backup and restore clients', () => {
    const backup = fs.readFileSync(path.join(apiRoot, 'scripts/backup-db.sh'), 'utf8');
    const restore = fs.readFileSync(path.join(apiRoot, 'scripts/restore-db.sh'), 'utf8');
    const drill = fs.readFileSync(path.join(apiRoot, 'scripts/verify-backup-restore.sh'), 'utf8');

    assert.match(backup, /pg_dump\s+\\\n\s+--dbname="\$DATABASE_URL"/);
    assert.match(restore, /pg_restore\s+\\\n\s+--dbname="\$RESTORE_DATABASE_URL"/);
    assert.match(restore, /psql --dbname="\$RESTORE_DATABASE_URL"/);
    assert.match(drill, /psql --dbname="\$DATABASE_URL"/);
    assert.match(drill, /psql --dbname="\$RESTORE_DATABASE_URL"/);
    assert.doesNotMatch(`${backup}\n${restore}\n${drill}`, /PGDATABASE=/);
  });

  it('runs CodeQL only where GitHub Code Security is available', () => {
    const workflow = fs.readFileSync(path.resolve(apiRoot, '../../.github/workflows/codeql.yml'), 'utf8');
    assert.match(workflow, /permissions:\s+actions: read\s+contents: read\s+security-events: write/);
    assert.match(workflow, /CODEQL_ENABLED:.*github\.event\.repository\.private == false.*vars\.CODEQL_ENABLED == 'true'/);
    assert.equal((workflow.match(/if: env\.CODEQL_ENABLED == 'true'/g) || []).length, 3);
    assert.match(workflow, /if: env\.CODEQL_ENABLED != 'true'\s+run:/);
    assert.match(workflow, /Enable GitHub Code Security.*CODEQL_ENABLED=true/);
  });

  it('tracks the canonical API process for graceful release shutdown', () => {
    const workflow = fs.readFileSync(path.resolve(apiRoot, '../../.github/workflows/release-gates.yml'), 'utf8');
    assert.match(workflow, /node server\.js > \/tmp\/wecog-api\.log 2>&1 &\s+echo \$! > \/tmp\/wecog-api\.pid/);
    assert.doesNotMatch(workflow, /npm start > \/tmp\/wecog-api\.log 2>&1 &/);
    assert.match(workflow, /kill -TERM "\$\(cat \/tmp\/wecog-api\.pid\)"/);
    assert.match(workflow, /grep -q 'api_shutdown_completed' \/tmp\/wecog-api\.log/);
  });
});
