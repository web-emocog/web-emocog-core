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
});
