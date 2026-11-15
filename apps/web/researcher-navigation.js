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
    { href: '#/sessions', ru: 'Записи участников', en: 'Participant recordings', hintRu: 'Список сессий', hintEn: 'Session list' },
    { href: '#/settings', ru: 'Настройки', en: 'Settings', hintRu: 'Профиль безопасность смена пароля почта', hintEn: 'Profile security change password email' },
    { href: '#/admin', ru: 'Доступы', en: 'Access', hintRu: 'Роли пользователи организации', hintEn: 'Roles users organizations', guard: '#nav-admin' }
  ];
  const TOPICS = [
    ['#/analytics/session-card', 'Время реакции и стимулы', 'Reaction time and stimuli', 'пульс чсс дыхание мимика голос аудио моргания', 'pulse heart rate breathing expression voice audio blink'],
    ['#/analytics/session-card', 'Тепловые карты взгляда', 'Gaze heatmaps', 'зоны интереса фиксации aoi', 'areas of interest fixations aoi'],
    ['#/analytics/group-comparison', 'Распределения и сравнения', 'Distributions and comparisons', 'гистограммы таблица пар кластеры', 'histograms pair table clusters'],
    ['#/analytics/session-card', 'Скачать отчёт', 'Download report', 'экспорт pdf csv json', 'export pdf csv json'],
    ['#/stimuli/upload', 'Загрузка стимулов', 'Upload stimuli', 'изображения видео аудио слайды', 'images video audio slides']
  ];
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase(language()).replace(/ё/g, 'е').trim();

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
      search.placeholder = en ? 'Search workspace' : 'Поиск по кабинету';
      search.setAttribute('aria-label', search.placeholder);
      var toggle = document.getElementById('researcherSearchToggle');
      if (toggle) {
        toggle.querySelector('span').textContent = search.placeholder;
        toggle.setAttribute('aria-label', search.placeholder);
      }
    }
    if (window.WecogTheme) window.WecogTheme.apply(document.documentElement.dataset.themeMode || 'auto', false);
  }

  function initSearch() {
    var input = document.getElementById('researcherNavSearch');
    var host = input && input.closest('.search-box');
    var toggle = document.getElementById('researcherSearchToggle');
    var panel = document.getElementById('researcherSearchPanel');
    if (!input || !host || !toggle || !panel) return;
    input.value = '';
    var results = document.createElement('div');
    results.className = 'wecog-search-results';
    results.id = 'researcherSearchResults';
    results.setAttribute('role', 'listbox');
    results.hidden = true;
    panel.appendChild(results);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', results.id);
    input.setAttribute('aria-expanded', 'false');
    var activeIndex = -1;

    function close(restoreFocus) {
      const wasOpen = !panel.hidden;
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
      if (restoreFocus && wasOpen) toggle.focus({ preventScroll: true });
    }

    function render() {
      var query = normalize(input.value);
      var en = language() === 'en';
      const terms = query ? query.split(/\s+/) : [];
      const catalog = ROUTES.filter(item => !item.guard || document.querySelector(item.guard)?.getClientRects().length)
        .map(item => ({ ...item, label: en ? item.en : item.ru }));
      if (query) {
        TOPICS.forEach(([href, ru, enName, hintRu, hintEn]) => catalog.push({ href, label: en ? enName : ru, ru, en: enName, hintRu, hintEn }));
        // Index headings already present in the current workspace, not response bodies or form values.
        document.querySelectorAll('#view h2, #view h3, #view h4, #view summary').forEach(node => {
          if (node.closest('[hidden],[aria-hidden="true"],[inert],dialog:not([open])')) return;
          const label = node.textContent.replace(/\s+/g, ' ').trim();
          if (label && label.length <= 100) catalog.push({ label, node });
        });
      }
      const seen = new Set();
      const filtered = catalog.filter(item => terms.every(term =>
        normalize([item.label, item.ru, item.en, item.hintRu, item.hintEn].filter(Boolean).join(' ')).includes(term)))
        .sort((a,b) => Number(normalize(b.label) === query) - Number(normalize(a.label) === query))
        .filter(item => { const key = normalize(item.label); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 25);
      results.textContent = '';
      filtered.forEach(function (item, index) {
        var link = document.createElement(item.node ? 'button' : 'a');
        if (item.node) link.type = 'button'; else link.href = item.href;
        link.setAttribute('role', 'option');
        link.id = 'researcherSearchOption' + index;
        link.setAttribute('tabindex', '-1');
        link.textContent = item.label;
        link.addEventListener('click', function () {
          input.value = ''; close(!item.node);
          if (item.node?.isConnected) {
            for (let parent = item.node.parentElement; parent; parent = parent.parentElement) {
              if (parent.tagName === 'DETAILS') parent.open = true;
            }
            if (!item.node.matches('summary, [tabindex]')) item.node.tabIndex = -1;
            item.node.focus({ preventScroll: true });
            item.node.scrollIntoView({ block: 'start' });
          }
        });
        results.appendChild(link);
      });
      if (!filtered.length) {
        const message = document.createElement('p');
        message.textContent = en ? 'Nothing found' : 'Ничего не найдено';
        results.appendChild(message);
      }
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
    }

    toggle.addEventListener('click', function () {
      if (!panel.hidden) { close(true); return; }
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      render();
      input.focus({ preventScroll: true });
    });
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (event) {
      if (event.isComposing) return;
      var links = results.querySelectorAll('[role="option"]');
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (!links.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = event.key === 'ArrowDown'
          ? (activeIndex + 1) % links.length
          : (activeIndex < 0 ? links.length - 1 : (activeIndex - 1 + links.length) % links.length);
        links.forEach(function (link, index) { link.setAttribute('aria-selected', String(index === activeIndex)); });
        input.setAttribute('aria-activedescendant', links[activeIndex].id);
        links[activeIndex].scrollIntoView({ block: 'nearest' });
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        var target = links[activeIndex >= 0 ? activeIndex : 0];
        if (target) target.click();
      }
    });
    document.addEventListener('click', function (event) {
      if (!host.contains(event.target)) close(false);
    });
    window.addEventListener('hashchange', () => close(false));
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
