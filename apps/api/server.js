/**
 * Точка входа API (Фаза 2).
 */
const config = require('./config');
const app = require('./app');

const port = config.port;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Emocog API (Phase 2) listening on http://${host}:${port}`);
});
