function protectSpreadsheetCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Untrusted text can become a formula; actual numeric observations stay numeric.
  return typeof value === 'string' && /^(?:\s*[=+@-]|[\t\r\n])/.test(text) ? `'${text}` : text;
}

function escapeCsv(value) {
  const text = protectSpreadsheetCell(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = { protectSpreadsheetCell, escapeCsv };
