/* Bounded staff HTTP: the deadline includes body parsing, not just headers. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = { createHttpClient: factory };
  if (!root.document) return;
  function context(scope) {
    root.WecogStaffSession?.assertCurrent();
    var owner = root.localStorage.getItem('emocog_workspace_owner_v1') || '';
    // Workspace caches survive SPA routes; page-owned work must not.
    var route = root.location.pathname + root.location.search + (scope === 'page' ? root.location.hash : '');
    var project = scope !== 'document' ? root.localStorage.getItem('emocog_selected_project_id') : null;
    return { owner: owner, key: JSON.stringify([route, project, root.EmocogApiBase.resolve()]) };
  }
  var client = factory({
    fetch: function (input, init) { return root.fetch(input, init); }, context: context,
    validateUrl: function (input) {
      var url = new URL(typeof input?.url === 'string' ? input.url : String(input), root.location.href);
      return !url.username && !url.password && ['http:', 'https:'].includes(url.protocol)
        && (url.origin === root.location.origin || url.origin === new URL(root.EmocogApiBase.resolve()).origin
          || url.origin === new URL(root.EmocogApiBase.resolve({ useStorage: false })).origin);
    },
    message: function (code, uncertain) {
      var en = root.document.documentElement.lang === 'en';
      var text = code === 'request_timeout'
        ? (en ? 'The server response timed out.' : 'Сервер не ответил вовремя.')
        : code === 'request_network_error'
          ? (en ? 'The server is unavailable.' : 'Сервер недоступен.')
          : (en ? 'The request was cancelled or its context changed.' : 'Запрос отменён или его контекст изменился.');
      return text + (uncertain ? (en
        ? ' The change may already have been saved. Check before repeating it.'
        : ' Изменение могло сохраниться. Проверьте результат перед повтором.') : '');
    }
  });
  root.WecogHttp = client;
  ['hashchange', 'storage', 'wecog:projectchange'].forEach(function (type) {
    root.addEventListener(type, client.cancelChanged);
  });
  root.addEventListener('wecog:staffsessionblocked', function () { client.cancelAll('staff_account_changed'); });
  root.addEventListener('pagehide', function () { client.cancelAll(); });
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHttpClient(options) {
  'use strict';
  var active = new Set();
  var now = options.now || function () { return performance.now(); };
  var getContext = options.context || function () { return { owner: '', key: '' }; };
  var limits = { normal: 30000, transfer: 600000 };

  async function request(input, init, read, policy) {
    policy = policy || {};
    var timeoutMs = policy.timeoutMs == null ? limits[policy.transfer ? 'transfer' : 'normal'] : policy.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > limits.transfer) throw new Error('invalid_request_deadline');
    if (typeof read !== 'function') throw new Error('response_reader_required');
    if (options.validateUrl && !options.validateUrl(input)) throw new Error('invalid_request_url');
    var scope = policy.scope || 'page';
    if (!['page', 'workspace', 'document'].includes(scope)) throw new Error('invalid_request_scope');
    var initial = getContext(scope), controller = new AbortController();
    var method = String(init?.method || input?.method || 'GET').toUpperCase();
    var mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method), sent = false, stopped = null;
    var callerSignal = init?.signal || input?.signal, deadline = now() + timeoutMs;
    var rejectStop, timer, response, phase = 'fetch';
    var stopPromise = new Promise(function (_, reject) { rejectStop = reject; });
    function stop(code) {
      if (stopped) return stopped;
      var uncertain = mutation && sent;
      stopped = new Error(options.message ? options.message(code, uncertain) : 'Request stopped');
      stopped.code = code; stopped.mutationMayHaveCommitted = uncertain;
      controller.abort(); rejectStop(stopped);
      return stopped;
    }
    function check() {
      if (stopped) throw stopped;
      var current;
      try { current = getContext(scope); }
      catch (error) { throw stop(error?.code === 'staff_account_changed' ? error.code : 'request_context_changed'); }
      if (current.owner !== initial.owner) throw stop('staff_account_changed');
      if (current.key !== initial.key) throw stop('request_context_changed');
      if (now() >= deadline) throw stop('request_timeout');
    }
    var task = { check: check, stop: stop };
    var cancelled = function () { stop('request_cancelled'); };
    active.add(task);
    timer = setTimeout(function () { stop('request_timeout'); }, timeoutMs);
    callerSignal?.addEventListener('abort', cancelled, { once: true });
    if (callerSignal?.aborted) cancelled();
    try {
      return await Promise.race([Promise.resolve().then(async function () {
        check(); sent = true;
        response = await options.fetch(input, Object.assign({}, init, { signal: controller.signal, redirect: 'error' }));
        check();
        // Readers only decode/validate. UI/cache mutations belong after request resolves.
        phase = 'read';
        var value = await read(response, controller.signal);
        check(); return value;
      }), stopPromise]);
    } catch (error) {
      if (stopped) throw stopped;
      if (error?.status || error?.code === 'staff_account_changed') throw error;
      if (phase === 'read') {
        var readError = error instanceof Error ? error : new Error('Invalid server response');
        readError.mutationMayHaveCommitted = mutation && sent;
        throw readError;
      }
      var failure = new Error(options.message ? options.message('request_network_error', mutation && sent) : 'Server unavailable');
      failure.code = 'request_network_error'; failure.mutationMayHaveCommitted = mutation && sent;
      throw failure;
    } finally {
      clearTimeout(timer); active.delete(task);
      callerSignal?.removeEventListener('abort', cancelled);
      if (stopped && response?.body && !response.body.locked) {
        Promise.resolve(response.body.cancel()).catch(function () {});
      }
    }
  }

  async function httpError(response) {
    var body = await response.json().catch(function () { return null; });
    var detail = body && (body.error || body.message);
    if (!detail && Array.isArray(body?.errors)) detail = body.errors.map(function (item) { return item.msg || item.message; }).filter(Boolean).join('; ');
    var error = new Error(response.status + (detail ? ' — ' + String(detail).slice(0, 1500) : ' ' + response.statusText));
    error.status = response.status; error.code = typeof body?.code === 'string' ? body.code : null;
    return error;
  }
  function consume(kind) {
    return function (input, init, policy) {
      return request(input, init, async function (response) {
        if (!response.ok) throw await httpError(response);
        if (kind === 'discard') { await response.body?.cancel(); return null; }
        return response.status === 204 ? null : response[kind]();
      }, policy);
    };
  }
  return { request: request, json: consume('json'), blob: consume('blob'), text: consume('text'), discard: consume('discard'),
    httpError: httpError,
    cancelChanged: function () { active.forEach(function (task) { try { task.check(); } catch (_) {} }); },
    cancelAll: function (code) { active.forEach(function (task) { task.stop(code === 'staff_account_changed' ? code : 'request_cancelled'); }); },
    pendingCount: function () { return active.size; } };
});
