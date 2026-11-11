const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  configureHttpServer,
  createShutdownController,
  installProcessHandlers,
} = require('../runtime/server-lifecycle');

function createLogger() {
  const lines = [];
  return {
    lines,
    log(value) { lines.push(value); },
    info(value) { lines.push(value); },
    error(value) { lines.push(value); },
  };
}

describe('production server lifecycle', () => {
  it('applies bounded HTTP server timeouts', () => {
    const server = {};
    configureHttpServer(server, {
      requestTimeoutMs: 120_000,
      headersTimeoutMs: 30_000,
      keepAliveTimeoutMs: 5_000,
      maxHeadersCount: 100,
    });
    assert.deepEqual(server, {
      requestTimeout: 120_000,
      headersTimeout: 30_000,
      keepAliveTimeout: 5_000,
      maxHeadersCount: 100,
    });
  });

  it('marks readiness false, drains HTTP and closes PostgreSQL exactly once', async () => {
    let closeCalls = 0;
    let idleCloseCalls = 0;
    let poolEndCalls = 0;
    const server = {
      listening: true,
      close(callback) {
        closeCalls += 1;
        this.listening = false;
        callback();
      },
      closeIdleConnections() { idleCloseCalls += 1; },
      closeAllConnections() { throw new Error('force close must not be needed'); },
    };
    const pool = { async end() { poolEndCalls += 1; } };
    const app = { locals: {} };
    const processRef = { exitCode: 0 };
    const logger = createLogger();
    const controller = createShutdownController({
      server,
      pool,
      app,
      graceMs: 1_000,
      logger,
      processRef,
    });

    const first = controller.shutdown('SIGTERM', 0);
    const second = controller.shutdown('SIGINT', 0);
    assert.equal(app.locals.shutdownState.isShuttingDown(), true);
    await Promise.all([first, second]);
    assert.equal(closeCalls, 1);
    assert.equal(idleCloseCalls, 1);
    assert.equal(poolEndCalls, 1);
    assert.equal(processRef.exitCode, 0);
    assert.ok(logger.lines.some(line => line.includes('api_shutdown_completed')));
  });

  it('installs removable signal and fatal-error handlers', () => {
    const processRef = new EventEmitter();
    processRef.exitCode = 0;
    const calls = [];
    const remove = installProcessHandlers({
      processRef,
      shutdown: async (reason, code) => calls.push([reason, code]),
      logger: createLogger(),
    });
    processRef.emit('SIGTERM');
    processRef.emit('unhandledRejection', new Error('test'));
    assert.deepEqual(calls, [['SIGTERM', 0], ['unhandled_rejection', 1]]);
    remove();
    assert.equal(processRef.listenerCount('SIGTERM'), 0);
    assert.equal(processRef.listenerCount('unhandledRejection'), 0);
  });

  it('fatal diagnostics never serialize attacker-controlled names, codes or messages', () => {
    const processRef = new EventEmitter(), logger = createLogger();
    const remove = installProcessHandlers({ processRef, logger, shutdown: async () => {} });
    processRef.emit('uncaughtException', { name: 'PRIVATE_EMAIL', code: 'PRIVATE_TOKEN', message: 'PRIVATE_PASSWORD' });
    remove();
    assert.equal(JSON.parse(logger.lines[0]).event, 'uncaught_exception');
    assert.ok(!logger.lines.join('').includes('PRIVATE'));
  });

  it('stops service workers before the pool, even when their shutdown fails', async () => {
    const order = [], processRef = { exitCode: 0 }, logger = createLogger();
    const controller = createShutdownController({
      server: { listening: true, close(callback) { this.listening = false; callback(); }, closeIdleConnections() {} },
      pool: { async end() { order.push('database'); } },
      app: { locals: { shutdownHooks: [async () => { order.push('mail'); throw new Error('PRIVATE'); }] } },
      graceMs: 1000, processRef, logger,
    });
    await assert.rejects(controller.shutdown());
    assert.deepEqual(order, ['mail', 'database']);
    assert.equal(processRef.exitCode, 1);
    assert.ok(!logger.lines.join('').includes('PRIVATE'));
  });
});
