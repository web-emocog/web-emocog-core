const { randomUUID } = require('node:crypto');
const { runWithRequest } = require('./request-context');

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ROUTES = new Set(['auth', 'identity', 'workspace', 'organizations', 'projects', 'protocols', 'invitations',
  'sessions', 'ingest', 'stimuli', 'analytics', 'export', 'contracts', 'experiments', 'proxy-metrics', 'operations', 'health', 'ready']);
const LIMITS = [25, 100, 500, 2000, 10000, Infinity];

function requestLabels(req) {
  const first = String(req.path || '').toLowerCase().split('/')[1];
  return { route: ROUTES.has(first) ? first : 'other', method: METHODS.has(req.method) ? req.method : 'OTHER' };
}

function createOperationalMetrics(options = {}) {
  const now = options.now || (() => performance.now());
  const counts = new Map();
  let aborted = 0;
  function middleware(req, res, next) {
    const requestId = randomUUID(), labels = requestLabels(req), started = now();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.once('finish', () => {
      const status = Math.max(1, Math.min(5, Math.floor(res.statusCode / 100))) + 'xx';
      const key = `${labels.route}|${labels.method}|${status}`;
      const value = counts.get(key) || { ...labels, status, count: 0, totalMs: 0, buckets: LIMITS.map(() => 0) };
      const elapsed = Math.max(0, now() - started);
      value.count++; value.totalMs += elapsed;
      LIMITS.forEach((limit, i) => { if (elapsed <= limit) value.buckets[i]++; });
      counts.set(key, value);
    });
    res.once('close', () => { if (!res.writableFinished) aborted++; });
    runWithRequest(requestId, next);
  }
  function snapshot() {
    return { formatVersion: 1, scope: 'api_process', startedAt: options.startedAt || null, aborted,
      requests: [...counts.values()].map(value => ({ ...value, buckets: value.buckets.slice() })) };
  }
  function prometheus() {
    const output = ['# TYPE wecog_http_requests_total counter', '# TYPE wecog_http_duration_seconds histogram',
      '# TYPE wecog_http_aborted_total counter', `wecog_http_aborted_total ${aborted}`];
    for (const value of counts.values()) {
      const labels = `route="${value.route}",method="${value.method}",status="${value.status}"`;
      output.push(`wecog_http_requests_total{${labels}} ${value.count}`);
      LIMITS.forEach((limit, i) => output.push(`wecog_http_duration_seconds_bucket{${labels},le="${limit === Infinity ? '+Inf' : limit / 1000}"} ${value.buckets[i]}`));
      output.push(`wecog_http_duration_seconds_sum{${labels}} ${value.totalMs / 1000}`,
        `wecog_http_duration_seconds_count{${labels}} ${value.count}`);
    }
    return output.join('\n') + '\n';
  }
  return { middleware, snapshot, prometheus };
}

module.exports = { createOperationalMetrics, requestLabels };
