const fs = require('fs');
const path = require('path');
const { runNativeProcess } = require('../security/native-process');
const { resolveReadableServerOwnedUploadPath } = require('../security/upload-paths');

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
]);

class ConversionError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'ConversionError';
    this.status = status;
    this.code = code;
  }
}

function startsWith(buffer, bytes) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function zipEntryNames(buffer, maxEntries = 10_000) {
  const names = [];
  let offset = 0;
  while (offset <= buffer.length - 46 && names.length < maxEntries) {
    const signatureOffset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset);
    if (signatureOffset < 0 || signatureOffset + 46 > buffer.length) break;
    const nameLength = buffer.readUInt16LE(signatureOffset + 28);
    const extraLength = buffer.readUInt16LE(signatureOffset + 30);
    const commentLength = buffer.readUInt16LE(signatureOffset + 32);
    const nameStart = signatureOffset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) break;
    names.push(buffer.subarray(nameStart, nameEnd).toString('utf8'));
    offset = nameEnd + extraLength + commentLength;
  }
  return names;
}

async function validateDocument(inputPath, originalName, declaredMime, maxBytes) {
  const extension = path.extname(String(originalName || '')).toLowerCase();
  if (!['.pdf', '.ppt', '.pptx'].includes(extension)) {
    throw new ConversionError(415, 'Only PDF, PPT, and PPTX are supported', 'document_type_unsupported');
  }
  if (!DOCUMENT_MIME_TYPES.has(String(declaredMime || '').toLowerCase())) {
    throw new ConversionError(415, 'Declared media type is not supported', 'document_mime_unsupported');
  }
  let handle;
  let bytes;
  try {
    handle = await fs.promises.open(inputPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 8 || stat.size > maxBytes) {
      throw new ConversionError(413, 'Document size is outside the allowed range', 'document_size_invalid');
    }
    bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new ConversionError(413, 'Document changed during validation', 'document_size_invalid');
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== bytes.length) {
      throw new ConversionError(413, 'Document changed during validation', 'document_size_invalid');
    }
  } catch (error) {
    if (error.code === 'ELOOP') throw new ConversionError(415, 'Document must not be a symbolic link', 'document_file_invalid');
    throw error;
  } finally { if (handle) await handle.close(); }
  if (extension === '.pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ConversionError(415, 'PDF signature does not match its extension', 'document_signature_mismatch');
  }
  if (extension === '.ppt' && !startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw new ConversionError(415, 'PPT signature does not match its extension', 'document_signature_mismatch');
  }
  if (extension === '.pptx') {
    if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
      throw new ConversionError(415, 'PPTX is not an OOXML ZIP document', 'document_signature_mismatch');
    }
    const names = zipEntryNames(bytes);
    if (!names.includes('[Content_Types].xml') || !names.includes('ppt/presentation.xml')) {
      throw new ConversionError(415, 'PPTX package is missing required presentation entries', 'document_signature_mismatch');
    }
  }
  return { extension, size: bytes.length, bytes };
}

async function runCommand(command, args, options = {}) {
  try { return await runNativeProcess(command, args, options); }
  catch (error) {
    if (error.code === 'timeout') throw new ConversionError(504, 'Document conversion timed out', 'document_conversion_timeout');
    if (error.code === 'unavailable') throw new ConversionError(503, 'Document converter is unavailable', 'document_converter_unavailable');
    if (error.code === 'output_limit') throw new ConversionError(422, 'Document metadata exceeds limits', 'document_metadata_oversized');
    throw new ConversionError(422, 'Document conversion failed', 'document_conversion_failed');
  }
}

function parsePdfInfo(output, maxPages, options = {}) {
  const pageMatch = String(output).match(/^Pages:\s+(\d+)\s*$/mi);
  const pages = pageMatch ? Number.parseInt(pageMatch[1], 10) : null;
  if (!Number.isInteger(pages) || pages < 1 || pages > maxPages) {
    throw new ConversionError(422, `Document must contain 1-${maxPages} pages`, 'document_page_limit');
  }
  const sizes = [...String(output).matchAll(/^Page(?:\s+\d+)?\s+size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts/gmi)];
  if (!sizes.length || (options.requireAllPages && sizes.length !== pages)) {
    throw new ConversionError(422, 'PDF page dimensions are missing', 'document_page_dimensions_invalid');
  }
  const dpi = options.dpi || 150;
  let totalPixels = 0;
  for (const size of sizes) {
    const width = Math.ceil(Number(size[1]) * dpi / 72);
    const height = Math.ceil(Number(size[2]) * dpi / 72);
    const pixels = width * height;
    if (!Number.isFinite(pixels) || width < 1 || height < 1 || width > 8192 || height > 8192 || pixels > 16_000_000) {
      throw new ConversionError(422, 'PDF page dimensions are too large', 'document_page_dimensions_invalid');
    }
    totalPixels += pixels;
  }
  if (totalPixels > 256_000_000) {
    throw new ConversionError(422, 'Document raster budget exceeded', 'document_pixel_limit');
  }
  return pages;
}

