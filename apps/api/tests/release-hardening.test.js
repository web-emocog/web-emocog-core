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
    assert.match(workflow, /name: PostgreSQL concurrency and negative security tests\s+working-directory: apps\/api\s+env:\s+AUTH_RATE_LIMIT_PER_MINUTE: '1000'\s+run: npm run test:postgres/);
  });

  it('does not turn a cancelled superseded release run into a failed gate', () => {
    const workflow = fs.readFileSync(path.resolve(apiRoot, '../../.github/workflows/release-gates.yml'), 'utf8');
    assert.match(workflow, /release-gate:\s+name: Required release gate/);
    assert.match(workflow, /if: \$\{\{ always\(\) && !cancelled\(\) \}\}/);
    assert.match(workflow, /\[\[ "\$API_RESULT" == "success" \]\]/);
    assert.match(workflow, /\[\[ "\$POSTGRES_RESULT" == "success" \]\]/);
    assert.match(workflow, /\[\[ "\$BROWSER_RESULT" == "success" \]\]/);
  });

  it('uses identical pinned BuildKit sources and keeps the fallback fail-closed', () => {
    const repositoryRoot = path.resolve(apiRoot, '../..');
    const action = fs.readFileSync(path.join(repositoryRoot,
      '.github/actions/setup-container-builder/action.yml'), 'utf8');
    const config = fs.readFileSync(path.join(repositoryRoot,
      '.github/actions/setup-container-builder/buildkitd.toml'), 'utf8');
    const sources = [...action.matchAll(/driver-opts: image=([^\s]+)@sha256:([a-f0-9]{64})/g)];
    assert.equal(sources.length, 2);
    assert.equal(sources[0][1], 'mirror.gcr.io/moby/buildkit');
    assert.equal(sources[1][1], 'moby/buildkit');
    assert.equal(sources[0][2], sources[1][2]);
    assert.equal((action.match(/continue-on-error: true/g) || []).length, 1);
    assert.match(action, /if: steps\.mirror\.outcome == 'failure'/);
    assert.equal((action.match(/buildkitd-config: \$\{\{ github\.action_path \}\}\/buildkitd\.toml/g) || []).length, 2);
    assert.match(config, /\[registry\."docker\.io"\]\s+mirrors = \["mirror\.gcr\.io"\]/);
    for (const workflowName of ['ci.yml', 'deploy-production.yml']) {
      const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows', workflowName), 'utf8');
      assert.match(workflow, /uses: \.\/\.github\/actions\/setup-container-builder/);
    }
    const ci = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
    assert.match(ci, /pull_request:\s+branches: \[develop, main\]/);
    const deploy = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/deploy-production.yml'), 'utf8');
    assert.match(deploy, /push:\s+branches: \[main\]/);
  });

  it('runs PostgreSQL release gates against a pinned official image mirror', () => {
    const workflow = fs.readFileSync(path.resolve(apiRoot, '../../.github/workflows/release-gates.yml'), 'utf8');
    assert.match(workflow, /image: public\.ecr\.aws\/docker\/library\/postgres:16\.10-alpine@sha256:[a-f0-9]{64}/);
    assert.match(workflow, /run: npm run test:postgres/);
    assert.match(workflow, /run: npm run migrate:verify/);
    assert.match(workflow, /run: npm run backup:verify/);
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

  it('packages every server-side repository dependency in the production API image', () => {
    const repositoryRoot = path.resolve(apiRoot, '../..');
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'docker/api/Dockerfile'), 'utf8');
    const ignored = fs.readFileSync(path.join(repositoryRoot, '.dockerignore'), 'utf8');

    for (const dependency of [
      'apps/web/aoi-geometry.js',
      'apps/web/aoi-protocol.js',
      'apps/web/docs/analytics-contract/metric-catalog-v1.json',
      'deploy/production/backup-support.py',
      'packages/shared/contracts',
    ]) {
      assert.match(dockerfile, new RegExp(dependency.replaceAll('/', '\\/')));
    }
    assert.doesNotMatch(dockerfile, /COPY[^\n]*apps\/web\s+\/app\/apps\/web/);
    assert.match(ignored, /^!deploy\/production\/$/m);
    assert.match(ignored, /^!deploy\/production\/backup-support\.py$/m);
    assert.match(ignored, /^!packages\/shared\/contracts\/$/m);
    assert.match(ignored, /^!packages\/shared\/contracts\/\*\*$/m);
    assert.match(ignored, /^\*\*\/\.env$/m);
    assert.match(ignored, /^apps\/api\/uploads\/\*$/m);
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

  it('restores the active release when a rollback target fails its health check', () => {
    const repositoryRoot = path.resolve(apiRoot, '../..');
    const controller = fs.readFileSync(
      path.join(repositoryRoot, 'deploy/production/wecog-release'),
      'utf8',
    );
    const rollbackStart = controller.indexOf('rollback_release() {');
    const rollbackEnd = controller.indexOf('\nshow_status() {', rollbackStart);
    const rollback = controller.slice(rollbackStart, rollbackEnd);

    assert.ok(rollbackStart >= 0 && rollbackEnd > rollbackStart);
    assert.match(rollback, /if ! start_release "\$\{target\}"; then/);
    assert.match(rollback, /dump_release_diagnostics "\$\{target\}"/);
    assert.match(rollback, /if ! start_release "\$\{current\}"; then/);
    assert.ok(
      rollback.indexOf('if ! start_release "${current}"; then')
        < rollback.indexOf('printf \'%s\\n\' "${target}" >"${CURRENT_TAG_FILE}"'),
    );
  });
});
