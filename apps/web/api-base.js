/* Shared API endpoint resolver for researcher and developer browser pages. */
(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.EmocogApiBase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function normalizedHostname(value) {
    return String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  }

  function isLoopback(hostname) {
    var host = normalizedHostname(hostname);
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  function normalizeAllowedOrigins(value) {
    var entries = Array.isArray(value) ? value : String(value || '').split(',');
    return entries.map(function (entry) {
      try {
        return new URL(String(entry).trim()).origin;
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  }

  function parseCandidate(value, pageUrl) {
    if (!value || !String(value).trim()) return null;
    try {
      return new URL(String(value).trim(), pageUrl);
    } catch (_) {
      return null;
    }
  }

  function isAllowed(candidate, pageUrl, allowedOrigins) {
    if (!candidate || ['http:', 'https:'].indexOf(candidate.protocol) < 0) return false;
    if (candidate.origin === pageUrl.origin) return true;
    if (
      isLoopback(pageUrl.hostname)
      && isLoopback(candidate.hostname)
      && candidate.protocol === pageUrl.protocol
    ) {
      return true;
    }
    return candidate.protocol === 'https:'
      && normalizeAllowedOrigins(allowedOrigins).indexOf(candidate.origin) >= 0;
  }

  function localApiOrigin(pageUrl) {
    var host = normalizedHostname(pageUrl.hostname);
    if (host.indexOf(':') >= 0) host = '[' + host + ']';
    return pageUrl.protocol + '//' + host + ':3000';
  }

  function defaultApiBase(pageUrl) {
    if (isLoopback(pageUrl.hostname)) {
      return pageUrl.port === '3000'
        ? pageUrl.origin
        : localApiOrigin(pageUrl);
    }
    if ((pageUrl.pathname || '').indexOf('/main/') === 0) {
      return pageUrl.origin + '/main/api';
    }
    return pageUrl.origin + '/api';
  }

  function resolve(options) {
    var opts = options || {};
    var runtime = opts.runtime || (typeof globalThis !== 'undefined' ? globalThis : {});
    var pageUrl = opts.pageUrl instanceof URL
      ? opts.pageUrl
      : new URL(opts.pageUrl || (runtime.location && runtime.location.href) || 'http://localhost/');
    var allowedOrigins = opts.allowedOrigins != null
      ? opts.allowedOrigins
      : runtime.WECOG_API_ORIGINS;
    var candidates = [opts.configuredBase, runtime.WECOG_API_BASE, runtime.API_BASE];
    var allowStorage = opts.useStorage !== false && (
      isLoopback(pageUrl.hostname)
      || runtime.WECOG_ALLOW_API_OVERRIDE === true
    );

    if (allowStorage) {
      try {
        candidates.push(runtime.localStorage && runtime.localStorage.getItem('emocog_api_base'));
      } catch (_) {}
    }

    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = parseCandidate(candidates[i], pageUrl);
      if (isAllowed(candidate, pageUrl, allowedOrigins)) {
        return trimTrailingSlash(candidate.href);
      }
    }
    return trimTrailingSlash(defaultApiBase(pageUrl));
  }

  return {
    resolve: resolve,
    isAllowed: isAllowed,
    isLoopback: isLoopback,
    defaultApiBase: defaultApiBase
  };
});