function createLimiter(maxConcurrent) {
  let active = 0;
  return {
    acquire() {
      if (active >= maxConcurrent) {
        throw new ConversionError(503, 'Document conversion capacity is busy', 'document_conversion_busy');
      }
      active += 1;
      let released = false;
      return () => {
        if (!released) active = Math.max(0, active - 1);
        released = true;
      };
    },
    active: () => active,
  };
}

const limiters = new Map();

function limiterFor(maxConcurrent) {
  if (!limiters.has(maxConcurrent)) limiters.set(maxConcurrent, createLimiter(maxConcurrent));
  return limiters.get(maxConcurrent);
}

async function convertDocument(options) {
  const {
    inputPath,
    originalName,
    declaredMime,
    uploadsRoot,
    maxBytes,
    maxPages,
    timeoutMs,
    dpi,
    maxConcurrent,
    libreOfficeBin,
    pdfInfoBin,
    pdfToPpmBin,
  } = options;
  const release = limiterFor(maxConcurrent).acquire();
  const tempRoot = path.join(uploadsRoot, '.conversion');
  let tempDir;
  const deadline = Date.now() + timeoutMs;
  const commandOptions = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ConversionError(504, 'Document conversion timed out', 'document_conversion_timeout');
    return { cwd: tempDir, timeoutMs: remaining, resourceLimits: true };
  };
  try {
    const source = await resolveReadableServerOwnedUploadPath(uploadsRoot,
      path.relative(path.resolve(uploadsRoot), path.resolve(inputPath)));
    if (!source.ok) {
      throw new ConversionError(415, 'Document must be a server-owned regular upload', 'document_file_invalid');
    }
    await fs.promises.mkdir(tempRoot, { recursive: true, mode: 0o700 });
    tempDir = await fs.promises.mkdtemp(path.join(tempRoot, 'job-'));
    const document = await validateDocument(source.absolutePath, originalName, declaredMime, maxBytes);
    const sourcePath = path.join(tempDir, `source${document.extension}`);
    // Convert the exact validated bytes, never reopen the upload pathname.
    await fs.promises.writeFile(sourcePath, document.bytes, { flag: 'wx', mode: 0o600 });
    let pdfPath = sourcePath;
    if (document.extension !== '.pdf') {
      await runCommand(libreOfficeBin, [
        '--headless', '--nologo', '--nodefault', '--nolockcheck', '--norestore',
        `-env:UserInstallation=${new URL(`file://${path.join(tempDir, 'lo-profile')}`).href}`,
        '--convert-to', 'pdf', '--outdir', tempDir, sourcePath,
      ], commandOptions());
      pdfPath = path.join(tempDir, 'source.pdf');
      try {
        await fs.promises.access(pdfPath, fs.constants.R_OK);
      } catch (_) {
        throw new ConversionError(422, 'LibreOffice did not produce a PDF', 'document_conversion_failed');
      }
    }
    const info = await runCommand(pdfInfoBin, [pdfPath], commandOptions());
    const pageCount = parsePdfInfo(info.stdout, maxPages, { dpi });
    const allPages = await runCommand(pdfInfoBin, ['-f', '1', '-l', String(pageCount), pdfPath], commandOptions());
    parsePdfInfo(allPages.stdout, maxPages, { dpi, requireAllPages: true });
    const pages = [];
    let outputBytes = 0;
    // Check disk cost between pages instead of rendering the whole document
    // before discovering that its output exceeds the budget.
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const outputPrefix = path.join(tempDir, `page-${pageNumber}`);
      await runCommand(pdfToPpmBin, [
        '-jpeg', '-r', String(dpi), '-jpegopt', 'quality=88', '-singlefile',
        '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, outputPrefix,
      ], commandOptions());
      const page = `${outputPrefix}.jpg`;
      const signature = Buffer.alloc(3);
      let handle;
      try {
        handle = await fs.promises.open(page, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const stat = await handle.stat();
        outputBytes += stat.size;
        if (outputBytes > 256 * 1024 * 1024) {
          throw new ConversionError(422, 'Generated document is too large', 'document_output_limit');
        }
        if (!stat.isFile() || stat.size < 4 || stat.size > maxBytes) {
          throw new ConversionError(422, 'Generated page is invalid', 'document_generated_page_invalid');
        }
        await handle.read(signature, 0, signature.length, 0);
      } catch (error) {
        if (error.code === 'ENOENT') throw new ConversionError(422, 'Rasterized page is missing', 'document_page_count_mismatch');
        if (error.code === 'ELOOP') throw new ConversionError(422, 'Generated page is invalid', 'document_generated_page_invalid');
        throw error;
      } finally { if (handle) await handle.close(); }
      if (!startsWith(signature, [0xff, 0xd8, 0xff])) {
        throw new ConversionError(422, 'Generated page is not JPEG', 'document_generated_page_invalid');
      }
      pages.push(page);
    }
    return { tempDir, pages, pageCount, sourceSize: document.size };
  } catch (error) {
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    release();
  }
}

async function cleanupConversion(result) {
  if (result?.tempDir) await fs.promises.rm(result.tempDir, { recursive: true, force: true });
}

module.exports = {
  ConversionError,
  DOCUMENT_MIME_TYPES,
  cleanupConversion,
  convertDocument,
  createLimiter,
  parsePdfInfo,
  runCommand,
  validateDocument,
  zipEntryNames,
};
