(function () {
  'use strict';

  var ROUTES = [
    { href: '#/overview', ru: 'Главная', en: 'Overview', hintRu: 'Сводка проекта', hintEn: 'Project summary' },
    { href: '#/experiments', ru: 'Исследования', en: 'Studies', hintRu: 'Протоколы и запуск', hintEn: 'Protocols and launch' },
    { href: '#/experiments/builder', ru: 'Новый протокол', en: 'New protocol', hintRu: 'Создать сценарий исследования', hintEn: 'Create a study flow' },
    { href: '#/stimuli', ru: 'Библиотека', en: 'Library', hintRu: 'Стимулы и зоны интереса', hintEn: 'Stimuli and AOIs' },
    { href: '#/analytics/session-card', ru: 'Аналитика', en: 'Analytics', hintRu: 'Сессии и группы', hintEn: 'Sessions and groups' },
    { href: '#/analytics/group-comparison', ru: 'Сравнение групп', en: 'Group comparison', hintRu: 'Сопоставить выборки', hintEn: 'Compare cohorts' },
    { href: '#/analytics/data-quality', ru: 'Качество данных', en: 'Data quality', hintRu: 'Проверить полноту и QC', hintEn: 'Review completeness and QC' },
    { href: '#/analytics/connectedness', ru: 'Связанность', en: 'Connectedness', hintRu: 'Сопоставить сигналы', hintEn: 'Compare signals' },
    { href: '#/settings', ru: 'Настройки', en: 'Settings', hintRu: 'Профиль и безопасность', hintEn: 'Profile and security' }
  ];

  function language() {
    return document.documentElement.lang === 'en' ? 'en' : 'ru';
  }

  function updateStaticLabels() {
    var en = language() === 'en';
    var labels = {
      'nav-overview': en ? 'Overview' : 'Главная',
      'nav-experiments': en ? 'Studies' : 'Исследования',
      'nav-stimuli': en ? 'Library' : 'Библиотека',
      'nav-analytics-session-card': en ? 'Analytics' : 'Аналитика',
      'nav-admin': en ? 'Access' : 'Доступы',
      'nav-settings': en ? 'Settings' : 'Настройки'
    };
    Object.keys(labels).forEach(function (id) {
      var link = document.getElementById(id);
      var target = link && link.querySelector('span:last-child');
      if (target) target.textContent = labels[id];
    });
    var section = document.getElementById('navSectionTitle');
    if (section) section.textContent = en ? 'Workspace' : 'Работа';
    var management = document.getElementById('navManagementTitle');
    if (management) management.textContent = en ? 'Management' : 'Управление';
    var managementNav = document.querySelector('.nav-secondary');
    if (managementNav) managementNav.setAttribute('aria-label', en ? 'Workspace management' : 'Управление кабинетом');
    var projectContext = document.getElementById('projectContextTitle');
    if (projectContext) projectContext.textContent = en ? 'Current project' : 'Текущий проект';
    var createProtocol = document.getElementById('navCreateProtocolLabel');
    if (createProtocol) createProtocol.textContent = en ? 'New protocol' : 'Новый протокол';
    var brand = document.querySelector('a.brand');
    if (brand) brand.setAttribute('aria-label', en ? 'wecog, overview' : 'wecog, главная');
    var breadcrumbs = document.getElementById('breadcrumbs');
    if (breadcrumbs) breadcrumbs.setAttribute('aria-label', en ? 'Breadcrumbs' : 'Хлебные крошки');
    var breadcrumbHome = document.getElementById('breadcrumbHome');
    if (breadcrumbHome) breadcrumbHome.textContent = en ? 'Overview' : 'Главная';
    var mobileToggle = document.getElementById('mobileNavToggle');
    if (mobileToggle) mobileToggle.setAttribute('aria-label', en ? 'Open navigation' : 'Открыть навигацию');
    var sidebarToggle = document.getElementById('btnToggleSidebar');
    if (sidebarToggle) sidebarToggle.setAttribute('title', en ? 'Toggle sidebar' : 'Свернуть боковую панель');
    var back = document.getElementById('btnBack');
    if (back) back.setAttribute('title', en ? 'Back' : 'Назад');
    var forward = document.getElementById('btnForward');
    if (forward) forward.setAttribute('title', en ? 'Forward' : 'Вперёд');
    var focus = document.getElementById('btnFocus');
    if (focus) focus.setAttribute('title', en ? 'Focus mode' : 'Режим фокуса');
    var search = document.getElementById('researcherNavSearch');
    if (search) {
      search.placeholder = en ? 'Find a section' : 'Найти раздел';
      search.setAttribute('aria-label', search.placeholder);
    }
    if (window.WecogTheme) window.WecogTheme.apply(document.documentElement.dataset.themeMode || 'auto', false);
  }

  function initSearch() {
    var input = document.getElementById('researcherNavSearch');
    var host = input && input.closest('.search-box');
    if (!input || !host) return;
    var results = document.createElement('div');
    results.className = 'wecog-search-results';
    results.id = 'researcherSearchResults';
    results.setAttribute('role', 'listbox');
    results.hidden = true;
    host.appendChild(results);
    input.setAttribute('aria-controls', results.id);
    input.setAttribute('aria-expanded', 'false');
    var activeIndex = -1;

    function close() {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    function render() {
      var query = input.value.trim().toLocaleLowerCase(language());
      if (!query) { close(); return; }
      var en = language() === 'en';
      var filtered = ROUTES.filter(function (item) {
        return [item.ru, item.en, item.hintRu, item.hintEn].join(' ').toLocaleLowerCase().indexOf(query) >= 0;
      });
      results.textContent = '';
      filtered.forEach(function (item) {
        var link = document.createElement('a');
        link.href = item.href;
        link.setAttribute('role', 'option');
        link.innerHTML = '<span>' + (en ? item.en : item.ru) + '</span><small>' + (en ? item.hintEn : item.hintRu) + '</small>';
        link.addEventListener('click', function () { input.value = ''; close(); });
        results.appendChild(link);
      });
      results.hidden = filtered.length === 0;
      input.setAttribute('aria-expanded', filtered.length ? 'true' : 'false');
      activeIndex = -1;
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', function (event) {
      var links = results.querySelectorAll('a');
      if (event.key === 'Escape') { close(); input.blur(); return; }
      if (!links.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = event.key === 'ArrowDown'
          ? (activeIndex + 1) % links.length
          : (activeIndex - 1 + links.length) % links.length;
        links.forEach(function (link, index) { link.setAttribute('aria-selected', String(index === activeIndex)); });
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        var target = links[activeIndex >= 0 ? activeIndex : 0];
        if (target) target.click();
      }
    });
    document.addEventListener('click', function (event) {
      if (!host.contains(event.target)) close();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    updateStaticLabels();
    initSearch();
    document.querySelectorAll('#langRu, #langEn, #wsLangRu, #wsLangEn').forEach(function (button) {
      button.addEventListener('click', function () { setTimeout(updateStaticLabels, 0); });
    });
  });
  window.addEventListener('wecog:languagechange', updateStaticLabels);
})();
