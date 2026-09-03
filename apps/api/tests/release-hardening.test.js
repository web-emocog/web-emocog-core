const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

  it('discovers exported OS Login credentials from files instead of CLI text', () => {
    const repositoryRoot = path.resolve(apiRoot, '../..');
    const helper = path.join(repositoryRoot, 'deploy/production/export-oslogin-identity.sh');
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-oslogin-'));
    const binaryDirectory = path.join(temporaryRoot, 'bin');
    const credentialDirectory = path.join(temporaryRoot, 'credentials');
    const fakeYc = path.join(binaryDirectory, 'yc');

    try {
      fs.mkdirSync(binaryDirectory);
      fs.writeFileSync(fakeYc, `#!/usr/bin/env bash
set -Eeuo pipefail
directory=''
while (( $# > 0 )); do
  if [[ $1 == --directory ]]; then
    directory=$2
    shift 2
  else
    shift
  fi
done
test -n "\${directory}"
: > "\${directory}/generated-identity"
: > "\${directory}/generated-identity-cert.pub"
`);
      fs.chmodSync(fakeYc, 0o755);

      const result = spawnSync('bash', [
        helper,
        credentialDirectory,
        'wecog-deploy',
        'test-organization',
      ], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: `${binaryDirectory}:${process.env.PATH}`,
        },
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr);
      const identity = result.stdout.trim();
      assert.equal(identity, path.join(credentialDirectory, 'generated-identity'));
      assert.equal(fs.statSync(identity).mode & 0o777, 0o600);
      assert.equal(fs.statSync(`${identity}-cert.pub`).mode & 0o777, 0o600);

      for (const workflowName of ['deploy-production.yml', 'rollback-production.yml']) {
        const workflow = fs.readFileSync(
          path.join(repositoryRoot, '.github/workflows', workflowName),
          'utf8',
        );
        assert.match(workflow, /deploy\/production\/export-oslogin-identity\.sh/);
        assert.doesNotMatch(workflow, /certificate_output|s\/\^Identity:/);
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('packages every server-side web dependency in the production API image', () => {
    const repositoryRoot = path.resolve(apiRoot, '../..');
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'docker/api/Dockerfile'), 'utf8');

    for (const dependency of [
      'apps/web/aoi-geometry.js',
      'apps/web/aoi-protocol.js',
      'apps/web/docs/analytics-contract/metric-catalog-v1.json',
    ]) {
      assert.match(dockerfile, new RegExp(dependency.replaceAll('/', '\\/')));
    }
    assert.doesNotMatch(dockerfile, /COPY[^\n]*apps\/web\s+\/app\/apps\/web/);
  });

  it('starts the built API image before deployment side effects', () => {
    const repositoryRoot = path.resolve(apiRoot, '../..');
    const smokeCommand = /deploy\/production\/smoke-test-api-image\.sh/;
    const smokeScript = fs.readFileSync(
      path.join(repositoryRoot, 'deploy/production/smoke-test-api-image.sh'),
      'utf8',
    );

    assert.match(smokeScript, /--read-only/);
    assert.match(
      smokeScript,
      /--tmpfs \/var\/lib\/wecog\/uploads:[^\n]*uid=10001,gid=10001/,
    );
    assert.match(smokeScript, /--env UPLOADS_ROOT=\/var\/lib\/wecog\/uploads/);

    for (const workflowName of ['ci.yml', 'deploy-production.yml']) {
      const workflow = fs.readFileSync(
        path.join(repositoryRoot, '.github/workflows', workflowName),
        'utf8',
      );
      assert.match(workflow, smokeCommand);
    }

    const deployWorkflow = fs.readFileSync(
      path.join(repositoryRoot, '.github/workflows/deploy-production.yml'),
      'utf8',
    );
    assert.ok(
      deployWorkflow.indexOf('smoke-test-api-image.sh')
        < deployWorkflow.indexOf('Prepare release and upload the database backup'),
    );
  });

  it('preserves bounded container diagnostics before failed-release cleanup', () => {
    const repositoryRoot = path.resolve(apiRoot, '../..');
    const controller = fs.readFileSync(
      path.join(repositoryRoot, 'deploy/production/wecog-release'),
      'utf8',
    );
    assert.match(controller, /logs \\\n\s+--no-color \\\n\s+--timestamps \\\n\s+--tail 200/);
    assert.ok(
      controller.indexOf('dump_release_diagnostics "${tag}"')
        < controller.indexOf('compose_for "${tag}" down'),
    );
  });
});
