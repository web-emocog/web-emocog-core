/**
 * Точка входа API (Фаза 2).
 */
const config = require('./config');
const app = require('./app');
const { pool } = require('./db');
const {
  configureHttpServer,
  createShutdownController,
  installProcessHandlers,
} = require('./runtime/server-lifecycle');

function startServer(options = {}) {
  const appInstance = options.app || app;
  const poolInstance = options.pool || pool;
  const configValue = options.config || config;
  const logger = options.logger || console;
  const processRef = options.processRef || process;
  const port = options.port ?? configValue.port;
  const host = options.host || process.env.HOST || '0.0.0.0';
  const server = appInstance.listen(port, host, () => {
    logger.log(JSON.stringify({
      level: 'info',
      event: 'api_started',
      host,
      port: server.address()?.port || port,
      release_sha: configValue.release.sha,
    }));
  });
  configureHttpServer(server, configValue.http);
  const controller = createShutdownController({
    server,
    pool: poolInstance,
    app: appInstance,
    graceMs: configValue.http.shutdownGraceMs,
    logger,
    processRef,
  });
  const removeProcessHandlers = installProcessHandlers({
    processRef,
    shutdown: controller.shutdown,
    logger,
  });
  return { server, ...controller, removeProcessHandlers };
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
