(function () {
  'use strict';
  var scriptUrl = document.currentScript && document.currentScript.src;
  if (!scriptUrl) return;
  var assets = new URL('.', scriptUrl);
  var webRoot = new URL('../', scriptUrl);

  function readRole() {
    try { return JSON.parse(localStorage.getItem('emocog_api_user') || 'null')?.role || null; }
    catch (_) { return null; }
  }

  function pageUrl(path) { return new URL(path, webRoot).href; }

  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('.developer-shell')) return;
    var loginPage = /\/developer\/login\.html$/.test(location.pathname);
    var role = readRole();
    var links = loginPage ? [] : [
      ['developer.html', 'Модули'],
      ...(role === 'admin' ? [
        ['developer/invite.html', 'Приглашения'],
        ['developer/experiments.html', 'Сессии'],
        ['developer/accounts.html', 'Доступы'],
        ['researcher.html', 'Кабинет исследователя']
      ] : [])
    ];
    var header = document.createElement('header');
    header.className = 'developer-shell';
    header.innerHTML =
      '<a class="developer-shell__brand" href="' + pageUrl('developer.html') + '">' +
        '<img src="' + new URL('wecog-mark.svg', assets).href + '" alt=""><span>wecog</span>' +
      '</a>' +
      '<span class="developer-shell__badge">developer</span>' +
      '<nav aria-label="Навигация разработчика"></nav>' +
      '<span class="developer-shell__spacer"></span>' +
      '<button type="button" class="developer-theme-toggle" data-wecog-theme-toggle aria-label="Изменить тему"><span data-theme-icon aria-hidden="true">◐</span></button>';
    var nav = header.querySelector('nav');
    links.forEach(function (entry) {
      var link = document.createElement('a');
      link.href = pageUrl(entry[0]);
      link.textContent = entry[1];
      var targetPath = new URL(link.href).pathname;
      if (location.pathname === targetPath) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    });
    header.querySelector('.developer-theme-toggle').addEventListener('click', function () {
      if (window.WecogTheme) window.WecogTheme.cycle();
    });
    document.body.insertBefore(header, document.body.firstChild);
  });
})();
