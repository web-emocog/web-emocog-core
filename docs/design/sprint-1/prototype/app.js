"use strict";

const app = document.getElementById("app");

const routeMeta = {
  "/overview": { id: "R1", label: "Главная", group: "main" },
  "/projects": { id: "R2", label: "Проекты", group: "main" },
  "/project/new": { id: "R3", label: "Новый проект", group: "main" },
  "/project/overview": { id: "R4", label: "Обзор проекта", group: "project" },
  "/project/protocols": { id: "R5", label: "Протоколы", group: "project" },
  "/builder": { id: "R6", label: "Конструктор", group: "project" },
  "/project/participants": { id: "R7", label: "Участники", group: "project" },
  "/project/monitoring": { id: "R8", label: "Мониторинг", group: "project" },
  "/project/results": { id: "R9", label: "Результаты", group: "project" },
  "/session": { id: "R10", label: "Сессия P-1042", group: "project" },
  "/settings": { id: "R11", label: "Настройки", group: "main" },
  "/library/stimuli": { id: "R12", label: "Стимулы", group: "library" },
  "/library/templates": { id: "R13", label: "Шаблоны", group: "library" },
  "/billing": { id: "R14", label: "Тариф и оплата", group: "main" },
  "/states": { id: "SYS", label: "Системные состояния", group: "main" }
};

const participantSteps = [
  "/participant/invite",
  "/participant/consent",
  "/participant/device",
  "/participant/calibration",
  "/participant/instruction",
  "/participant/task",
  "/participant/final"
];

