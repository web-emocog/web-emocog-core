(function (root) {
  'use strict';

  function normalizeCode(value) {
    const code = typeof value === 'string' ? value.trim() : '';
    return /^[a-zA-Z0-9_-]{1,64}$/.test(code) ? code : null;
  }

  function decodeCode(segment) {
    try {
      return normalizeCode(decodeURIComponent(segment));
    } catch (_) {
      // Pasted legacy fragments can contain incomplete percent escapes.
      return null;
    }
  }

  function fromHash(hash) {
    const match = /^#\/?participant\/([^/?#]+)\/?$/i.exec(hash || '');
    return match ? decodeCode(match[1]) : null;
  }

  function readUrl(url) {
    const codes = url.searchParams.getAll('code');
    if (codes.length) return { supplied: true, code: codes.length === 1 ? normalizeCode(codes[0]) : null };
    if (/^#\/?participant(?:\/|$)/i.test(url.hash)) return { supplied: true, code: fromHash(url.hash) };
    const shortLink = /^\/invite\/([^/]+)\/?$/.exec(url.pathname);
    return shortLink ? { supplied: true, code: decodeCode(shortLink[1]) } : { supplied: false, code: null };
  }

  function fromInput(value) {
    if (typeof value !== 'string' || value.length > 8192) return null;
    const input = value.trim();
    if (!input) return null;
    const code = normalizeCode(input);
    if (code) return code;
    try {
      // Only extract a code; never navigate to or fetch the pasted origin.
      const url = new URL(input, 'https://invitation.invalid/');
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return readUrl(url).code;
    } catch (_) {
      return null;
    }
  }

  const api = Object.freeze({ fromHash, fromInput, readUrl });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EmocogInvitationLink = api;
})(globalThis);
