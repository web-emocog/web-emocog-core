const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
  const stat = await fs.promises.stat(inputPath);
  if (!stat.isFile() || stat.size < 8 || stat.size > maxBytes) {
    throw new ConversionError(413, 'Document size is outside the allowed range', 'document_size_invalid');
  }
  const bytes = await fs.promises.readFile(inputPath);
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
  return { extension, size: stat.size };
}

function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 45_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    const maxOutput = 64 * 1024;
    child.stdout.on('data', chunk => { if (stdout.length < maxOutput) stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { if (stderr.length < maxOutput) stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ConversionError(504, 'Document conversion timed out', 'document_conversion_timeout'));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(new ConversionError(503, `${command} is unavailable`, 'document_converter_unavailable'));
      } else reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ConversionError(422, 'Document conversion failed', 'document_conversion_failed'));
    });
  });
}

function parsePdfInfo(output, maxPages) {
  const pageMatch = String(output).match(/^Pages:\s+(\d+)\s*$/mi);
  const sizeMatch = String(output).match(/^Page size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts/m);
  const pages = pageMatch ? Number.parseInt(pageMatch[1], 10) : null;
  if (!Number.isInteger(pages) || pages < 1 || pages > maxPages) {
    throw new ConversionError(422, `Document must contain 1-${maxPages} pages`, 'document_page_limit');
  }
  if (sizeMatch && (Number(sizeMatch[1]) > 20_000 || Number(sizeMatch[2]) > 20_000)) {
    throw new ConversionError(422, 'PDF page dimensions are too large', 'document_page_dimensions_invalid');
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
  await fs.promises.mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const tempDir = await fs.promises.mkdtemp(path.join(tempRoot, 'job-'));
  try {
    const document = await validateDocument(inputPath, originalName, declaredMime, maxBytes);
    const sourcePath = path.join(tempDir, `source${document.extension}`);
    await fs.promises.copyFile(inputPath, sourcePath, fs.constants.COPYFILE_EXCL);
    let pdfPath = sourcePath;
    if (document.extension !== '.pdf') {
      await runCommand(libreOfficeBin, [
        '--headless', '--nologo', '--nodefault', '--nolockcheck', '--norestore',
        `-env:UserInstallation=${new URL(`file://${path.join(tempDir, 'lo-profile')}`).href}`,
        '--convert-to', 'pdf', '--outdir', tempDir, sourcePath,
      ], { cwd: tempDir, timeoutMs });
      pdfPath = path.join(tempDir, 'source.pdf');
      try {
        await fs.promises.access(pdfPath, fs.constants.R_OK);
      } catch (_) {
        throw new ConversionError(422, 'LibreOffice did not produce a PDF', 'document_conversion_failed');
      }
    }
    const info = await runCommand(pdfInfoBin, [pdfPath], { cwd: tempDir, timeoutMs });
    const pageCount = parsePdfInfo(info.stdout, maxPages);
    const outputPrefix = path.join(tempDir, 'page');
    await runCommand(pdfToPpmBin, [
      '-jpeg', '-r', String(dpi), '-jpegopt', 'quality=88',
      '-f', '1', '-l', String(pageCount), pdfPath, outputPrefix,
    ], { cwd: tempDir, timeoutMs });
    const entries = await fs.promises.readdir(tempDir);
    const pages = entries
      .filter(name => /^page-\d+\.jpg$/i.test(name))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
      .map(name => path.join(tempDir, name));
    if (pages.length !== pageCount) {
      throw new ConversionError(422, 'Rasterized page count does not match the PDF', 'document_page_count_mismatch');
    }
    for (const page of pages) {
      const stat = await fs.promises.stat(page);
      if (!stat.isFile() || stat.size < 4 || stat.size > maxBytes) {
        throw new ConversionError(422, 'Generated page is invalid', 'document_generated_page_invalid');
      }
      const signature = Buffer.alloc(3);
      const handle = await fs.promises.open(page, 'r');
      try { await handle.read(signature, 0, signature.length, 0); } finally { await handle.close(); }
      if (!startsWith(signature, [0xff, 0xd8, 0xff])) {
        throw new ConversionError(422, 'Generated page is not JPEG', 'document_generated_page_invalid');
      }
    }
    return { tempDir, pages, pageCount, sourceSize: document.size };
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
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
