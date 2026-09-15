const fs = require('fs');
const path = require('path');

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'video/mp4',
  'video/webm',
  'application/pdf',
]);

const INLINE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'video/mp4',
  'video/webm',
]);

function startsWith(buffer, signature) {
  return signature.every((value, index) => buffer[index] === value);
}

function ascii(buffer, start, end) {
  return buffer.subarray(start, end).toString('ascii');
}

function matchesDeclaredMediaType(buffer, mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (mime === 'image/jpeg') return startsWith(buffer, [0xff, 0xd8, 0xff]);
  if (mime === 'image/png') {
    return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mime === 'image/gif') {
    return ascii(buffer, 0, 6) === 'GIF87a' || ascii(buffer, 0, 6) === 'GIF89a';
  }
  if (mime === 'image/webp') {
    return ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP';
  }
  if (mime === 'application/pdf') return ascii(buffer, 0, 5) === '%PDF-';
  if (mime === 'audio/ogg') return ascii(buffer, 0, 4) === 'OggS';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') {
    return ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WAVE';
  }
  if (mime === 'audio/mpeg') {
    return ascii(buffer, 0, 3) === 'ID3'
      || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  }
  if (mime === 'video/mp4') return ascii(buffer, 4, 8) === 'ftyp';
  if (mime === 'video/webm') return startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
  return false;
}

async function verifyUploadedFileType(uploadRoot, relativePath, mimeType) {
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(String(mimeType || '').toLowerCase())) {
    return false;
  }
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) {
    return false;
  }

  const fileName = path.basename(relativePath);
  if (
    fileName !== relativePath
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,511}$/.test(fileName)
  ) {
    return false;
  }

  const realRoot = await fs.promises.realpath(path.resolve(uploadRoot));
  const candidatePath = path.resolve(realRoot, fileName);
  const realFilePath = await fs.promises.realpath(candidatePath);
  if (!realFilePath.startsWith(`${realRoot}${path.sep}`)) return false;

  const handle = await fs.promises.open(realFilePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return false;
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return matchesDeclaredMediaType(buffer.subarray(0, bytesRead), mimeType);
  } finally {
    await handle.close();
  }
}

module.exports = {
  ALLOWED_UPLOAD_MIME_TYPES,
  INLINE_MEDIA_TYPES,
  matchesDeclaredMediaType,
  verifyUploadedFileType,
};
