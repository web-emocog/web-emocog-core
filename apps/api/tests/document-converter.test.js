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
});
