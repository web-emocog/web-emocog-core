const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of ['docker/web/nginx.conf', 'deploy/nginx-participant-media.conf']) {
  test(`${file}: Emotion Test alone can request same-origin camera without other sensors`, () => {
    const source = read(file);
    const location = source.match(/location = \/apps\/web\/developer\/emotion-test\.html \{([^}]+)\}/)?.[1];
    assert.ok(location, 'An exact HTML document exception is required');
    assert.match(location, /try_files \$uri =404;/);
    assert.match(location, /add_header Permissions-Policy "camera=\(self\), microphone=\(\), geolocation=\(\)" always;/);
    for (const header of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Content-Security-Policy']) {
      assert.match(location, new RegExp(`add_header ${header} [^\\n]+ always;`));
    }
    assert.match(source, /add_header Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)" always;/);
    const exceptions = [...source.matchAll(/add_header Permissions-Policy "camera=\(self\), microphone=\(\), geolocation=\(\)" always;/g)];
    assert.equal(exceptions.length, 1, 'No directory-wide camera exception');
  });
}

test('Emotion Test retains staff admission, fresh identity/role and policy checks before camera', () => {
  assert.match(read('apps/web/developer/emotion-test.html'), /allowedRoles: \['admin', 'developer'\]/);
  const access = read('apps/web/developer/diagnostic-access.mjs');
  assert.match(access, /\/auth\/me/);
  assert.match(access, /String\(actor.id\) !== String\(access.user.id\)/);
  assert.match(access, /policy\.allowsFeature\(feature\)/);
  const runner = read('apps/web/developer/protocol-diagnostic.mjs');
  assert.ok(runner.indexOf('await authorizeDiagnostic(run)') < runner.indexOf('navigator.mediaDevices.getUserMedia'));
});
