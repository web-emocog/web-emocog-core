const path = require('path');
const fs = require('fs');

const SERVER_PATH_KEYS = new Set(['content_path', 'contentPath']);

function resolveServerOwnedUploadPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    return { ok: false, code: 'missing_content_path' };
  }
  if (relativePath.includes('\0')) {
    return { ok: false, code: 'invalid_content_path' };
  }

  const portablePath = relativePath.replace(/\\/g, '/');
  if (path.posix.isAbsolute(portablePath) || path.win32.isAbsolute(relativePath)) {
    return { ok: false, code: 'absolute_content_path_forbidden' };
  }
  const segments = portablePath.split('/');
  if (segments.some(segment => segment === '..')) {
    return { ok: false, code: 'content_path_traversal' };
  }

  const resolvedRoot = path.resolve(root);
  const absolutePath = path.resolve(resolvedRoot, portablePath);
  if (
    absolutePath === resolvedRoot
    || !absolutePath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return { ok: false, code: 'content_path_outside_uploads_root' };
  }
  return {
    ok: true,
    root: resolvedRoot,
    relativePath: path.relative(resolvedRoot, absolutePath),
    absolutePath,
  };
}

async function resolveReadableServerOwnedUploadPath(root, relativePath) {
  const resolved = resolveServerOwnedUploadPath(root, relativePath);
  if (!resolved.ok) return resolved;
  try {
    const [realRoot, realFile] = await Promise.all([
      fs.promises.realpath(resolved.root),
      fs.promises.realpath(resolved.absolutePath),
    ]);
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
      return { ok: false, code: 'content_path_symlink_escape' };
    }
    const stat = await fs.promises.stat(realFile);
    if (!stat.isFile()) {
      return { ok: false, code: 'content_path_not_file' };
    }
    return {
      ...resolved,
      root: realRoot,
      absolutePath: realFile,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, code: 'content_file_missing' };
    }
    return { ok: false, code: 'content_path_unreadable' };
  }
}

function rejectClientOwnedContentPath(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { ok: true };
  }
  const key = Object.keys(metadata).find(candidate => SERVER_PATH_KEYS.has(candidate));
  if (key) {
    return {
      ok: false,
      code: 'server_owned_content_path',
      error: `${key} is server-owned and cannot be supplied by the client`,
    };
  }
  return { ok: true };
}

function getStoredContentPath(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  // contentPath was used by the first upload implementation. Keep it readable
  // so an existing stimulus does not lose its binary after a server upgrade.
  return metadata.content_path || metadata.contentPath || null;
}

function safeDownloadName(value) {
  return String(value || 'download')
    .replace(/[\r\n"]/g, '_')
    .slice(0, 200);
}

function contentDisposition(disposition, value) {
  const type = disposition === 'attachment' ? 'attachment' : 'inline';
  const unicodeName = safeDownloadName(value);
  const asciiName = unicodeName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/\\/g, '_') || 'download';
  const encodedName = encodeURIComponent(unicodeName)
    .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

module.exports = {
  resolveServerOwnedUploadPath,
  resolveReadableServerOwnedUploadPath,
  rejectClientOwnedContentPath,
  getStoredContentPath,
  safeDownloadName,
  contentDisposition,
};
