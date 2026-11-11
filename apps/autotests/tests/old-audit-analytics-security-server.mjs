import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.OLD_AUDIT_ANALYTICS_PORT || 4215);
const origin = `http://127.0.0.1:${port}`;
const hits = { redirects: 0, targets: 0 };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const pathname = new URL(req.url, origin).pathname;
  const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type,X-Staff-User-ID,X-CSRF-Token,X-Auth-Transport' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  if (pathname === '/__analytics_security/redirect') {
    hits.redirects++;
    // WebKit cannot fulfill a mocked 302: exercise the browser's real redirect policy.
    res.writeHead(302, { ...cors, Location: origin + '/__analytics_security/target' });
    res.end(); return;
  }
  if (pathname === '/__analytics_security/target') hits.targets++;
  if (pathname === '/__analytics_security/stats' || pathname === '/__analytics_security/target') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(hits)); return;
  }
  try {
    const filename = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/apps/web/researcher.html' : pathname));
    if (!filename.startsWith(path.resolve(root) + path.sep)) throw new Error('Outside test root');
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Content-Length': info.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(filename).pipe(res);
  } catch (_) { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1');
