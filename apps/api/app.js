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
const eventsRoutes = require('./routes/events');
const ingestRoutes = require('./routes/ingest');
const exportRoutes = require('./routes/export');
const analyticsRoutes = require('./routes/analytics_new');
const protocolsRoutes = require('./routes/protocols_new');
const invitationsRoutes = require('./routes/invitations_new');
const experimentsRoutes = require('./routes/experiments');
const stimuliRoutes = require('./routes/stimuli');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

if (config.forceHttps) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    next();
  });
}

app.use('/auth', authRoutes);
app.use('/organizations', organizationsRoutes);
app.use('/projects', projectsRoutes);
app.use('/sessions', sessionsRoutes);
app.use('/events', eventsRoutes);
app.use('/ingest', ingestRoutes);
app.use('/export', exportRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/protocols', protocolsRoutes);
app.use('/invitations', invitationsRoutes);
app.use('/experiments', experimentsRoutes);
app.use('/stimuli', stimuliRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', phase: 4, node_env: config.nodeEnv, uptime_sec: Math.round(process.uptime()) });
});

app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', db: 'error' });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
