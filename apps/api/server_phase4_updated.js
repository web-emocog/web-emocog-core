/**
 * Точка входа API с Фазой 4 (протоколы и приглашения). Исходный server.js не удаляем.
 * Запуск: node server_phase4_updated.js
 */
const config = require('./config');
const app = require('./app_phase4_updated');

const port = config.port;
app.listen(port, () => {
  console.log(`Emocog API (Phase 4) listening on port ${port}`);
});
