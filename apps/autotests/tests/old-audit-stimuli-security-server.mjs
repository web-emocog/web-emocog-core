import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A real HTTP redirect is necessary: Playwright WebKit cannot fulfill a mocked 302.
const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const origin = 'http://127.0.0.1:4213';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, origin).pathname;
  if (pathname === '/__old_audit_stimuli_redirect') {
    res.writeHead(302, { Location: 'http://127.0.0.1:3001/redirect-target',
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
    res.end(); return;
  }
  try {
    const filename = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/apps/web/researcher.html' : pathname));
    if (!filename.startsWith(root + path.sep)) throw new Error('Outside test root');
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Content-Length': info.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(filename).pipe(res);
  } catch (_) { res.writeHead(404); res.end(); }
}).listen(4213, '127.0.0.1');
