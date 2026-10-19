const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../../../scripts/start-ci-postgres.sh');

function fixture(mode, patch = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-ci-postgres-'));
  try {
    const log = path.join(directory, 'docker.log');
    const output = path.join(directory, 'output');
    fs.writeFileSync(path.join(directory, 'docker'), `#!${process.execPath}
const fs = require('fs'), args = process.argv.slice(2), mode = process.env.FAKE_DOCKER_MODE;
fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'container') process.exit(mode === 'exists' ? 0 : 1);
if (args[0] === 'pull') process.exit(mode === 'all-fail' || (mode === 'fallback' && args[1].startsWith('mirror.')) ? 1 : 0);
if (args[0] === 'exec') process.exit(mode === 'unhealthy' ? 1 : 0);
process.exit(0);
`);
    fs.writeFileSync(path.join(directory, 'timeout'), '#!/usr/bin/env bash\nshift\nexec "$@"\n');
    fs.writeFileSync(path.join(directory, 'sleep'), '#!/bin/sh\nexit 0\n');
    for (const file of ['docker', 'timeout', 'sleep']) fs.chmodSync(path.join(directory, file), 0o700);
    const result = spawnSync('bash', [script], { encoding: 'utf8', timeout: 5000, env: {
      ...process.env, PATH: directory + ':' + process.env.PATH, CI: 'true', CI_POSTGRES_ALLOW_LOCAL: '',
      CI_POSTGRES_CONTAINER: 'wecog-unit-fixture', CI_POSTGRES_PORT: '55439', GITHUB_OUTPUT: output,
      FAKE_DOCKER_MODE: mode, FAKE_DOCKER_LOG: log, ...patch
    } });
    return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
      output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('CI PostgreSQL uses the pinned cache image and waits for readiness', () => {
  const result = fixture('mirror');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter(args => args[0] === 'pull').length, 1);
  const run = result.calls.find(args => args[0] === 'run');
  assert.match(run.at(-1), /^mirror\.gcr\.io\/library\/postgres:16\.10-alpine@sha256:[a-f0-9]{64}$/);
  assert.ok(run.includes('127.0.0.1:55439:5432'));
  assert.ok(result.calls.some(args => args[0] === 'exec' && args.includes('pg_isready')));
  assert.equal(result.output, 'container=wecog-unit-fixture\n');
});

test('registry failure falls back to exactly the same upstream digest', () => {
  const result = fixture('fallback');
  assert.equal(result.status, 0, result.stderr);
  const pulls = result.calls.filter(args => args[0] === 'pull').map(args => args[1]);
  assert.equal(pulls.length, 2);
  assert.equal(pulls[0].split('@')[1], pulls[1].split('@')[1]);
  assert.match(pulls[1], /^docker\.io\/library\/postgres:/);
  assert.equal(result.calls.find(args => args[0] === 'run').at(-1), pulls[1]);
});

test('failure of both registries cannot start or pass the release fixture', () => {
  const result = fixture('all-fail');
  assert.equal(result.status, 1);
  assert.equal(result.calls.filter(args => args[0] === 'pull').length, 2);
  assert.equal(result.calls.some(args => args[0] === 'run'), false);
  assert.equal(result.output, '');
});

test('an unhealthy owned container is removed and readiness fails closed', () => {
  const result = fixture('unhealthy');
  assert.equal(result.status, 1);
  assert.equal(result.calls.filter(args => args[0] === 'exec').length, 30);
  assert.ok(result.calls.some(args => args[0] === 'rm' && args.at(-1) === 'wecog-unit-fixture'));
  assert.equal(result.output, '');
});

test('an existing container is never replaced or removed', () => {
  const result = fixture('exists');
  assert.equal(result.status, 2);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0][0], 'container');
});

test('startup outside CI requires explicit local authorization', () => {
  const result = fixture('mirror', { CI: 'false' });
  assert.equal(result.status, 2);
  assert.equal(result.calls.length, 0);
});

test('invalid container names or ports cannot reach Docker', () => {
  for (const patch of [{ CI_POSTGRES_CONTAINER: 'foreign-container' }, { CI_POSTGRES_PORT: '5432;false' }, { CI_POSTGRES_PORT: '99999' }]) {
    const result = fixture('mirror', patch);
    assert.equal(result.status, 2);
    assert.equal(result.calls.length, 0);
  }
});
