const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const configs = ['docker/web/nginx.conf', 'deploy/production/nginx-wecog-container.conf'];

for (const file of configs) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const map = source.match(/map \$uri \$wecog\w*log_path \{[\s\S]*?\}/)?.[0];
  const format = source.match(/log_format (wecog\w*safe) escape=json [^\n]+;/);
  test(`${file}: access logs omit bearer paths, queries and referrers`, () => {
    assert.ok(map); assert.ok(format);
    assert.match(map, /~\*\^\/\(\?:api\/\)\?invitations\/by-code\//);
    assert.match(map, /~\*\^\/invite\//);
    assert.doesNotMatch(format[0], /\$(?:request\b|request_uri|args|http_referer|http_authorization|http_cookie)/);
    assert.match(source, new RegExp(`access_log [^;]+ ${format[1]};`));
  });

  test(`${file}: real nginx redacts invitation paths and query credentials`, { skip: !process.env.WECOG_NGINX_BIN }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-nginx-log-'));
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const config = path.join(dir, 'nginx.conf'), access = path.join(dir, 'access.log');
    fs.writeFileSync(config, `pid ${dir}/nginx.pid; error_log ${dir}/error.log; events {} http {
      ${map}\n${format[0]}\naccess_log ${access} ${format[1]};
      server { listen 127.0.0.1:${port}; location / { return 204; } } }`);
    let child;
    try {
      const syntax = spawnSync(process.env.WECOG_NGINX_BIN, ['-t', '-p', `${dir}/`, '-c', config], { encoding: 'utf8' });
      assert.equal(syntax.status, 0, syntax.stderr);
      child = spawn(process.env.WECOG_NGINX_BIN, ['-p', `${dir}/`, '-c', config, '-g', 'daemon off;'], { stdio: 'ignore' });
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try { const r = await fetch(`http://127.0.0.1:${port}/ready`); await r.arrayBuffer(); ready = true; break; }
        catch { await new Promise(resolve => setTimeout(resolve, 20)); }
      }
      assert.ok(ready);
      const secret = 'SYNTHETIC_SECRET_NEVER_LOG';
      for (const url of [`/apps/participant-web/run_new.html?code=${secret}`,
        `/api/invitations/by-code/${secret}/stimuli/12/content`, `/invitations/by-code/${secret}`,
        `/api/Invitations/by-code/${secret}/stimuli`, `/invite/${secret}`]) {
        const response = await fetch(`http://127.0.0.1:${port}${url}`, { headers: { Referer: `https://example.test/?code=${secret}` } });
        assert.equal(response.status, 204); await response.arrayBuffer();
      }
      const log = fs.readFileSync(access, 'utf8');
      assert.equal(log.includes(secret), false); assert.equal(log.includes('code='), false);
      assert.match(log, /REDACTED/);
      for (const line of log.trim().split('\n')) assert.equal(JSON.parse(line).status, 204);
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
