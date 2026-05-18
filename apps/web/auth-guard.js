/* Shared auth guard for protected web pages. */
(function (global) {
  'use strict';

  function getApiBase() {
    var fromStorage = null;
    try {
      fromStorage = localStorage.getItem('emocog_api_base');
    } catch (_) {}
    if (fromStorage && fromStorage.trim()) return fromStorage.trim().replace(/\/$/, '');
    return (global.location.origin + '/api').replace(/\/$/, '');
  }

  function hasLocalAuth() {
    try {
      return (
        sessionStorage.getItem('emocog_developer_auth') === '1' ||
        localStorage.getItem('emocog_developer_auth') === '1' ||
        !!localStorage.getItem('emocog_api_token')
      );
    } catch (_) {
      return false;
    }
  }

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
    } catch (_) {}
  }

  function redirectToLogin(loginPath) {
    global.location.replace(loginPath || 'developer/login.html');
  }

  function getToken() {
    try {
      return localStorage.getItem('emocog_api_token') || '';
    } catch (_) {
      return '';
    }
  }

  function getCachedUser() {
    try {
      var raw = localStorage.getItem('emocog_api_user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchCurrentUser(token) {
    if (!token) return null;
    var apiBase = getApiBase();
    var response = await fetch(apiBase + '/auth/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!response.ok) {
      var e = new Error('Auth check failed: ' + response.status);
      e.status = response.status;
      throw e;
    }
    var payload = await response.json();
    if (payload && payload.user) {
      try {
        localStorage.setItem('emocog_api_user', JSON.stringify(payload.user));
      } catch (_) {}
      return payload.user;
    }
    if (payload && payload.id && payload.email) {
      try {
        localStorage.setItem('emocog_api_user', JSON.stringify(payload));
      } catch (_) {}
      return payload;
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

  async function ensureProtectedPage(options) {
    var opts = options || {};
    var loginPath = opts.loginPath || 'developer/login.html';
    var allowed = opts.allowedRoles || null;
    var needsRoleGate = Array.isArray(allowed) && allowed.length > 0;
    var tokenOptional = opts.tokenOptional === true;

    if (needsRoleGate && !tokenOptional) {
      try {
        document.documentElement.classList.add('emocog-auth-pending');
        document.documentElement.style.visibility = 'hidden';
      } catch (_) {}
    }

    if (!hasLocalAuth()) {
      revealPageAfterAuth();
      redirectToLogin(loginPath);
      return { ok: false };
    }

    persistAuthFlag();
    var token = getToken();
    var user = getCachedUser();

    if (needsRoleGate && !tokenOptional && !token) {
      clearAuth();
      revealPageAfterAuth();
      redirectToLogin(loginPath);
      return { ok: false };
    }

    if (token) {
      try {
        user = await fetchCurrentUser(token);
      } catch (err) {
        // Сеть/API временно недоступны — не сбрасываем сессию при перезагрузке
        var status = err && err.status;
        var isUnauthorized = status === 401 || status === 403;
        if (!isUnauthorized && user && user.email) {
          revealPageAfterAuth();
          return {
            ok: true,
            token: token || '',
            user: user || null,
            apiBase: getApiBase()
          };
        }
        if (!isUnauthorized && !user) {
          revealPageAfterAuth();
          return {
            ok: true,
            token: token || '',
            user: null,
            apiBase: getApiBase()
          };
        }
        clearAuth();
        revealPageAfterAuth();
        redirectToLogin(loginPath);
        return { ok: false };
      }
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
      token: token || '',
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
