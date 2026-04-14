/**
 * Express app с маршрутами аналитики (Фаза 3). Обновлённый вариант — исходный app.js не удаляем.
 */
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');

const authRoutes = require('./routes/auth');
const organizationsRoutes = require('./routes/organizations');
const projectsRoutes = require('./routes/projects');
const sessionsRoutes = require('./routes/sessions');
const eventsRoutes = require('./routes/events');
const ingestRoutes = require('./routes/ingest');
const exportRoutes = require('./routes/export');
const analyticsRoutes = require('./routes/analytics_new');

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

app.get('/health', (req, res) => res.json({ status: 'ok', phase: 3 }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
