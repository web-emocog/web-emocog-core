const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('browser test server serves executable module types independently of Windows registry mappings', () => {
  const script = path.resolve(__dirname, '../../autotests/scripts/serve-static.py');
  const probe = `
import json, mimetypes, runpy, sys
from http.server import SimpleHTTPRequestHandler
for suffix in ['.mjs', '.js', '.wasm']:
    mimetypes.add_type('text/plain', suffix)
    SimpleHTTPRequestHandler.extensions_map[suffix] = 'application/octet-stream'
namespace = runpy.run_path(sys.argv[1])
handler = namespace['LocalStaticHandler'].__new__(namespace['LocalStaticHandler'])
print(json.dumps([handler.guess_type('test' + suffix) for suffix in ['.mjs', '.js', '.wasm', '.html']]))
`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', probe, script],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['text/javascript', 'text/javascript', 'application/wasm', 'text/html']);
});
