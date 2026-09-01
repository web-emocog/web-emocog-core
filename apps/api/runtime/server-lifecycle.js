function writeLog(logger, level, event, details = {}) {
  const method = typeof logger?.[level] === 'function' ? logger[level] : logger?.log;
  if (typeof method !== 'function') return;
  method.call(logger, JSON.stringify({ level, event, ...details }));
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

function configureHttpServer(server, httpConfig) {
  server.requestTimeout = httpConfig.requestTimeoutMs;
  server.headersTimeout = httpConfig.headersTimeoutMs;
  server.keepAliveTimeout = httpConfig.keepAliveTimeoutMs;
  server.maxHeadersCount = httpConfig.maxHeadersCount;
}

function createShutdownController({
  server,
  pool,
  app,
  graceMs,
  logger = console,
  processRef = process,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let shuttingDown = false;
  let shutdownPromise = null;
  let forceTimer = null;

  const state = {
    isShuttingDown: () => shuttingDown,
  };
  app.locals.shutdownState = state;

  async function shutdown(reason = 'manual', exitCode = 0) {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    processRef.exitCode = Math.max(Number(processRef.exitCode) || 0, exitCode);
    writeLog(logger, 'info', 'api_shutdown_started', { reason, grace_ms: graceMs });

    shutdownPromise = (async () => {
      forceTimer = setTimer(() => {
        writeLog(logger, 'error', 'api_shutdown_forced', { reason });
        server.closeAllConnections?.();
      }, graceMs);
      forceTimer.unref?.();

      let closeError = null;
      try {
        await closeServer(server);
      } catch (error) {
        closeError = error;
        processRef.exitCode = 1;
        writeLog(logger, 'error', 'api_http_close_failed', {
          code: error?.code || 'unknown',
        });
      }

      try {
        await pool.end();
      } catch (error) {
        closeError ||= error;
        processRef.exitCode = 1;
        writeLog(logger, 'error', 'api_db_close_failed', {
          code: error?.code || 'unknown',
        });
      } finally {
        if (forceTimer) clearTimer(forceTimer);
      }

      writeLog(logger, closeError ? 'error' : 'info', 'api_shutdown_completed', {
        reason,
        exit_code: Number(processRef.exitCode) || 0,
      });
      if (closeError) throw closeError;
    })();

    return shutdownPromise;
  }

  return { state, shutdown };
}

function installProcessHandlers({ processRef = process, shutdown, logger = console }) {
  const onSignal = signal => void shutdown(signal, 0).catch(() => {});
  const onFatal = (event, error) => {
    writeLog(logger, 'error', event, {
      name: error?.name || 'Error',
      code: error?.code || 'unknown',
    });
    void shutdown(event, 1).catch(() => {});
  };
  const handlers = {
    SIGTERM: () => onSignal('SIGTERM'),
    SIGINT: () => onSignal('SIGINT'),
    uncaughtException: error => onFatal('uncaught_exception', error),
    unhandledRejection: error => onFatal('unhandled_rejection', error),
  };

  for (const [event, handler] of Object.entries(handlers)) {
    processRef.on(event, handler);
  }

  return () => {
    for (const [event, handler] of Object.entries(handlers)) {
      processRef.off(event, handler);
    }
  };
}

module.exports = {
  closeServer,
  configureHttpServer,
  createShutdownController,
  installProcessHandlers,
};
