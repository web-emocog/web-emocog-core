/* Shared auth guard for protected web pages. */
(function (global) {
  'use strict';

  function getApiBase() {
    var base = global.EmocogApiBase
      ? global.EmocogApiBase.resolve()
      : (global.location.origin + '/api').replace(/\/$/, '');
    global.API_BASE = base;
    return base;
  }

  // Resolve eagerly so scripts loaded after the guard use the same endpoint.
  getApiBase();

  function persistAuthFlag() {
    try {
      sessionStorage.setItem('emocog_developer_auth', '1');
      localStorage.setItem('emocog_developer_auth', '1');
    } catch (_) {}
  }

  function clearAuth() {
    try {
      sessionStorage.removeItem('emocog_developer_auth');
      localStorage.removeItem('emocog_developer_auth');
      localStorage.removeItem('emocog_api_token');
      localStorage.removeItem('emocog_api_user');
      sessionStorage.removeItem('emocog_csrf_token');
    } catch (_) {}
  }

  function redirectToLogin(loginPath) {
    global.location.replace(loginPath || 'developer/login.html');
  }

  function getCachedUser() {
    try {
      var raw = localStorage.getItem('emocog_api_user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchCurrentUser() {
    var apiBase = getApiBase();
    var payload = await global.WecogHttp.json(apiBase + '/auth/me', {
      method: 'GET',
      credentials: 'include'
    }, { scope: 'document', timeoutMs: 15000 });
    var currentUser = payload && (payload.user || payload);
    if (!currentUser || !/^[A-Za-z0-9_-]{1,64}$/.test(String(currentUser.id || '')) || typeof currentUser.role !== 'string') {
      var invalid = new Error('Invalid authentication response'); invalid.code = 'invalid_auth_response'; throw invalid;
    }
    if (global.WecogStaffSession) {
      if (!global.WecogStaffSession.getAccountId() && global.WecogAccountStorage) {
        global.WecogAccountStorage.activate(payload?.user?.id ?? payload?.id);
      }
      global.WecogStaffSession.bind(payload?.user?.id ?? payload?.id);
    }
    if (payload && payload.csrf_token) {
      try {
        sessionStorage.setItem('emocog_csrf_token', payload.csrf_token);
      } catch (_) {}
    }
    if (payload && payload.user) {
      try {
        localStorage.setItem('emocog_api_user', JSON.stringify(payload.user));
      } catch (_) {}
      return payload.user;
    }
    if (payload && payload.id && payload.email) {
      try {
        var safeUser = Object.assign({}, payload);
        delete safeUser.csrf_token;
        localStorage.setItem('emocog_api_user', JSON.stringify(safeUser));
      } catch (_) {}
      return safeUser;
    }
    return null;
  }

  function roleAllowed(user, allowedRoles) {
    if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return true;
    if (!user || !user.role) return false;
    return allowedRoles.indexOf(user.role) >= 0;
  }

  function revealPageAfterAuth() {
    try {
      document.documentElement.style.visibility = '';
      document.documentElement.classList.remove('emocog-auth-pending');
    } catch (_) {}
  }

  function showUnavailable() {
    function show() {
      if (document.getElementById('staffAuthUnavailable')) return;
      var en = document.documentElement.lang === 'en';
      var overlay = document.createElement('div');
      overlay.id = 'staffAuthUnavailable'; overlay.setAttribute('role', 'alert');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:var(--bg,#f5f5ef);color:var(--text,#10211b);display:grid;place-items:center;padding:24px';
      var panel = document.createElement('div'); panel.style.cssText = 'max-width:560px;line-height:1.6';
      var title = document.createElement('h2');
      title.textContent = en ? 'Cannot verify sign-in right now' : 'Сейчас не удалось проверить вход';
      var message = document.createElement('p');
      message.textContent = en ? 'The server is unavailable. Your local sign-in and drafts have not been cleared.'
        : 'Сервер недоступен. Локальное состояние входа и черновики не сброшены.';
      var retry = document.createElement('button'); retry.type = 'button';
      retry.textContent = en ? 'Retry' : 'Повторить';
      retry.addEventListener('click', function () { global.location.reload(); });
      panel.append(title, message, retry); overlay.append(panel);
      Array.from(document.body.children).forEach(function (child) {
        if (child.tagName !== 'SCRIPT') { child.hidden = true; child.inert = true; child.style.setProperty('display', 'none', 'important'); }
      });
      document.body.append(overlay); revealPageAfterAuth(); retry.focus();
    }
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  async function ensureProtectedPage(options) {
    var opts = options || {};
    var loginPath = opts.loginPath || 'developer/login.html';
    var allowed = opts.allowedRoles || null;
    try {
      document.documentElement.classList.add('emocog-auth-pending');
      document.documentElement.style.visibility = 'hidden';
    } catch (_) {}

    var user = getCachedUser();
    try {
      // Local flags are only a UI cache. Access is always revalidated by the
      // HttpOnly staff cookie and current server-side role/token version.
      user = await fetchCurrentUser();
      persistAuthFlag();
    } catch (err) {
      if (err.code === 'staff_account_changed') return { ok: false, accountChanged: true };
      if (err.code === 'request_cancelled') return { ok: false, cancelled: true };
      if (err.status !== 401 && err.status !== 403) {
        showUnavailable();
        return { ok: false, retryable: true };
      }
      clearAuth();
      revealPageAfterAuth();
      redirectToLogin(loginPath);
      return { ok: false };
    }

    if (!roleAllowed(user, allowed)) {
      revealPageAfterAuth();
      if (opts.preserveAuthOnRoleDenied) {
        var fallback = opts.roleDeniedRedirect || 'index.html';
        global.location.replace(fallback);
        return { ok: false, denied: true, user: user || null };
      }
      clearAuth();
      if (opts.onDenied && typeof opts.onDenied === 'function') {
        opts.onDenied(user);
      } else {
        redirectToLogin(loginPath);
      }
      return { ok: false, denied: true, user: user || null };
    }

    revealPageAfterAuth();
    return {
      ok: true,
      token: '',
      user: user || null,
      apiBase: getApiBase()
    };
  }

  global.EmocogAuthGuard = {
    ensureProtectedPage: ensureProtectedPage,
    clearAuth: clearAuth,
    redirectToLogin: redirectToLogin
  };
})(typeof window !== 'undefined' ? window : this);
