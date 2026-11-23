const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const action = path.resolve(__dirname, '../../../.github/actions/bound-ubuntu-apt');

test('APT CI mirror routing preserves suites, publisher keys and non-Ubuntu sources', () => {
  const input = `Types: deb
URIs: http://us-east-2.ec2.archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://eu-west-1.ec2.archive.ubuntu.com/ubuntu noble main
deb http://security.ubuntu.com/ubuntu noble-security main
deb https://packages.microsoft.com/repos/code stable main
deb http://notubuntu.example/ubuntu noble main
deb http://us-east-2.ec2.archive.ubuntu.com/ubuntu-other stable main
deb http://us-east-2.ec2.archive.ubuntu.com.evil.example/ubuntu stable main
`;
  const expected = input.replace('http://us-east-2.ec2.archive.ubuntu.com/ubuntu/', 'https://archive.ubuntu.com/ubuntu/')
    .replace('https://eu-west-1.ec2.archive.ubuntu.com/ubuntu noble', 'https://archive.ubuntu.com/ubuntu noble');
  const result = spawnSync('sed', ['-E', '-f', path.join(action, 'ubuntu-origin.sed')],
    { input, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
  const source = fs.readFileSync(path.join(action, 'action.yml'), 'utf8');
  assert.match(source, /Acquire::https::Timeout "5"/);
  assert.match(source, /Acquire::Retries "1"/);
  assert.doesNotMatch(source, /allow-unauthenticated|trusted=yes|Verify-Peer.*false|continue-on-error/);
});
