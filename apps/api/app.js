const { logUnexpectedError } = require('./security/error-log');
/**
 * Express app (Фаза 2). Не удалять исходные файлы; это новый модуль.
 */
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { pool } = require('./db');

const authRoutes = require('./routes/auth');
const organizationsRoutes = require('./routes/organizations');
const projectsRoutes = require('./routes/projects');
const sessionsRoutes = require('./routes/sessions');
const ingestRoutes = require('./routes/ingest');
const exportRoutes = require('./routes/export');
const analyticsRoutes = require('./routes/analytics_new');
const protocolsRoutes = require('./routes/protocols_new');
const invitationsRoutes = require('./routes/invitations_new');
const experimentsRoutes = require('./routes/experiments');
const stimuliRoutes = require('./routes/stimuli');
const proxyMetricsRoutes = require('./routes/proxy_metrics');
const contractsRoutes = require('./routes/contracts');
const identityRoutes = require('./routes/identity');
const workspaceRoutes = require('./routes/workspace');
const { getRtAnalyzerHealth } = require('./rt/compute');
const { PostgresRateStore } = require('./security/postgres-rate-store');
const { HttpError } = require('./security/http-error');
const { createOperationalMetrics } = require('./operations/metrics');
const { requireAuth, requireRole } = require('./middleware/auth');
const {
  buildCorsOptions,
  createSecurityHeaders,
  createRouteAwareJsonParser,
  buildRouteRateLimitOptions,
  requireSecureTransport,
} = require('./security/http-security');

const app = express();
app.disable('x-powered-by');
const operationalMetrics = createOperationalMetrics({ startedAt: new Date().toISOString() });
app.locals.operationalMetrics = operationalMetrics;
app.use(operationalMetrics.middleware);
if (config.http.trustProxyHops > 0) {
  app.set('trust proxy', config.http.trustProxyHops);
}
app.use(createSecurityHeaders());
if (config.forceHttps) {
  app.use(requireSecureTransport);
}
app.use(cors(buildCorsOptions(config.http.corsOrigins)));
app.use(cookieParser());
const limiterOptions = buildRouteRateLimitOptions(config.http.rateLimits, config.http.rateLimitStore === 'postgres'
  ? { store: new PostgresRateStore(pool, config.jwt.secret) } : {});
limiterOptions.skip = req => ['GET', 'HEAD'].includes(req.method) && ['/health', '/ready'].includes(req.path);
app.use(rateLimit(limiterOptions));
app.use(createRouteAwareJsonParser(config.http.bodyLimits));

app.use('/auth', authRoutes);
app.use('/identity', identityRoutes);
app.use('/workspace', workspaceRoutes);
app.use('/organizations', organizationsRoutes);
app.use('/projects', projectsRoutes);
app.use('/sessions', sessionsRoutes);
app.use('/ingest', ingestRoutes);
app.use('/export', exportRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/protocols', protocolsRoutes);
app.use('/invitations', invitationsRoutes);
app.use('/experiments', experimentsRoutes);
app.use('/stimuli', stimuliRoutes);
app.use('/proxy-metrics', proxyMetricsRoutes);
app.use('/contracts', contractsRoutes);
app.get('/operations/metrics', requireAuth, requireRole('admin', 'developer'), (_req, res) => {
  res.type('text/plain; version=0.0.4; charset=utf-8').send(operationalMetrics.prometheus());
});

app.get('/health', async (req, res, next) => {
  try {
    const rtAnalyzer = await getRtAnalyzerHealth();
    res.json({
      status: 'ok',
      phase: 4,
      node_env: config.nodeEnv,
      release_version: config.release.version,
      release_sha: config.release.sha,
      uptime_sec: Math.round(process.uptime()),
      rt_analyzer: rtAnalyzer,
    });
  } catch (error) { next(error); }
});

app.get('/ready', async (req, res) => {
  if (app.locals.shutdownState?.isShuttingDown()) {
    return res.status(503).json({ status: 'not_ready', reason: 'shutting_down' });
  }
  try {
    await pool.query('SELECT 1');
    if (config.http.rateLimitStore === 'postgres') {
      const schema = await pool.query("SELECT to_regclass('public.http_rate_windows') AS limiter");
      if (!schema.rows[0]?.limiter) return res.status(503).json({ status: 'not_ready', reason: 'migration_required' });
    }
    return res.json({ status: 'ready', db: 'ok' });
  } catch (err) {
    return res.status(503).json({ status: 'not_ready', db: 'error' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    if (err.status === 503) res.setHeader('Retry-After', '5');
    return res.status(err.status).json({ error: err.message, code: err.code, requestId: req.requestId });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request body is too large',
      code: 'payload_too_large',
    });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'Uploaded file is too large',
      code: 'upload_too_large',
    });
  }
  if (err?.name === 'MulterError') {
    return res.status(400).json({
      error: 'Invalid multipart upload',
      code: 'invalid_upload',
    });
  }
  if (err?.code === 'UNSUPPORTED_STIMULUS_MEDIA_TYPE') {
    return res.status(415).json({
      error: err.message,
      code: 'unsupported_stimulus_media_type',
    });
  }
  if (err?.name === 'ConversionError' && Number.isInteger(err.status)) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code || 'document_conversion_failed',
    });
  }
  if (err?.code === 'cors_origin_denied') {
    return res.status(403).json({
      error: 'Origin is not allowed',
      code: err.code,
    });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON', code: 'invalid_json' });
  }
  // Only unexpected server faults get a sanitized diagnostic. Client-controlled 4xx
  // failures above must not expose request data or provide a log-flood vector.
  logUnexpectedError(err, 'app');
  res.status(500).json({ error: 'Internal server error', requestId: req.requestId });
});

module.exports = app;
