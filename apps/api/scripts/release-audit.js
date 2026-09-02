const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

function fail(message) {
  console.error(`release-audit: ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const packageJson = JSON.parse(read('apps/api/package.json'));
if (packageJson.scripts.start !== 'node server.js') fail('npm start must use server.js');
if ('start:phase4' in packageJson.scripts) fail('legacy phase server script must not be exposed');
if (!read('apps/api/app_updated.js').includes("require('./app')")) fail('app_updated.js must alias app.js');
if (!read('apps/api/app_phase4_updated.js').includes("require('./app')")) fail('app_phase4_updated.js must alias app.js');
if (/app\.use\(['"]\/events/.test(read('apps/api/app.js'))) fail('legacy /events transport is mounted');

const trackedFiles = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
for (const file of trackedFiles) {
  const base = path.basename(file);
  if (base === '.env' || /^\.env\.(?!example$)/.test(base)) fail(`tracked environment file: ${file}`);
}

const workflowDir = path.join(repoRoot, '.github', 'workflows');
if (!fs.existsSync(workflowDir)) fail('GitHub Actions workflows are missing');
else {
  for (const name of fs.readdirSync(workflowDir).filter(file => /\.ya?ml$/.test(file))) {
    const source = fs.readFileSync(path.join(workflowDir, name), 'utf8');
    for (const line of source.split('\n')) {
      const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/);
      if (!match || match[1].startsWith('./')) continue;
      if (!/@[0-9a-f]{40}$/.test(match[1])) {
        fail(`${name} contains an action not pinned to a full SHA: ${match[1]}`);
      }
    }
  }
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
];
for (const file of trackedFiles) {
  if (/\.(?:png|jpe?g|gif|webp|wasm|task|tflite|zip|docx|xlsx|pptx|pdf)$/i.test(file)) continue;
  let source;
  try { source = read(file); } catch (_) { continue; }
  if (secretPatterns.some(pattern => pattern.test(source))) fail(`possible committed secret in ${file}`);
}

if (!process.exitCode) console.log('release-audit: passed');
