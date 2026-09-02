/**
 * Express app (Фаза 2). Не удалять исходные файлы; это новый модуль.
 */
const express = require('express');
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
const { getRtAnalyzerHealth } = require('./rt/compute');
const {
  buildCorsOptions,
  createSecurityHeaders,
  createRouteAwareJsonParser,
  createRouteRateLimiter,
  requireSecureTransport,
} = require('./security/http-security');

const app = express();
app.disable('x-powered-by');
if (config.http.trustProxyHops > 0) {
  app.set('trust proxy', config.http.trustProxyHops);
}
app.use(createSecurityHeaders());
if (config.forceHttps) {
  app.use(requireSecureTransport);
}
app.use(cors(buildCorsOptions(config.http.corsOrigins)));
app.use(cookieParser());
app.use(createRouteRateLimiter(config.http.rateLimits));
app.use(createRouteAwareJsonParser(config.http.bodyLimits));

app.use('/auth', authRoutes);
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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    phase: 4,
    node_env: config.nodeEnv,
    release_version: config.release.version,
    release_sha: config.release.sha,
    uptime_sec: Math.round(process.uptime()),
    rt_analyzer: getRtAnalyzerHealth(),
  });
});

app.get('/ready', async (req, res) => {
  if (app.locals.shutdownState?.isShuttingDown()) {
    return res.status(503).json({ status: 'not_ready', reason: 'shutting_down' });
  }
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ready', db: 'ok' });
  } catch (err) {
    return res.status(503).json({ status: 'not_ready', db: 'error' });
  }
});

app.use((err, req, res, next) => {
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
  // Only unexpected server faults get a stack trace. Client-controlled 4xx
  // failures above must not expose request data or provide a log-flood vector.
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
