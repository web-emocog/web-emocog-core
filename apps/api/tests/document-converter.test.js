const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ConversionError,
  createLimiter,
  parsePdfInfo,
  validateDocument,
  zipEntryNames,
  runCommand,
  convertDocument,
  cleanupConversion,
} = require('../stimuli/document-converter');

function centralDirectoryEntry(name) {
  const filename = Buffer.from(name);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(filename.length, 28);
  return Buffer.concat([header, filename]);
}

test('document conversion boundary', async t => {
  await t.test('parses bounded PDF metadata', () => {
    assert.equal(parsePdfInfo('Pages: 3\nPage size: 595 x 842 pts\n', 10), 3);
    assert.throws(() => parsePdfInfo('Pages: 11\n', 10), error => error.code === 'document_page_limit');
    assert.throws(() => parsePdfInfo('Pages: 1\nPage size: 25000 x 842 pts\n', 10), error => error.code === 'document_page_dimensions_invalid');
  });

  await t.test('recognizes required PPTX package entries', () => {
    const archive = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      centralDirectoryEntry('[Content_Types].xml'),
      centralDirectoryEntry('ppt/presentation.xml'),
    ]);
    assert.deepEqual(zipEntryNames(archive), ['[Content_Types].xml', 'ppt/presentation.xml']);
  });

  await t.test('rejects extension/signature mismatch before invoking converters', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-convert-'));
    const file = path.join(root, 'malicious.pdf');
    try {
      fs.writeFileSync(file, 'not-a-pdf');
      await assert.rejects(
        validateDocument(file, 'malicious.pdf', 'application/pdf', 1024),
        error => error instanceof ConversionError && error.code === 'document_signature_mismatch'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('fails busy instead of creating an unbounded conversion queue', () => {
    const limiter = createLimiter(1);
    const release = limiter.acquire();
    assert.throws(() => limiter.acquire(), error => error.code === 'document_conversion_busy');
    release();
    const releaseAgain = limiter.acquire();
    releaseAgain();
    assert.equal(limiter.active(), 0);
  });

  await t.test('rejects symlinks and directories and returns exactly the validated bytes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-convert-fd-'));
    try {
      const file = path.join(root, 'upload');
      const bytes = Buffer.from('%PDF-1.4\nsynthetic');
      fs.writeFileSync(file, bytes);
      fs.symlinkSync(file, path.join(root, 'link'));
      await assert.rejects(validateDocument(path.join(root, 'link'), 'file.pdf', 'application/pdf', 1024),
        e => e.code === 'document_file_invalid');
      await assert.rejects(validateDocument(root, 'file.pdf', 'application/pdf', 1024),
        e => e.code === 'document_size_invalid');
      await assert.rejects(validateDocument(file, 'file.pdf', 'application/pdf', 8),
        e => e.code === 'document_size_invalid');
      const validated = await validateDocument(file, 'file.pdf', 'application/pdf', 1024);
      fs.writeFileSync(file, 'replaced after validation');
      assert.deepEqual(validated.bytes, bytes);
      assert.equal(validated.size, bytes.length);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

test('all PDF pages have bounded raster cost at the configured DPI', () => {
  for (const text of ['Pages: 1\n', 'Pages: 1\nPage size: 0 x 0 pts\n',
    'Pages: 1\nPage size: 20000 x 20000 pts\n']) {
    assert.throws(() => parsePdfInfo(text, 100), e => e.code === 'document_page_dimensions_invalid');
  }
  assert.throws(() => parsePdfInfo('Pages: 2\nPage 1 size: 595 x 842 pts\nPage 2 size: 20000 x 20000 pts\n', 100,
    { requireAllPages: true }), e => e.code === 'document_page_dimensions_invalid');
  assert.throws(() => parsePdfInfo('Pages: 2\nPage size: 595 x 842 pts\n', 100,
    { requireAllPages: true }), e => e.code === 'document_page_dimensions_invalid');
  const hundredA4 = 'Pages: 100\n' + Array.from({ length: 100 }, (_, i) => `Page ${i + 1} size: 595 x 842 pts\n`).join('');
  assert.equal(parsePdfInfo(hundredA4, 100, { requireAllPages: true }), 100);
  assert.throws(() => parsePdfInfo(hundredA4, 100, { requireAllPages: true, dpi: 300 }), e => e.code === 'document_pixel_limit');
});

test('conversion confines documents to the owned upload root and rejects linked parent paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-convert-root-'));
  try {
    const uploads = path.join(root, 'uploads'), outside = path.join(root, 'outside');
    fs.mkdirSync(uploads); fs.mkdirSync(outside);
    const external = path.join(outside, 'sample.pdf');
    fs.writeFileSync(external, '%PDF-1.4\nsynthetic');
    fs.symlinkSync(outside, path.join(uploads, 'linked-parent'));
    fs.linkSync(external, path.join(uploads, 'hardlink.pdf'));
    for (const inputPath of [external, path.join(uploads, 'linked-parent/sample.pdf'), path.join(uploads, 'hardlink.pdf')]) {
      await assert.rejects(convertDocument({ inputPath, originalName: 'sample.pdf',
        declaredMime: 'application/pdf', uploadsRoot: uploads, maxBytes: 1024, maxPages: 10,
        timeoutMs: 1000, dpi: 150, maxConcurrent: 1 }), { code: 'document_file_invalid' });
    }
    assert.equal(fs.existsSync(path.join(uploads, '.conversion')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native converters do not inherit signing keys and time out cleanly', async () => {
  process.env.WECOG_TEST_SECRET = 'must-not-reach-child';
  try {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.env.WECOG_TEST_SECRET || "absent")']);
    assert.equal(result.stdout, 'absent');
    await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }),
      e => e.code === 'document_conversion_timeout');
  } finally { delete process.env.WECOG_TEST_SECRET; }
});

// Opt-in real Poppler smoke; never uses a participant document.
test('real PDF conversion preserves ordinary page dimensions and cleans up', { skip: process.env.RUN_POPPLER_SMOKE !== '1' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-poppler-'));
  let converted;
  try {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
      '<< /Length 0 >>\nstream\n\nendstream'];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += 'xref\n0 5\n0000000000 65535 f \n' + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const inputPath = path.join(root, 'sample.pdf'); fs.writeFileSync(inputPath, pdf);
    converted = await convertDocument({ inputPath, originalName: 'sample.pdf', declaredMime: 'application/pdf',
      uploadsRoot: root, maxBytes: 1024 * 1024, maxPages: 10, timeoutMs: 10_000, dpi: 150, maxConcurrent: 1,
      pdfInfoBin: process.env.PDFINFO_BIN || 'pdfinfo', pdfToPpmBin: process.env.PDFTOPPM_BIN || 'pdftoppm' });
    assert.equal(converted.pageCount, 1);
    assert.ok(fs.statSync(converted.pages[0]).size > 100);
    await cleanupConversion(converted);
    assert.equal(fs.existsSync(converted.tempDir), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('release converter smoke processes multiple pages at the requested DPI', { skip: process.env.RUN_POPPLER_SMOKE !== '1' }, async () => {
  const { runSmoke } = require('../scripts/smoke-document-converter');
  assert.deepEqual(await runSmoke(), { pages: 3, width: 1275, height: 1650, linuxLimitsChecked: process.platform === 'linux' });
});