function normalizeRoute() {
  const raw = window.location.hash.replace(/^#/, "") || "/overview";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function go(route) {
  window.location.hash = route;
}

function badge(text, tone = "neutral") {
  return `<span class="badge badge-${tone}">${text}</span>`;
}

function button(label, route, kind = "") {
  return `<button class="button ${kind}" type="button" data-go="${route}">${label}</button>`;
}

function pageHead(id, title, lead, actions = "") {
  return `
    <header class="page-head">
      <div>
        <p class="page-kicker">${id} · Web EmoCog</p>
        <h1 class="page-title">${title}</h1>
        <p class="page-lead">${lead}</p>
      </div>
      ${actions ? `<div class="head-actions">${actions}</div>` : ""}
    </header>`;
}

function metric(label, value, meta = "") {
  return `
    <section class="card metric">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      ${meta ? `<div class="metric-meta">${meta}</div>` : ""}
    </section>`;
}

function callout(title, text, tone = "") {
  return `
    <div class="callout ${tone ? `callout-${tone}` : ""}">
      <div class="callout-content">
        <p class="callout-title">${title}</p>
        <p class="callout-text">${text}</p>
      </div>
    </div>`;
}

function chart(label, values = [24, 42, 37, 63, 58, 79, 68, 84, 77]) {
  const width = 560;
  const height = 150;
  const max = Math.max(...values, 100);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `
    <div class="chart" role="img" aria-label="${label}. Значения: ${values.join(", ")}">
      <div class="chart-label">${label}</div>
      <div class="chart-line">
        <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
          <polyline points="${points}" fill="none" stroke="#0e6e71" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
          ${values
            .map((value, index) => {
              const x = (index / (values.length - 1)) * width;
              const y = height - (value / max) * height;
              return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#ffffff" stroke="#0e6e71" stroke-width="3"></circle>`;
            })
            .join("")}
        </svg>
      </div>
    </div>`;
}

function projectTabs(active) {
  const tabs = [
    ["/project/overview", "Обзор"],
    ["/project/protocols", "Протоколы"],
    ["/project/participants", "Участники"],
    ["/project/monitoring", "Мониторинг"],
    ["/project/results", "Результаты"],
    ["/settings", "Настройки"]
  ];
  return `
    <nav class="tabs" aria-label="Разделы проекта">
      ${tabs
        .map(
          ([route, label]) =>
            `<a class="tab" href="#${route}" ${active === route ? 'aria-current="page"' : ""}>${label}</a>`
        )
        .join("")}
    </nav>`;
}

function shell(content, route) {
  const current = routeMeta[route] || routeMeta["/overview"];
  const navGroup = (label, links) => `
    <div class="nav-group">
      <p class="nav-label">${label}</p>
      ${links
        .map(([href, title, count]) => {
          const active = href === route || (href === "/projects" && current.group === "project");
          return `
            <a class="nav-link" href="#${href}" ${active ? 'aria-current="page"' : ""}>
              <span class="nav-dot" aria-hidden="true"></span>
              <span>${title}</span>
              ${count ? `<span class="nav-count">${count}</span>` : ""}
            </a>`;
        })
        .join("")}
    </div>`;

  return `
    <div class="app-shell">
      <header class="topbar">
        <button class="button button-quiet menu-toggle" type="button" data-action="toggle-nav" aria-label="Открыть навигацию">Меню</button>
        <a class="brand" href="#/overview" aria-label="Web EmoCog, главная">
          <span class="brand-mark" aria-hidden="true"></span>
          <span>Web EmoCog</span>
        </a>
        <div class="topbar-context">
          <strong>${current.id}</strong> · ${current.label}
          ${current.group === "project" ? " · Проект WEC-014" : ""}
        </div>
        <div class="topbar-actions">
          <button class="button button-quiet" type="button" data-go="/states">Состояния</button>
          <button class="button" type="button" data-toast="Раздел справки будет связан с контекстом текущего экрана.">Справка</button>
          <button class="avatar" type="button" aria-label="Профиль Валерии">ВФ</button>
        </div>
      </header>
      <div class="shell-body">
        <aside class="sidebar" aria-label="Основная навигация">
          ${navGroup("Кабинет", [
            ["/overview", "Главная"],
            ["/projects", "Проекты", "3"]
          ])}
          ${navGroup("Библиотека", [
            ["/library/stimuli", "Стимулы", "48"],
            ["/library/templates", "Шаблоны", "6"]
          ])}
          ${navGroup("Управление", [
            ["/billing", "Тариф и оплата"],
            ["/settings", "Профиль и команда"],
            ["/states", "Системные состояния"]
          ])}
          <div class="sidebar-note">
            <strong>Design prototype</strong>
            Здесь зафиксированы переходы и состояния. Production UI не изменяется.
          </div>
        </aside>
        <main class="main" id="main" tabindex="-1">${content}</main>
      </div>
    </div>
    <div class="prototype-tag">S1-04 · UX/UI prototype</div>`;
}

function overviewView() {
  const sessions = [
    ["P-1042", "Шрифтовые пары", "Основной · v3", "14:12", "0.91", badge("валидна", "success"), "12 мин назад"],
    ["P-1041", "Шрифтовые пары", "Основной · v3", "13:45", "0.42", badge("отклонена QC", "danger"), "40 мин назад"],
    ["P-1040", "Шрифтовые пары", "Основной · v3", "03:02", "—", badge("прервана", "warning"), "1 ч назад"],
    ["P-1039", "UI-паттерны", "Финальный · v5", "11:58", "0.88", badge("валидна", "success"), "2 ч назад"]
  ];
  return `
    <div class="page">
      ${pageHead(
        "R1",
        "Главная",
        "Короткая сводка по проектам, качеству данных и действиям, которые требуют внимания.",
        `${button("Загрузить стимулы", "/library/stimuli")}${button("+ Новый проект", "/project/new", "button-primary")}`
      )}
      <section class="grid grid-4" aria-label="Ключевые показатели">
        ${metric("Активные проекты", "3", "1 собирает данные")}
        ${metric("Сессий за 7 дней", "128", "+18% к прошлой неделе")}
        ${metric("Средний qc_score", "0.83", "шкала 0-1")}
        ${metric("Завершаемость", "74%", "95 из 128 сессий")}
      </section>
      <section class="grid grid-2" style="margin-top:14px">
        <article class="card card-pad">
          <h2 class="card-title">Активные проекты</h2>
          <p class="card-subtitle">Статус сбора без перехода в глубину проекта.</p>
          <ul class="list" style="margin-top:14px">
            <li class="list-row">
              <div class="list-main">
                <p class="list-title">Эмоциональные реакции на шрифтовые пары</p>
                <p class="list-meta">141 / 200 · qc 0.83</p>
                <div class="progress" style="margin-top:8px"><span style="--value:70%"></span></div>
              </div>
              ${badge("сбор данных", "success")}
            </li>
            <li class="list-row">
              <div class="list-main">
                <p class="list-title">Внимание при чтении новостей</p>
                <p class="list-meta">Протокол ещё не опубликован</p>
              </div>
              ${badge("черновик", "neutral")}
            </li>
            <li class="list-row">
              <div class="list-main">
                <p class="list-title">Когнитивная нагрузка UI-паттернов</p>
                <p class="list-meta">212 / 200 · сбор завершён</p>
              </div>
              ${badge("анализ", "info")}
            </li>
          </ul>
        </article>
        <article class="card card-pad">
          <h2 class="card-title">Требует внимания</h2>
          <p class="card-subtitle">Показываем причину и прямое действие.</p>
          <div class="grid" style="margin-top:14px">
            ${callout("qc_score упал до 0.61 за сутки", "Проект «Шрифтовые пары» · Открыть мониторинг", "danger")}
            ${callout("Протокол в черновике 12 дней", "Проверьте блоки и запустите предпросмотр.")}
            ${callout("Использовано 87% лимита сессий", "Тариф Free · Посмотреть лимиты.", "warning")}
          </div>
        </article>
      </section>
      <section class="table-wrap" style="margin-top:14px">
        <table class="data-table">
          <caption>Последние сессии</caption>
          <thead><tr><th>Код</th><th>Проект</th><th>Протокол</th><th>Длит.</th><th>QC</th><th>Статус</th><th>Когда</th></tr></thead>
          <tbody>
            ${sessions
              .map(
                row => `<tr data-go="/session" tabindex="0" aria-label="Открыть сессию ${row[0]}">
                  <td class="mono">${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td>
                  <td class="mono">${row[3]}</td><td class="mono">${row[4]}</td><td>${row[5]}</td><td>${row[6]}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>
    </div>`;
}

function projectsView() {
  const projects = [
    ["WEC-014", "Эмоциональные реакции на шрифтовые пары", "Сбор данных", "141 / 200", "0.83", "23.07.2026"],
    ["WEC-009", "Внимание при чтении новостей", "Черновик", "—", "—", "18.07.2026"],
    ["WEC-004", "Когнитивная нагрузка UI-паттернов", "Анализ", "212 / 200", "0.88", "10.07.2026"]
  ];
  return `
    <div class="page">
      ${pageHead(
        "R2",
        "Проекты",
        "Список исследований с ясным статусом, прогрессом и качеством данных.",
        button("+ Новый проект", "/project/new", "button-primary")
      )}
      <div class="card card-pad" style="margin-bottom:14px">
        <div class="field-grid">
          <div class="field">
            <label for="project-search">Поиск</label>
            <input class="input" id="project-search" placeholder="Название или код проекта">
          </div>
          <div class="field">
            <label for="project-status">Статус</label>
            <select class="select" id="project-status">
              <option>Все статусы</option><option>Черновик</option><option>Сбор данных</option><option>Анализ</option>
            </select>
          </div>
        </div>
      </div>
      <section class="table-wrap">
        <table class="data-table">
          <caption>Все проекты · 3</caption>
          <thead><tr><th>Код</th><th>Название</th><th>Статус</th><th>Сессии</th><th>Средний QC</th><th>Изменён</th></tr></thead>
          <tbody>
            ${projects
              .map((project, index) => {
                const tones = ["success", "neutral", "info"];
                return `<tr data-go="/project/overview" tabindex="0">
                  <td class="mono">${project[0]}</td><td><strong>${project[1]}</strong></td>
                  <td>${badge(project[2], tones[index])}</td><td>${project[3]}</td><td class="mono">${project[4]}</td><td>${project[5]}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </section>
    </div>`;
}

function newProjectView() {
  return `
    <div class="page">
      ${pageHead(
        "R3",
        "Новый проект",
        "Сначала фиксируем цель и владельца. Протокол создаётся на следующем шаге.",
        button("Отмена", "/projects")
      )}
      <section class="card card-pad" style="max-width:820px">
        <form data-form="project" novalidate>
          <div class="field-grid">
            <div class="field field-full">
              <label for="project-name">Название проекта</label>
              <input class="input" id="project-name" placeholder="Например, Внимание при чтении новостей" required>
              <span class="field-help">Название видно только команде исследователя.</span>
            </div>
            <div class="field">
              <label for="project-code">Код</label>
              <input class="input mono" id="project-code" value="WEC-015" readonly>
            </div>
            <div class="field">
              <label for="project-owner">Ответственный</label>
              <select class="select" id="project-owner"><option>Валерия Фирсова</option><option>Анна</option><option>Юлия</option></select>
            </div>
            <div class="field field-full">
              <label for="project-purpose">Цель исследования</label>
              <textarea class="textarea" id="project-purpose" placeholder="Что проверяем и как будет использован результат"></textarea>
            </div>
            <div class="field">
              <label for="project-language">Язык участника</label>
              <select class="select" id="project-language"><option>Русский</option><option>English</option><option>Русский + English</option></select>
            </div>
            <div class="field">
              <label for="project-retention">Хранение агрегатов</label>
              <select class="select" id="project-retention"><option>90 дней</option><option>180 дней</option><option>1 год</option></select>
            </div>
          </div>
          ${callout(
            "Персональные данные участника не требуются",
            "Проект использует обезличенные participant_id и session_id. Видео и аудио не сохраняются по умолчанию.",
            "info"
          )}
          <div class="head-actions" style="margin-top:20px">
            ${button("Сохранить черновик", "/projects")}
            <button class="button button-primary" type="submit">Создать проект</button>
          </div>
        </form>
      </section>
    </div>`;
}

function projectOverviewView() {
  return `
    <div class="page">
      ${pageHead(
        "R4",
        "Эмоциональные реакции на шрифтовые пары",
        "WEC-014 · Сбор данных · Ответственный: Валерия",
        `${button("Открыть протокол", "/project/protocols")}${button("Новая ссылка", "/project/participants", "button-primary")}`
      )}
      ${projectTabs("/project/overview")}
      <section class="grid grid-4">
        ${metric("Сессии", "141 / 200", "70% целевого объёма")}
        ${metric("Валидные", "118", "83.7% всех сессий")}
        ${metric("Средний QC", "0.83", "граница valid: 0.80")}
        ${metric("Завершаемость", "78%", "медиана 13:48")}
      </section>
      <section class="grid grid-2" style="margin-top:14px">
        <article class="card card-pad">
          <h2 class="card-title">Следующие действия</h2>
          <ul class="list" style="margin-top:12px">
            <li class="list-row"><div class="list-main"><p class="list-title">Проверить падение QC на мобильных</p><p class="list-meta">18 сессий с плохим освещением</p></div>${badge("важно", "danger")}</li>
            <li class="list-row"><div class="list-main"><p class="list-title">Добрать 59 сессий</p><p class="list-meta">Осталось 30% выборки</p></div>${badge("в процессе", "info")}</li>
            <li class="list-row"><div class="list-main"><p class="list-title">Подготовить экспорт</p><p class="list-meta">Будет доступен после закрытия сбора</p></div>${badge("позже", "neutral")}</li>
          </ul>
        </article>
        <article class="card card-pad">
          <h2 class="card-title">Прогресс по устройствам</h2>
          <div style="margin-top:18px">
            <p class="list-meta">Ноутбук · 92 сессии</p><div class="progress"><span style="--value:78%"></span></div>
            <p class="list-meta" style="margin-top:15px">Телефон · 36 сессий</p><div class="progress warning"><span style="--value:54%"></span></div>
            <p class="list-meta" style="margin-top:15px">Планшет · 13 сессий</p><div class="progress"><span style="--value:33%"></span></div>
          </div>
        </article>
      </section>
    </div>`;
}

function protocolsView() {
  const rows = [
    ["Основной", "v3", "Опубликован", "141", "21.07.2026"],
    ["Пилот-короткий", "v2", "Черновик", "12", "11.07.2026"],
    ["Пилот", "v1", "Заморожен", "18", "02.07.2026"]
  ];
  return `
    <div class="page">
      ${pageHead(
        "R5",
        "Протоколы",
        "Версии не перезаписываются. Публикация создаёт замороженный снимок протокола.",
        button("+ Создать протокол", "/builder", "button-primary")
      )}
      ${projectTabs("/project/protocols")}
      <section class="table-wrap">
        <table class="data-table">
          <caption>Протоколы проекта · 3</caption>
          <thead><tr><th>Название</th><th>Версия</th><th>Статус</th><th>Сессии</th><th>Изменён</th><th></th></tr></thead>
          <tbody>
            ${rows
              .map((row, index) => `<tr>
                <td><strong>${row[0]}</strong></td><td class="mono">${row[1]}</td>
                <td>${badge(row[2], index === 0 ? "success" : index === 1 ? "neutral" : "info")}</td>
                <td>${row[3]}</td><td>${row[4]}</td>
                <td><button class="text-link" type="button" data-go="${index === 1 ? "/builder" : "/project/overview"}">${index === 1 ? "Продолжить" : "Открыть"}</button></td>
              </tr>`)
              .join("")}
          </tbody>
        </table>
      </section>
      <div style="margin-top:14px">${callout("Правило версий", "Изменение опубликованного протокола создаёт новую draft-версию. Текущие приглашения продолжают ссылаться на зафиксированную версию.", "info")}</div>
    </div>`;
}

function builderView() {
  return `
    <div class="page">
      ${pageHead(
        "R6",
        "Конструктор протокола",
        "Основной · draft v4 · изменения сохранены 20 секунд назад",
        `${button("Предпросмотр", "/participant/invite")}${button("Опубликовать", "/project/participants", "button-primary")}`
      )}
      <div class="stepper" aria-label="Шаги конструктора">
        <div class="step is-complete"><span class="step-number">1</span><span>Параметры</span></div>
        <div class="step is-active"><span class="step-number">2</span><span>Блоки</span></div>
        <div class="step"><span class="step-number">3</span><span>Стимулы</span></div>
        <div class="step"><span class="step-number">4</span><span>QC</span></div>
        <div class="step"><span class="step-number">5</span><span>Проверка</span></div>
      </div>
      <section class="builder">
        <aside class="card builder-panel">
          <h2 class="card-title">Добавить блок</h2>
          <p class="card-subtitle">Перетащите или выберите тип.</p>
          <div class="grid" style="margin-top:16px">
            <button class="button" type="button" data-toast="Блок инструкции добавлен в конец протокола.">Инструкция</button>
            <button class="button" type="button" data-toast="Блок стимулов добавлен в конец протокола.">Стимулы</button>
            <button class="button" type="button" data-toast="Когнитивная задача добавлена.">Когнитивная задача</button>
            <button class="button" type="button" data-toast="Опросник добавлен.">Опросник</button>
            <button class="button" type="button" data-toast="SAM добавлен.">SAM</button>
          </div>
        </aside>
        <div class="card builder-panel">
          <div class="card-head" style="margin:-16px -16px 16px">
            <div><h2 class="card-title">Поток участника</h2><p class="card-subtitle">7 блоков · около 14 минут</p></div>
            ${badge("автосохранение", "success")}
          </div>
          <div class="block"><span class="block-index">01</span><strong>Согласие</strong><p class="list-meta">Версия текста 1.2 · обязательно</p></div>
          <div class="block"><span class="block-index">02</span><strong>Проверка устройства</strong><p class="list-meta">Камера, свет, производительность</p></div>
          <div class="block"><span class="block-index">03</span><strong>Калибровка взгляда</strong><p class="list-meta">9 точек · независимая валидация</p></div>
          <div class="block" style="border-color:#78afad;background:#f7fbfa"><span class="block-index">04</span><strong>Шрифтовые пары</strong><p class="list-meta">24 стимула · gaze + emotion + RT</p></div>
          <div class="block"><span class="block-index">05</span><strong>SAM</strong><p class="list-meta">Valence и arousal после блока</p></div>
          <div class="block"><span class="block-index">06</span><strong>Короткий перерыв</strong><p class="list-meta">30 секунд · можно пропустить</p></div>
        </div>
        <aside class="card builder-panel builder-inspector">
          <h2 class="card-title">Шрифтовые пары</h2>
          <p class="card-subtitle">Настройки выбранного блока.</p>
          <div class="field" style="margin-top:16px">
            <label for="stimuli-source">Набор стимулов</label>
            <select class="select" id="stimuli-source"><option>Шрифты / Основной</option><option>Стандартные</option></select>
          </div>
          <div class="field" style="margin-top:12px">
            <label for="duration">Время показа, мс</label>
            <input class="input mono" id="duration" value="3000">
          </div>
          <div class="field" style="margin-top:12px">
            <label for="response">Ответ</label>
            <select class="select" id="response"><option>Клик</option><option>Клавиша</option><option>Без ответа</option></select>
          </div>
          <div style="margin-top:16px">${callout("Сигналы", "Gaze, blinks, emotion и RT используют общую временную шкалу.", "info")}</div>
        </aside>
      </section>
    </div>`;
}

function participantsView() {
  return `
    <div class="page">
      ${pageHead(
        "R7",
        "Участники",
        "Приглашения, лимиты запусков и статусы без хранения персональных данных.",
        button("+ Новая ссылка", "/participant/invite", "button-primary")
      )}
      ${projectTabs("/project/participants")}
      <section class="card card-pad" style="margin-bottom:14px">
        <div class="grid grid-2">
          <div>
            <p class="card-title">Основная ссылка</p>
            <p class="card-subtitle">Протокол «Основной · v3» · максимум 200 завершений</p>
          </div>
          <div class="head-actions" style="justify-content:flex-end">
            <code class="mono" style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface-soft)">wecog.ru/invite/WEC-014-A</code>
            <button class="button" type="button" data-action="copy-link">Копировать</button>
          </div>
        </div>
      </section>
      <section class="grid grid-4" style="margin-bottom:14px">
        ${metric("Переходы", "184")}
        ${metric("Согласие", "166", "90.2% переходов")}
        ${metric("Начали", "151", "90.9% согласившихся")}
        ${metric("Завершили", "141", "93.4% начавших")}
      </section>
      <section class="table-wrap">
        <table class="data-table">
          <caption>Последние прохождения</caption>
          <thead><tr><th>Participant ID</th><th>Сессия</th><th>Статус</th><th>QC</th><th>Устройство</th><th>Начало</th></tr></thead>
          <tbody>
            <tr><td class="mono">P-7Q31</td><td class="mono">S-1042</td><td>${badge("завершена", "success")}</td><td class="mono">0.91</td><td>Ноутбук</td><td>12 мин назад</td></tr>
            <tr><td class="mono">P-7Q30</td><td class="mono">S-1041</td><td>${badge("отклонена QC", "danger")}</td><td class="mono">0.42</td><td>Телефон</td><td>40 мин назад</td></tr>
            <tr><td class="mono">P-7Q29</td><td class="mono">S-1040</td><td>${badge("прервана", "warning")}</td><td class="mono">—</td><td>Ноутбук</td><td>1 ч назад</td></tr>
          </tbody>
        </table>
      </section>
    </div>`;
}

function monitoringView() {
  return `
    <div class="page">
      ${pageHead(
        "R8",
        "Мониторинг",
        "Воронка прохождения и качество входящих сессий. Обновлено 40 секунд назад.",
        `<button class="button" type="button" data-toast="Данные обновлены.">Обновить</button>`
      )}
      ${projectTabs("/project/monitoring")}
      <section class="grid grid-4" style="margin-bottom:14px">
        ${metric("В сессии сейчас", "6")}
        ${metric("Завершили сегодня", "24")}
        ${metric("Пограничный QC", "5", "20.8% сегодня")}
        ${metric("Invalid", "2", "8.3% сегодня")}
      </section>
      <section class="signal-grid">
        <article class="card card-pad">
          <h2 class="card-title">Поток сессий за 6 часов</h2>
          <p class="card-subtitle">Количество завершений по 30-минутным окнам.</p>
          <div style="margin-top:14px">${chart("Завершённые сессии", [21, 30, 38, 46, 40, 58, 65, 54, 70, 76])}</div>
        </article>
        <article class="card card-pad">
          <h2 class="card-title">Причины снижения QC</h2>
          <p class="card-subtitle">Не диагноз, а технические причины качества записи.</p>
          <ul class="list" style="margin-top:12px">
            <li class="list-row"><div class="list-main"><p class="list-title">Плохое освещение</p><p class="list-meta">8 сессий</p></div><span class="mono">33%</span></li>
            <li class="list-row"><div class="list-main"><p class="list-title">Потеря лица</p><p class="list-meta">5 сессий</p></div><span class="mono">21%</span></li>
            <li class="list-row"><div class="list-main"><p class="list-title">Низкий FPS</p><p class="list-meta">4 сессии</p></div><span class="mono">17%</span></li>
            <li class="list-row"><div class="list-main"><p class="list-title">Взгляд вне viewport</p><p class="list-meta">3 сессии</p></div><span class="mono">12%</span></li>
          </ul>
        </article>
      </section>
      <div style="margin-top:14px">${callout("Честное отображение сигнала", "Если confidence недостаточен, точка взгляда не рисуется на ближайшей цели. Событие сохраняется как low-confidence или off-screen.", "info")}</div>
    </div>`;
}

function resultsView() {
  return `
    <div class="page">
      ${pageHead(
        "R9",
        "Результаты",
        "Агрегаты по 118 валидным сессиям. Фильтры применяются к экрану и экспорту.",
        `${button("Настроить фильтры", "/project/results")}${button("Экспорт", "/project/results", "button-primary")}`
      )}
      ${projectTabs("/project/results")}
      <div class="card card-pad" style="margin-bottom:14px">
        <div class="field-grid">
          <div class="field"><label for="result-protocol">Протокол</label><select class="select" id="result-protocol"><option>Основной · v3</option></select></div>
          <div class="field"><label for="result-qc">Качество</label><select class="select" id="result-qc"><option>Только valid</option><option>Valid + borderline</option></select></div>
        </div>
      </div>
      <section class="grid grid-4" style="margin-bottom:14px">
        ${metric("В выборке", "118", "после QC-фильтра")}
        ${metric("Gaze on target", "72%", "валидные кадры")}
        ${metric("Моргания", "17.4", "в минуту, медиана")}
        ${metric("RT", "418", "мс, медиана")}
      </section>
      <section class="signal-grid">
        <article class="card card-pad">
          <h2 class="card-title">Внимание по времени</h2>
          <p class="card-subtitle">Gaze on target только по кадрам, прошедшим confidence/OOD gate.</p>
          <div style="margin-top:14px">${chart("Доля gaze on target, %", [68, 74, 71, 80, 76, 64, 59, 66, 72, 70])}</div>
        </article>
        <article class="card card-pad">
          <h2 class="card-title">Интерпретация</h2>
          <div class="grid" style="margin-top:14px">
            ${callout("Данных достаточно", "118 сессий прошли выбранный QC-фильтр. Sample count показан для каждой метрики.")}
            ${callout("Не медицинское заключение", "Результаты описывают наблюдаемые сигналы и требуют исследовательской интерпретации.", "warning")}
            ${callout("Версия алгоритма", "gaze v3 · emotion v2 · qc contract 1.0", "info")}
          </div>
        </article>
      </section>
    </div>`;
}

function sessionView() {
  return `
    <div class="page">
      ${pageHead(
        "R10",
        "Сессия P-1042",
        "Проект WEC-014 · Основной v3 · завершена 12 минут назад",
        button("Назад к результатам", "/project/results")
      )}
      <section class="grid grid-4" style="margin-bottom:14px">
        ${metric("QC score", "0.91", "valid")}
        ${metric("Длительность", "14:12")}
        ${metric("Valid gaze", "88%", "12 824 кадров")}
        ${metric("Моргания", "19", "за всю сессию")}
      </section>
      <section class="grid grid-2">
        <article class="card card-pad">
          <div class="card-head" style="margin:-18px -18px 18px">
            <div><h2 class="card-title">Таймлайн сигналов</h2><p class="card-subtitle">Общая монотонная шкала времени.</p></div>
            ${badge("confidence включён", "success")}
          </div>
          ${chart("Gaze confidence", [92, 88, 84, 91, 76, 43, 71, 86, 90, 88])}
          <div style="margin-top:12px">${chart("Engagement proxy", [54, 61, 58, 69, 72, 66, 74, 70, 65, 68])}</div>
        </article>
        <article class="card card-pad">
          <h2 class="card-title">Качество записи</h2>
          <ul class="list" style="margin-top:12px">
            <li class="list-row"><div class="list-main"><p class="list-title">Лицо в кадре</p><p class="list-meta">96% кадров</p></div>${badge("valid", "success")}</li>
            <li class="list-row"><div class="list-main"><p class="list-title">Освещение</p><p class="list-meta">Стабильное</p></div>${badge("valid", "success")}</li>
            <li class="list-row"><div class="list-main"><p class="list-title">Положение головы</p><p class="list-meta">Краткий поворот на 06:42</p></div>${badge("погранично", "warning")}</li>
            <li class="list-row"><div class="list-main"><p class="list-title">Off-screen</p><p class="list-meta">4 эпизода · 18 секунд</p></div>${badge("учтено", "info")}</li>
          </ul>
          <div style="margin-top:14px">${callout("Ограничение", "Эпизоды low confidence исключены из heatmap и gaze-on-target, но доступны в QC-таймлайне.", "warning")}</div>
        </article>
      </section>
    </div>`;
}

function stimuliView() {
  const cards = [
    ["Шрифтовая пара A/B", "Изображение · 1920×1080", "SH-001"],
    ["Новостная карточка", "Изображение · 1280×720", "NW-014"],
    ["Кошачьи: лев", "Изображение · 1600×1067", "VPC-021"],
    ["Кошачьи: рысь", "Изображение · 1600×1067", "VPC-022"],
    ["Инструкция RT", "Текст · RU/EN", "RT-003"],
    ["Нейтральный фон", "Изображение · 1920×1080", "BG-002"]
  ];
  return `
    <div class="page">
      ${pageHead(
        "R12",
        "Библиотека стимулов",
        "Единые материалы для протоколов. Замена файла создаёт новую версию.",
        button("+ Загрузить стимулы", "/library/stimuli", "button-primary")
      )}
      <div class="card card-pad" style="margin-bottom:14px">
        <div class="field-grid">
          <div class="field"><label for="stimuli-search">Поиск</label><input class="input" id="stimuli-search" placeholder="Название, тег или ID"></div>
          <div class="field"><label for="stimuli-type">Тип</label><select class="select" id="stimuli-type"><option>Все типы</option><option>Изображение</option><option>Видео</option><option>Текст</option></select></div>
        </div>
      </div>
      <section class="grid grid-3">
        ${cards
          .map(
            (item, index) => `
              <article class="card" style="overflow:hidden">
                <div style="height:150px;display:grid;place-items:center;background:${index % 2 ? "linear-gradient(145deg,#dcebea,#f6f0e9)" : "linear-gradient(145deg,#edf3f2,#dfe9e8)"}">
                  <span class="mono" style="color:var(--muted);font-size:12px">${item[2]}</span>
                </div>
                <div class="card-pad">
                  <h2 class="card-title">${item[0]}</h2>
                  <p class="card-subtitle">${item[1]}</p>
                  <div style="margin-top:12px">${badge(index < 2 ? "Шрифты" : index < 4 ? "VPC" : "Системные", "neutral")}</div>
                </div>
              </article>`
          )
          .join("")}
      </section>
    </div>`;
}

function templatesView() {
  const templates = [
    ["VPC · знакомое/новое", "2 изображения, counterbalance, gaze AOI", "10-15 мин"],
    ["Зрительно-пространственное рисование", "Инструкция, gaze drawing, replay", "5-8 мин"],
    ["Simple RT", "Фиксация, стимул, ответ, feedback", "4-6 мин"],
    ["Пассивный просмотр", "Стимулы, SAM, gaze + emotion", "8-12 мин"],
    ["Визуальный поиск", "Цели, distractors, RT и точность", "6-10 мин"],
    ["Пустой протокол", "Только системные блоки", "—"]
  ];
  return `
    <div class="page">
      ${pageHead("R13", "Шаблоны", "Проверенные структуры ускоряют создание протокола, но не заменяют исследовательский дизайн.")}
      <section class="grid grid-3">
        ${templates
          .map(
            (item, index) => `
              <article class="card card-pad">
                <div style="display:flex;justify-content:space-between;gap:12px">
                  <span class="mono" style="color:var(--brand-700)">T-${String(index + 1).padStart(2, "0")}</span>
                  ${badge(item[2], "neutral")}
                </div>
                <h2 class="card-title" style="margin-top:20px">${item[0]}</h2>
                <p class="card-subtitle" style="min-height:38px">${item[1]}</p>
                <button class="button" type="button" data-go="/builder" style="margin-top:18px">Создать в проекте</button>
              </article>`
          )
          .join("")}
      </section>
    </div>`;
}

function settingsView() {
  return `
    <div class="page">
      ${pageHead("R11", "Настройки", "Профиль, команда, согласия и техническая конфигурация проекта.")}
      ${projectTabs("/settings")}
      <section class="grid grid-2">
        <article class="card card-pad">
          <h2 class="card-title">Команда проекта</h2>
          <ul class="list" style="margin-top:12px">
            <li class="list-row"><span class="avatar">ВФ</span><div class="list-main"><p class="list-title">Валерия Фирсова</p><p class="list-meta">Владелец · Тимлид</p></div>${badge("полный доступ", "success")}</li>
            <li class="list-row"><span class="avatar">А</span><div class="list-main"><p class="list-title">Анна</p><p class="list-meta">Researcher frontend</p></div>${badge("редактор", "info")}</li>
            <li class="list-row"><span class="avatar">Ю</span><div class="list-main"><p class="list-title">Юлия</p><p class="list-meta">Tech lead · Backend</p></div>${badge("администратор", "info")}</li>
          </ul>
          <button class="button" type="button" data-toast="Приглашение участника команды создано." style="margin-top:16px">Пригласить в команду</button>
        </article>
        <article class="card card-pad">
          <h2 class="card-title">Согласие и данные</h2>
          <div class="field" style="margin-top:16px">
            <label for="consent-version">Активная версия согласия</label>
            <select class="select" id="consent-version"><option>RU v1.2 · 21.07.2026</option><option>RU v1.1 · архив</option></select>
          </div>
          <div class="field" style="margin-top:12px">
            <label for="retention">Срок хранения агрегатов</label>
            <select class="select" id="retention"><option>90 дней</option><option>180 дней</option></select>
          </div>
          <div style="margin-top:16px">${callout("Raw media отключено", "Видео и аудио не сохраняются. Для debug capture нужен отдельный feature flag и согласие.", "info")}</div>
        </article>
      </section>
    </div>`;
}

function billingView() {
  return `
    <div class="page">
      ${pageHead("R14", "Тариф и оплата", "Лимиты объясняются до блокировки действия. Исследователь видит использование и дату обновления.")}
      <section class="grid grid-3">
        <article class="card card-pad">
          <p class="page-kicker">Текущий план</p>
          <h2 class="page-title" style="font-size:28px">Research</h2>
          <p class="page-lead">Для пилотных и университетских исследований.</p>
          <div class="metric-value" style="margin-top:24px">20 000 ₽</div>
          <p class="card-subtitle">в месяц · без НДС</p>
          <button class="button button-primary" type="button" data-toast="Запрос на изменение тарифа отправлен." style="margin-top:20px">Изменить тариф</button>
        </article>
        <article class="card card-pad" style="grid-column:span 2">
          <h2 class="card-title">Использование в июле</h2>
          <div style="margin-top:20px">
            <div style="display:flex;justify-content:space-between"><span>Сессии</span><span class="mono">1 742 / 2 000</span></div>
            <div class="progress warning" style="margin-top:8px"><span style="--value:87%"></span></div>
            <div style="display:flex;justify-content:space-between;margin-top:20px"><span>Хранилище агрегатов</span><span class="mono">4.2 / 20 GB</span></div>
            <div class="progress" style="margin-top:8px"><span style="--value:21%"></span></div>
            <div style="display:flex;justify-content:space-between;margin-top:20px"><span>Участники команды</span><span class="mono">4 / 10</span></div>
            <div class="progress" style="margin-top:8px"><span style="--value:40%"></span></div>
          </div>
        </article>
      </section>
    </div>`;
}

function statesView() {
  return `
    <div class="page">
      ${pageHead("SYS", "Системные состояния", "Единая трактовка loading, empty, error, permissions и качества сигналов.")}
      <section class="state-grid">
        <article class="card system-state">
          <div style="width:100%">
            <div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div>
            <p class="state-title" style="margin-top:18px">Загрузка</p>
            <p class="state-text">Skeleton повторяет структуру, но не подставляет случайные данные.</p>
          </div>
        </article>
        <article class="card system-state"><div><div class="state-symbol">0</div><p class="state-title">Нет данных</p><p class="state-text">Нет сессий за выбранный период. Измените фильтр или скопируйте приглашение.</p>${button("К участникам", "/project/participants")}</div></article>
        <article class="card system-state"><div><div class="state-symbol" style="color:var(--danger);background:var(--danger-bg)">!</div><p class="state-title">Ошибка загрузки</p><p class="state-text">Фильтры сохранены. Повторите запрос; код ошибки доступен в деталях.</p><button class="button" data-toast="Повторяем запрос…" type="button">Повторить</button></div></article>
        <article class="card system-state"><div><div class="state-symbol" style="color:var(--warning);background:var(--warning-bg)">P</div><p class="state-title">Нет доступа</p><p class="state-text">Нужна роль analyst или researcher в проекте WEC-014.</p><button class="button" data-toast="Запрос владельцу проекта отправлен." type="button">Запросить доступ</button></div></article>
        <article class="card system-state"><div><div class="state-symbol" style="color:var(--warning);background:var(--warning-bg)">%</div><p class="state-title">Low confidence</p><p class="state-text">Gaze confidence 0.41. Точка не отображается и не входит в heatmap.</p>${badge("исключено из метрики", "warning")}</div></article>
        <article class="card system-state"><div><div class="state-symbol" style="color:var(--info);background:var(--info-bg)">↗</div><p class="state-title">Off-screen</p><p class="state-text">Взгляд не определён внутри content viewport. Координаты не clamp-ятся к краю.</p>${badge("техническое событие", "info")}</div></article>
        <article class="card system-state"><div><div class="state-symbol" style="color:#7655a6;background:#f1ebf8">D</div><p class="state-title">Demo / mock</p><p class="state-text">Демонстрационные данные отделены от production и не попадают в экспорт.</p>${badge("демонстрационные данные", "demo")}</div></article>
        <article class="card system-state"><div><div class="state-symbol" style="color:var(--warning);background:var(--warning-bg)">~</div><p class="state-title">Сигнал ухудшен</p><p class="state-text">Сессия продолжается, но исследователь получит QC-флаг и причину.</p>${badge("degraded", "warning")}</div></article>
        <article class="card system-state"><div><div class="state-symbol" style="color:var(--info);background:var(--info-bg)">↑</div><p class="state-title">Ожидает загрузки</p><p class="state-text">Результат сохранён локально. Отправка повторится при восстановлении сети.</p>${badge("pending upload", "info")}</div></article>
      </section>
    </div>`;
}

function loginView() {
  return `
    <main class="login-shell" id="main">
      <section class="login-story">
        <a class="brand" href="#/login"><span class="brand-mark"></span><span>Web EmoCog</span></a>
        <div class="login-copy">
          <p class="page-kicker" style="color:#a8d8d5">Исследовательская платформа</p>
          <h1>От протокола до честной аналитики.</h1>
          <p>Создавайте исследования, контролируйте качество сигналов и работайте с обезличенными результатами в одном потоке.</p>
        </div>
        <p class="login-note">Интерфейс не формирует медицинские заключения. Метрики сопровождаются качеством данных, sample count и ограничениями.</p>
      </section>
      <section class="login-form-wrap">
        <form class="login-card" data-form="login">
          <p class="page-kicker">R0 · Вход</p>
          <h2>С возвращением</h2>
          <p>Войдите в кабинет исследователя.</p>
          <div class="field">
            <label for="email">Email</label>
            <input class="input" id="email" type="email" value="valeria@wecog.ru" autocomplete="email">
          </div>
          <div class="field">
            <label for="password">Пароль</label>
            <input class="input" id="password" type="password" value="prototype" autocomplete="current-password">
          </div>
          <button class="button button-primary" type="submit">Войти</button>
          <div style="display:flex;justify-content:space-between;gap:12px;margin-top:16px">
            <button class="text-link" type="button" data-toast="Ссылка восстановления отправлена.">Забыли пароль?</button>
            <button class="text-link" type="button" data-toast="Регистрация будет отдельным состоянием той же формы.">Создать аккаунт</button>
          </div>
        </form>
      </section>
    </main>`;
}

function participantFrame(stepIndex, id, title, text, body = "", options = {}) {
  const progress = ((stepIndex + 1) / participantSteps.length) * 100;
  const back = stepIndex > 0 && !options.noBack
    ? `<button class="button" type="button" data-participant-step="${stepIndex - 1}">Назад</button>`
    : "";
  const nextLabel = options.nextLabel || "Продолжить";
  const next = stepIndex < participantSteps.length - 1
    ? `<button class="button button-primary" type="button" data-participant-step="${stepIndex + 1}">${nextLabel}</button>`
    : `<button class="button button-primary" type="button" data-go="/overview">Вернуться на главную прототипа</button>`;
  return `
    <div class="participant-shell">
      <header class="participant-head">
        <a class="brand" href="#/participant/invite"><span class="brand-mark"></span><span>Web EmoCog</span></a>
        <div class="participant-progress" aria-label="Шаг ${stepIndex + 1} из ${participantSteps.length}">
          <div class="progress"><span style="--value:${progress}%"></span></div>
        </div>
        <span class="mono" style="color:var(--muted);font-size:11px">${stepIndex + 1}/${participantSteps.length}</span>
      </header>
      <main class="participant-main" id="main">
        <section class="participant-card">
          <span class="participant-step">${id}</span>
          <h1 class="participant-title">${title}</h1>
          <p class="participant-text">${text}</p>
          ${body}
          <div class="participant-actions">${back}${next}</div>
        </section>
      </main>
      <footer class="participant-foot">Обезличенная сессия · камера используется локально · raw video не сохраняется</footer>
    </div>
    <div class="prototype-tag">Participant flow · ${id}</div>`;
}

function participantInviteView() {
  return participantFrame(
    0,
    "P1 · Приглашение",
    "Исследование восприятия шрифтовых пар",
    "Вам покажут изображения и попросят оценить впечатление. Исследование займёт около 14 минут.",
    `<div class="grid grid-3" style="margin-top:28px">
      <div class="card card-pad"><strong>14 минут</strong><p class="card-subtitle">примерная длительность</p></div>
      <div class="card card-pad"><strong>Камера</strong><p class="card-subtitle">анализ локально в браузере</p></div>
      <div class="card card-pad"><strong>Можно выйти</strong><p class="card-subtitle">до отправки результата</p></div>
    </div>`,
    { noBack: true, nextLabel: "Начать" }
  );
}

function participantConsentView() {
  return participantFrame(
    1,
    "P2 · Согласие",
    "Перед началом прочитайте условия",
    "Участие добровольное. Вы можете остановиться в любой момент. Исследователь получит обезличенные агрегаты и показатели качества.",
    `<div class="card card-pad" style="margin-top:24px;max-height:220px;overflow:auto">
      <h2 class="card-title">Что обрабатывается</h2>
      <p class="card-subtitle">Положение лица и глаз, моргания, агрегаты эмоциональной мимики, ответы и время реакции. Видео не сохраняется.</p>
      <h2 class="card-title" style="margin-top:18px">Для чего</h2>
      <p class="card-subtitle">Для анализа взаимодействия со стимулами и качества записи. Результаты не являются медицинским заключением.</p>
      <label style="display:flex;gap:10px;margin-top:20px;align-items:flex-start"><input type="checkbox" checked> <span>Я прочитал(а) информацию и добровольно соглашаюсь участвовать.</span></label>
    </div>`
  );
}

function participantDeviceView() {
  return participantFrame(
    2,
    "P3 · Проверка устройства",
    "Подготовим камеру и браузер",
    "Сядьте примерно в 50-70 см от камеры. Лицо должно быть равномерно освещено, вкладка останется активной.",
    `<div class="device-checks">
      <div class="device-check"><strong>Камера ${badge("готова", "success")}</strong><span>1280×720 · 30 FPS</span></div>
      <div class="device-check"><strong>Освещение ${badge("готово", "success")}</strong><span>Лицо видно без пересвета</span></div>
      <div class="device-check"><strong>Производительность ${badge("готово", "success")}</strong><span>Расчётная задержка 74 мс</span></div>
    </div>`
  );
}

function participantCalibrationView() {
  return participantFrame(
    3,
    "P4 · Калибровка",
    "Следите только глазами за точками",
    "Не кликайте по точкам. После девяти позиций будет независимая проверка точности. Небольшие движения головы допустимы.",
    `<div class="card" style="position:relative;height:280px;margin-top:24px;background:var(--surface-soft)">
      <span style="position:absolute;left:12%;top:18%;width:22px;height:22px;border:6px solid var(--brand-600);border-radius:50%;box-shadow:0 0 0 8px rgba(14,110,113,.1)"></span>
      <span style="position:absolute;right:14%;top:20%;width:10px;height:10px;background:var(--border-strong);border-radius:50%"></span>
      <span style="position:absolute;left:50%;top:48%;width:10px;height:10px;background:var(--border-strong);border-radius:50%"></span>
      <span style="position:absolute;left:15%;bottom:17%;width:10px;height:10px;background:var(--border-strong);border-radius:50%"></span>
      <span style="position:absolute;right:12%;bottom:18%;width:10px;height:10px;background:var(--border-strong);border-radius:50%"></span>
      <span class="mono" style="position:absolute;right:16px;top:14px;color:var(--muted);font-size:11px">точка 2 из 9</span>
    </div>`,
    { nextLabel: "Показать результат проверки" }
  );
}

function participantInstructionView() {
  return participantFrame(
    4,
    "P5 · Инструкция блока",
    "Сравните две шрифтовые композиции",
    "Смотрите на изображения свободно, затем выберите вариант, который кажется более уместным для новостного сайта.",
    `<div style="margin-top:24px">${callout("Важно", "Красной точки или подсказки, куда смотреть, во время задания не будет. Если взгляд не определён, система сохранит это как техническое состояние.", "info")}</div>`,
    { nextLabel: "Перейти к заданию" }
  );
}

function participantTaskView() {
  return participantFrame(
    5,
    "P6 · Задание + SAM",
    "Какой вариант лучше подходит новостному сайту?",
    "Посмотрите на оба варианта и выберите один ответ.",
    `<div class="grid grid-2" style="margin-top:26px">
      <button class="card card-pad" type="button" style="min-height:190px;text-align:left;cursor:pointer">
        <span class="mono" style="color:var(--muted)">Вариант A</span>
        <strong style="display:block;margin-top:42px;font-family:Georgia,serif;font-size:32px">Городские новости</strong>
        <span class="card-subtitle">Спокойная контрастная антиква</span>
      </button>
      <button class="card card-pad" type="button" style="min-height:190px;text-align:left;cursor:pointer">
        <span class="mono" style="color:var(--muted)">Вариант B</span>
        <strong style="display:block;margin-top:42px;font-size:30px;letter-spacing:-.05em">Городские новости</strong>
        <span class="card-subtitle">Компактный геометрический гротеск</span>
      </button>
    </div>
    <div class="card card-pad" style="margin-top:14px">
      <strong>Ваше впечатление</strong>
      <p class="card-subtitle">SAM появится после выбора варианта, а не перекроет стимул.</p>
    </div>`,
    { nextLabel: "Подтвердить ответ" }
  );
}

function participantFinalView() {
  return participantFrame(
    6,
    "P7 · Завершение",
    "Спасибо, результат сохранён",
    "Сессия успешно отправлена. Камера и все MediaStream tracks остановлены.",
    `<div class="grid grid-3" style="margin-top:28px">
      <div class="card card-pad"><strong>${badge("загружено", "success")}</strong><p class="card-subtitle">агрегаты и QC</p></div>
      <div class="card card-pad"><strong class="mono">19</strong><p class="card-subtitle">морганий за сессию</p></div>
      <div class="card card-pad"><strong class="mono">WEC-8F2K</strong><p class="card-subtitle">код вознаграждения</p></div>
    </div>`,
    { noBack: true }
  );
}

function participantEdgeView() {
  return participantFrame(
    2,
    "P8 · Краевое состояние",
    "Камера временно недоступна",
    "Разрешение отключено или камера занята другим приложением. Сессия ещё не началась, данные не потеряны.",
    `<div style="margin-top:24px">${callout("Как исправить", "Закройте приложение, использующее камеру, разрешите доступ в адресной строке и повторите проверку.", "warning")}</div>`,
    { nextLabel: "Повторить проверку" }
  );
}

const views = {
  "/overview": overviewView,
  "/projects": projectsView,
  "/project/new": newProjectView,
  "/project/overview": projectOverviewView,
  "/project/protocols": protocolsView,
  "/builder": builderView,
  "/project/participants": participantsView,
  "/project/monitoring": monitoringView,
  "/project/results": resultsView,
  "/session": sessionView,
  "/library/stimuli": stimuliView,
  "/library/templates": templatesView,
  "/settings": settingsView,
  "/billing": billingView,
  "/states": statesView
};

const participantViews = {
  "/participant/invite": participantInviteView,
  "/participant/consent": participantConsentView,
  "/participant/device": participantDeviceView,
  "/participant/calibration": participantCalibrationView,
  "/participant/instruction": participantInstructionView,
  "/participant/task": participantTaskView,
  "/participant/final": participantFinalView,
  "/participant/edge": participantEdgeView
};

function render() {
  const route = normalizeRoute();
  document.body.classList.remove("nav-open");

  if (route === "/login") {
    app.innerHTML = loginView();
  } else if (participantViews[route]) {
    app.innerHTML = participantViews[route]();
  } else {
    const view = views[route] || views["/overview"];
    app.innerHTML = shell(view(), views[route] ? route : "/overview");
  }

  document.title = `${routeMeta[route]?.label || "Web EmoCog"} - UX/UI prototype`;
  requestAnimationFrame(() => document.getElementById("main")?.focus({ preventScroll: true }));
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

document.addEventListener("click", event => {
  const routeTarget = event.target.closest("[data-go]");
  if (routeTarget) {
    event.preventDefault();
    go(routeTarget.dataset.go);
    return;
  }

  const toastTarget = event.target.closest("[data-toast]");
  if (toastTarget) {
    showToast(toastTarget.dataset.toast);
    return;
  }

  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget?.dataset.action === "toggle-nav") {
    document.body.classList.toggle("nav-open");
    return;
  }

  if (actionTarget?.dataset.action === "copy-link") {
    const value = "https://wecog.ru/invite/WEC-014-A";
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value);
    showToast("Ссылка скопирована. В production действие подтвердится без раскрытия PII.");
    return;
  }

  const participantTarget = event.target.closest("[data-participant-step]");
  if (participantTarget) {
    const index = Number(participantTarget.dataset.participantStep);
    if (Number.isInteger(index) && participantSteps[index]) go(participantSteps[index]);
  }
});

document.addEventListener("keydown", event => {
  const row = event.target.closest("tr[data-go]");
  if (row && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    go(row.dataset.go);
  }
  if (event.key === "Escape") document.body.classList.remove("nav-open");
});

document.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.target;
  if (form.dataset.form === "login") {
    const submit = form.querySelector('button[type="submit"]');
    submit.classList.add("is-loading");
    submit.textContent = "Входим";
    window.setTimeout(() => go("/overview"), 420);
  }
  if (form.dataset.form === "project") {
    const name = form.querySelector("#project-name");
    if (!name.value.trim()) {
      name.setAttribute("aria-invalid", "true");
      let error = form.querySelector("#project-name-error");
      if (!error) {
        error = document.createElement("span");
        error.id = "project-name-error";
        error.className = "field-error";
        error.textContent = "Укажите название проекта.";
        name.closest(".field").appendChild(error);
        name.setAttribute("aria-describedby", error.id);
      }
      name.focus();
      return;
    }
    showToast("Проект создан. Открываем обзор проекта.");
    window.setTimeout(() => go("/project/overview"), 300);
  }
});

window.addEventListener("hashchange", render);

if (!window.location.hash) window.location.hash = "/login";
else render();
