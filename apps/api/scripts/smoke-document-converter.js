const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { convertDocument, runCommand } = require('../stimuli/document-converter');

function syntheticPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    ...Array(3).fill('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 6 0 R >>'),
    '<< /Length 0 >>\nstream\n\nendstream'];
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  return pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

function jpegDimensions(buffer) {
  for (let offset = 2; offset + 9 < buffer.length;) {
    assert.equal(buffer[offset], 0xff);
    const marker = buffer[offset + 1];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    const length = buffer.readUInt16BE(offset + 2); assert.ok(length >= 2); offset += 2 + length;
  }
  throw new Error('JPEG dimensions missing');
}

async function runSmoke() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-converter-smoke-'));
  try {
    if (process.platform === 'linux') {
      const result = await runCommand('python3', ['-c', 'import resource,json; print(json.dumps([resource.getrlimit(resource.RLIMIT_AS)[0],resource.getrlimit(resource.RLIMIT_FSIZE)[0],resource.getrlimit(resource.RLIMIT_CORE)[0]]))'],
        { timeoutMs: 5000, resourceLimits: true });
      assert.deepEqual(JSON.parse(result.stdout), [1024 ** 3, 256 * 1024 ** 2, 0]);
    }
    const inputPath = path.join(root, 'sample.pdf'); fs.writeFileSync(inputPath, syntheticPdf());
    const result = await convertDocument({ inputPath, originalName: 'sample.pdf', declaredMime: 'application/pdf',
      uploadsRoot: root, maxBytes: 1024 * 1024, maxPages: 10, timeoutMs: 15_000, dpi: 150, maxConcurrent: 1,
      pdfInfoBin: process.env.PDFINFO_BIN || 'pdfinfo', pdfToPpmBin: process.env.PDFTOPPM_BIN || 'pdftoppm' });
    assert.equal(result.pageCount, 3);
    for (const file of result.pages) assert.deepEqual(jpegDimensions(fs.readFileSync(file)), { width: 1275, height: 1650 });
    return { pages: result.pageCount, width: 1275, height: 1650, linuxLimitsChecked: process.platform === 'linux' };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

module.exports = { runSmoke };
if (require.main === module) runSmoke().then(result => console.log(JSON.stringify(result))).catch(() => {
  console.error('Document converter smoke failed'); process.exitCode = 1;
});
