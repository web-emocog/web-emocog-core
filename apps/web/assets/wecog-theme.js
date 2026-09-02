(function () {
  'use strict';

  var STORAGE_KEY = 'wecog_theme';
  var MODES = ['auto', 'light', 'dark'];
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function readMode() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (MODES.indexOf(saved) >= 0) return saved;
      // Preserve the previous product setting during migration.
      var legacy = localStorage.getItem('emocog_theme');
      return legacy === 'light' || legacy === 'dark' ? legacy : 'auto';
    } catch (_) {
      return 'auto';
    }
  }

  function resolvedTheme(mode) {
    if (mode === 'auto') return media && media.matches ? 'dark' : 'light';
    return mode;
  }

  function buttonLabel(mode) {
    var lang = document.documentElement.lang === 'en' ? 'en' : 'ru';
    var labels = {
      ru: { auto: 'Тема: авто', light: 'Тема: светлая', dark: 'Тема: тёмная' },
      en: { auto: 'Theme: auto', light: 'Theme: light', dark: 'Theme: dark' }
    };
    return labels[lang][mode];
  }

  function modeLabel(mode) {
    var lang = document.documentElement.lang === 'en' ? 'en' : 'ru';
    var labels = {
      ru: { auto: 'Авто', light: 'Светлая', dark: 'Тёмная' },
      en: { auto: 'Auto', light: 'Light', dark: 'Dark' }
    };
    return labels[lang][mode];
  }

  function icon(mode) {
    return mode === 'dark' ? '●' : mode === 'light' ? '○' : '◐';
  }

  function renderButtons(mode) {
    document.querySelectorAll('[data-wecog-theme-toggle]').forEach(function (button) {
      var label = buttonLabel(mode);
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('data-theme-mode', mode);
      var iconNode = button.querySelector('[data-theme-icon]');
      var labelNode = button.querySelector('[data-theme-label]');
      if (iconNode) iconNode.textContent = icon(mode);
      else button.textContent = icon(mode);
      if (labelNode) labelNode.textContent = label.replace(/^.*?:\s*/, '');
    });
    document.querySelectorAll('[data-wecog-theme-value]').forEach(function (button) {
      var value = button.getAttribute('data-wecog-theme-value');
      var active = value === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('title', buttonLabel(value));
      var labelNode = button.querySelector('[data-theme-option-label]');
      if (labelNode) labelNode.textContent = modeLabel(value);
    });
    document.querySelectorAll('[data-wecog-theme-group]').forEach(function (group) {
      group.setAttribute('aria-label', document.documentElement.lang === 'en' ? 'Color scheme' : 'Цветовая схема');
    });
  }

  function apply(mode, persist) {
    var safeMode = MODES.indexOf(mode) >= 0 ? mode : 'auto';
    document.documentElement.dataset.theme = resolvedTheme(safeMode);
    document.documentElement.dataset.themeMode = safeMode;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, safeMode); } catch (_) {}
    }
    renderButtons(safeMode);
  }

  function cycle() {
    var current = document.documentElement.dataset.themeMode || readMode();
    apply(MODES[(MODES.indexOf(current) + 1) % MODES.length], true);
  }

  apply(readMode(), false);
  document.addEventListener('DOMContentLoaded', function () {
    renderButtons(document.documentElement.dataset.themeMode || readMode());
    document.querySelectorAll('[data-wecog-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', cycle);
    });
    document.querySelectorAll('[data-wecog-theme-value]').forEach(function (button) {
      button.addEventListener('click', function () {
        apply(button.getAttribute('data-wecog-theme-value'), true);
      });
    });
  });
  window.addEventListener('wecog:languagechange', function () {
    renderButtons(document.documentElement.dataset.themeMode || readMode());
  });
  if (media) {
    media.addEventListener('change', function () {
      if ((document.documentElement.dataset.themeMode || readMode()) === 'auto') apply('auto', false);
    });
  }

  window.WecogTheme = {
    apply: apply,
    cycle: cycle,
    mode: function () { return document.documentElement.dataset.themeMode || readMode(); }
  };
})();
