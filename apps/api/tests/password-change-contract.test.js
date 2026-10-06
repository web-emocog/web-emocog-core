const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');

describe('self-service password security contract', () => {
  it('checks the current password and atomically guards both hash and token version', () => {
    const auth = fs.readFileSync(path.resolve(__dirname, '../routes/auth.js'), 'utf8');
    const route = auth.slice(auth.indexOf("router.patch(\n  '/me/password'"), auth.indexOf("router.get(\n  '/developer-access-emails'"));
    assert.match(route, /requireAuth/);
    assert.match(route, /bcrypt\.compare\(currentPassword, user\.password_hash\)/);
    assert.match(route, /WHERE id = \$2 AND password_hash = \$3 AND token_version = \$4/);
    assert.match(route, /token_version = token_version \+ 1/);
    assert.match(route, /RETURNING id, email, role, display_name, token_version/);
    assert.match(route, /\[passwordHash, user\.id, user\.password_hash, req\.user\.ver\]/);
    assert.match(route, /status\(409\)/);
    assert.match(route, /buildAuthResponse\(req, res, refreshed\.rows\[0\]\)/);
    assert.doesNotMatch(route, /errors\.array\(\)|console\.error\(err\)/);
  });

  it('does not trim passwords in creation, login or self-service settings', () => {
    for (const file of ['web/developer/login.html', 'web/developer/accounts.html']) {
      const source = read(file);
      assert.doesNotMatch(source, /password[^\n]*\.trim\(/);
      assert.match(source, /getElementById\('password'\)\.value/);
    }
    const settings = read('web/researcher-admin-settings.js');
    assert.match(settings, /const currentPassword = currentInput\.value;/);
    assert.match(settings, /const newPassword = newInput\.value;/);
    assert.match(settings, /apiPatch\('\/auth\/me\/password', \{ currentPassword, newPassword \}\)/);
    assert.doesNotMatch(settings, /(?:currentPassword|newPassword)[^\n]*\.trim\(/);
  });

  it('requires API acceptance before success and rotates CSRF without storing passwords', () => {
    const settings = read('web/researcher-admin-settings.js');
    assert.match(settings, /updated\?\.ok !== true/);
    assert.match(settings, /updated\.auth_transport !== 'cookie'/);
    assert.match(settings, /sessionStorage\.setItem\('emocog_csrf_token', updated\.csrf_token\)/);
    assert.match(settings, /new TextEncoder\(\)\.encode\(newPassword\)\.length > 72/);
    assert.match(settings, /newPassword !== confirmInput\.value/);
    assert.match(settings, /if\(researcherPasswordChangeState\.saving\) return;/);
    assert.match(settings, /syncResearcherPasswordForm\(root\)/);
    assert.doesNotMatch(settings, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:currentPassword|newPassword)/);
    assert.match(read('web/developer/login.html'), /resolve\(\{ useStorage: false \}\)/);
  });
});
