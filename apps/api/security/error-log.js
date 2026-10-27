const { randomUUID } = require('node:crypto');

const DATABASE_CODES = new Set(['23502', '23503', '23505', '23514', '40001', '40P01', '53300', '57P01', '57014', '08006']);
const SYSTEM_CODES = new Set(['EACCES', 'EPIPE', 'ENOSPC', 'EMFILE', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET']);

// Errors from SQL/native tools may carry PII, tokens, bind values and paths.
// Log a new allowlisted record, never serialize the original Error object.
function errorRecord(error, component = 'api') {
  let code = null;
  try { if (typeof error?.code === 'string') code = error.code; } catch (_) {}
  const known = DATABASE_CODES.has(code) || SYSTEM_CODES.has(code);
  return { event: 'unexpected_api_error', errorId: randomUUID(),
    component: typeof component === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(component) ? component : 'api',
    category: DATABASE_CODES.has(code) ? 'database' : SYSTEM_CODES.has(code) ? 'system' : 'internal',
    code: known ? code : null };
}
function logUnexpectedError(error, component) {
  const record = errorRecord(error, component);
  try { console.error(JSON.stringify(record)); } catch (_) { /* Logging cannot replace the API's safe response. */ }
  return record;
}
module.exports = { errorRecord, logUnexpectedError };
