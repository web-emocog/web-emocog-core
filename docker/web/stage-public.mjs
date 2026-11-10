import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const retiredParticipantRuntime = [
  'apps/participant-web/mvp_with_precheck_1.html',
  'apps/participant-web/js/face-mask-collector.js',
  ...['app', 'experimental_task', 'precheck', 'tests', 'ui'].map(
    name => `apps/participant-web/js/web-page/${name}.js`
  ),
];

export async function readPublicManifest(root) {
  return JSON.parse(await fs.readFile(path.join(root, 'docker/web/public-files.json'), 'utf8'));
}

function safeName(name) {
  return typeof name === 'string' && !name.startsWith('/') && !name.includes('\\')
    && name.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'));
}

export function moduleReferences(source) {
  // Literal ESM imports, classic imports and Worker/worklet URL dependencies.
  const patterns = [/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"\n]+)['"]/g,
    /\bnew\s+URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url/g,
    /\bimportScripts\(\s*['"]([^'"\n]+)['"]/g];
  return patterns.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1]));
}

export async function verifyPublicTree(root, manifest) {
  const allowed = new Set(manifest.files);
  if (manifest.schemaVersion !== 'wecog_public_files.v1' || allowed.size !== manifest.files.length)
    throw new Error('Invalid or duplicate public manifest');
  if (retiredParticipantRuntime.some(name => allowed.has(name) || manifest.excludedOptionalReferences.includes(name)))
    throw new Error('Retired participant runtime cannot be published or referenced');
  const resolvedRoot = await fs.realpath(root);
  for (const name of manifest.files) {
    if (!safeName(name)) throw new Error(`Unsafe public path: ${name}`);
    const resolved = await fs.realpath(path.join(root, name));
    if (!resolved.startsWith(resolvedRoot + path.sep) || !(await fs.stat(resolved)).isFile())
      throw new Error(`Invalid public file: ${name}`);
    if (/\.(?:js|mjs|html|css)$/.test(name) && !name.includes('/vendor/')) {
      const text = await fs.readFile(resolved, 'utf8');
      const refs = moduleReferences(text);
      if (name.endsWith('.html')) {
        refs.push(...[...text.matchAll(/<(?:script|img|link)\b[^>]*(?:src|href)\s*=\s*['"]([^'"\n]+)['"]/gi)].map(match => match[1]));
      }
      if (name.endsWith('.css')) refs.push(...[...text.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/gi)].map(match => match[1]));
      for (const ref of refs) {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) || ref.includes('${')) continue;
        const clean = ref.split(/[?#]/)[0];
        // Directory roots are expanded by MediaPipe; their exact files are in the manifest.
        if (!/\.[a-z0-9]+$/i.test(clean)) continue;
        const target = path.posix.normalize(clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(name), clean));
        if (!allowed.has(target) && !manifest.excludedOptionalReferences.includes(target))
          throw new Error(`Missing public dependency: ${name} -> ${target}`);
      }
    }
  }
  for (const name of [...manifest.entrypoints.public, ...manifest.entrypoints.staff, ...manifest.entrypoints.authenticatedWorkspace]) {
    if (!allowed.has(name) || !name.endsWith('.html')) throw new Error(`Missing entrypoint: ${name}`);
  }
  for (const name of manifest.entrypoints.staff) {
    const text = await fs.readFile(path.join(root, name), 'utf8');
    if (!text.includes('auth-guard.js')) throw new Error(`Staff entrypoint has no authorization guard: ${name}`);
  }
  for (const name of manifest.entrypoints.authenticatedWorkspace) {
    const text = await fs.readFile(path.join(root, name), 'utf8');
    const client = await fs.readFile(path.join(root, 'apps/web/account/account.js'), 'utf8');
    if (!text.includes('account.js') || !client.includes("request('/auth/me')") || !client.includes("request('/workspace')"))
      throw new Error(`Workspace entrypoint has no authenticated API flow: ${name}`);
  }
  // Reject stale output and accidental unreviewed files, not only absent dependencies.
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Public output must not contain symlinks');
      if (entry.isDirectory()) await walk(absolute);
      else if (!allowed.has(path.relative(root, absolute).split(path.sep).join('/'))) throw new Error(`Unlisted public output: ${entry.name}`);
    }
  }
  await walk(root);
  return { files: allowed.size, publicEntrypoints: manifest.entrypoints.public.length, staffEntrypoints: manifest.entrypoints.staff.length,
    authenticatedWorkspaceEntrypoints: manifest.entrypoints.authenticatedWorkspace.length };
}

export async function stagePublicTree(source, destination) {
  const manifest = await readPublicManifest(source);
  // Destination must be a new directory. Never clean an arbitrary caller path.
  await fs.mkdir(destination, { recursive: false });
  for (const name of manifest.files) {
    if (!safeName(name)) throw new Error(`Unsafe public path: ${name}`);
    const real = await fs.realpath(path.join(source, name));
    if (!real.startsWith((await fs.realpath(source)) + path.sep)) throw new Error('Source escapes repository');
    await fs.mkdir(path.dirname(path.join(destination, name)), { recursive: true });
    await fs.copyFile(real, path.join(destination, name));
  }
  return verifyPublicTree(destination, manifest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error('Usage: node docker/web/stage-public.mjs SOURCE NEW_OUTPUT_DIRECTORY');
  console.log(JSON.stringify(await stagePublicTree(path.resolve(source), path.resolve(destination))));
}
