/* Bind a protected tab to its staff identity, not a mutable shared cookie. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = { createStaffSession: factory };
  else {
    var session = factory({
      storage: root.localStorage,
      sessionStorage: root.sessionStorage,
      fetch: root.fetch.bind(root),
      apiBase: function () { return root.EmocogApiBase.resolve(); },
      onBlocked: function () {
        var show = function () {
          if (document.getElementById('staffSessionChanged')) return;
          var en = document.documentElement.lang === 'en';
          var dialog = document.createElement('div');
          dialog.id = 'staffSessionChanged';
          dialog.setAttribute('role', 'alertdialog');
          dialog.setAttribute('aria-modal', 'true');
          dialog.setAttribute('aria-labelledby', 'staffSessionChangedTitle');
          dialog.tabIndex = -1;
          dialog.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--bg,#f5f5ef);color:var(--text,#10211b);display:grid;place-items:center;padding:24px;';
          var panel = document.createElement('div');
          panel.style.cssText = 'max-width:560px;line-height:1.6;';
          var title = document.createElement('h2');
          title.id = 'staffSessionChangedTitle';
          title.textContent = en ? 'Account changed in another tab' : 'Аккаунт изменился в другой вкладке';
          var message = document.createElement('p');
          message.textContent = en
            ? 'This tab is locked to prevent changes under another account. Reload to open the current account. Use separate browser profiles for two accounts at once.'
            : 'Эта вкладка заблокирована, чтобы не выполнять действия от другого аккаунта. Обновите страницу для текущего аккаунта. Для двух аккаунтов одновременно используйте отдельные профили браузера.';
          var button = document.createElement('button');
          button.type = 'button';
          button.textContent = en ? 'Reload page' : 'Обновить страницу';
          button.addEventListener('click', function () { root.location.reload(); });
          panel.append(title, message, button);
          dialog.append(panel);
          Array.from(document.body.children).forEach(function (child) {
            if (child.tagName !== 'SCRIPT') {
              child.inert = true;
              child.hidden = true;
              child.setAttribute('aria-hidden', 'true');
              child.style.setProperty('display', 'none', 'important');
            }
          });
          document.body.append(dialog);
          document.documentElement.style.visibility = '';
          document.documentElement.classList.remove('emocog-auth-pending');
          button.focus();
          root.dispatchEvent(new Event('wecog:staffsessionblocked'));
        };
        if (document.body) show();
        else document.addEventListener('DOMContentLoaded', show, { once: true });
      }
    });
    root.WecogStaffSession = session;
    root.fetch = session.fetch;
    var storagePrototype = Object.getPrototypeOf(root.localStorage);
    ['getItem', 'setItem', 'removeItem'].forEach(function (method) {
      var original = storagePrototype[method];
      storagePrototype[method] = function (key) {
        if (this === root.localStorage && root.WecogAccountStorage.isWorkspaceKey(String(key))) {
          session.assertCurrent();
        }
        return original.apply(this, arguments);
      };
    });
    root.addEventListener('storage', function (event) {
      if (event.key === null || event.key === 'emocog_workspace_owner_v1' || event.key === 'emocog_api_user') {
        try { session.assertCurrent(); } catch (_) {}
      }
    });
    ['click', 'input', 'change', 'submit', 'keydown', 'drop'].forEach(function (type) {
      document.addEventListener(type, function (event) {
        if (event.target.closest?.('#staffSessionChanged')) return;
        try { session.assertCurrent(); }
        catch (_) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStaffSession(options) {
  'use strict';
  var storage = options.storage;
  var tabStorage = options.sessionStorage;
  var nativeFetch = options.fetch;
  var ownerKey = 'emocog_workspace_owner_v1';
  var accountId = storage.getItem(ownerKey) || '';
  var blocked = false;
  var csrfRefresh = null;

  function accountChanged() {
    if (!blocked) {
      blocked = true;
      options.onBlocked?.();
    }
    var error = new Error('Staff account changed; reload this tab before continuing');
    error.code = 'staff_account_changed';
    return error;
  }

  function assertCurrent() {
    if (blocked) throw accountChanged();
    if (accountId && storage.getItem(ownerKey) !== accountId) throw accountChanged();
  }

  function bind(userId) {
    var id = String(userId == null ? '' : userId);
    if (!id || (accountId && accountId !== id)) throw accountChanged();
    accountId = id;
    assertCurrent();
  }

  function currentApiBase() {
    return String(typeof options.apiBase === 'function' ? options.apiBase() : options.apiBase).replace(/\/$/, '');
  }

  async function refreshCsrf() {
    if (csrfRefresh) return csrfRefresh;
    csrfRefresh = (async function () {
      assertCurrent();
      var response = await nativeFetch(currentApiBase() + '/auth/me', {
        credentials: 'include', headers: { 'X-Staff-User-ID': accountId }
      });
      if (!response.ok) throw accountChanged();
      var payload = await response.json();
      assertCurrent();
      if (String(payload.user?.id ?? payload.id) !== accountId || !payload.csrf_token) throw accountChanged();
      tabStorage.setItem('emocog_csrf_token', payload.csrf_token);
      return payload.csrf_token;
    })();
    try { return await csrfRefresh; }
    finally { csrfRefresh = null; }
  }

  async function sessionFetch(input, init) {
    var url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    var base = currentApiBase();
    if (!accountId || !(url === base || url.startsWith(base + '/'))) return nativeFetch(input, init);
    assertCurrent();
    var request = new Request(input, init);
    var headers = new Headers(request.headers);
    headers.set('X-Staff-User-ID', accountId);
    var first = new Request(request, { headers });
    // Keep an unread body only for a CSRF rejection issued before any route runs.
    var retry = first.clone();
    var response = await nativeFetch(first);
    assertCurrent();
    if (response.status === 409) {
      var conflict = await response.clone().json().catch(function () { return {}; });
      if (conflict.code === 'staff_account_changed') throw accountChanged();
    }
    if (response.status === 403 && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      var failure = await response.clone().json().catch(function () { return {}; });
      if (failure.code === 'csrf_token_invalid') {
        headers.set('X-CSRF-Token', await refreshCsrf());
        assertCurrent();
        response = await nativeFetch(new Request(retry, { headers }));
        assertCurrent();
        if (response.status === 409) {
          var retryFailure = await response.clone().json().catch(function () { return {}; });
          if (retryFailure.code === 'staff_account_changed') throw accountChanged();
        }
      }
    }
    return response;
  }

  return { fetch: sessionFetch, bind: bind, assertCurrent: assertCurrent,
    getAccountId: function () { return accountId; } };
});
