import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "screens");

const C = {
  canvas: "#F2F6F4",
  paper: "#FFFFFF",
  ink: "#062D2E",
  ink2: "#174747",
  brand: "#006B66",
  brandStrong: "#004E4A",
  brand2: "#00A69D",
  mint: "#D6F4EE",
  line: "#B7CCC7",
  lineStrong: "#789692",
  muted: "#4F6B6A",
  blue: "#2563EB",
  blueSoft: "#E7EEFF",
  orange: "#B45309",
  orangeSoft: "#FFF1E6",
  yellow: "#F5C451",
  yellowSoft: "#FFF3C4",
  red: "#B42318",
  redSoft: "#FEE4E2",
  green: "#067647",
  greenSoft: "#DCFAE6",
  purple: "#6941C6",
  purpleSoft: "#F1EBFF"
};

const researcherScreens = [
  ["R0", "Вход", "login"],
  ["R1", "Главная", "overview"],
  ["R2", "Проекты", "projects"],
  ["R3", "Новый проект", "new-project"],
  ["R4", "Обзор проекта", "project-overview"],
  ["R5", "Протоколы", "protocols"],
  ["R6", "Конструктор", "builder"],
  ["R7", "Участники", "participants"],
  ["R8", "Мониторинг", "monitoring"],
  ["R9", "Результаты", "results"],
  ["R10", "Сессия", "session"],
  ["R11", "Настройки", "settings"],
  ["R12", "Стимулы", "stimuli"],
  ["R13", "Шаблоны", "templates"],
  ["R14", "Тариф", "billing"]
];

const participantScreens = [
  ["P1", "Приглашение", "invite"],
  ["P2", "Согласие", "consent"],
  ["P3", "Проверка устройства", "device"],
  ["P4", "Калибровка", "calibration"],
  ["P5", "Инструкция", "instruction"],
  ["P6", "Задание", "task"],
  ["P7", "Завершение", "final"],
  ["P8", "Камера недоступна", "edge"]
];

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attrs(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}="${esc(value)}"`)
    .join(" ");
}

function rect(x, y, width, height, options = {}) {
  return `<rect ${attrs({
    x,
    y,
    width,
    height,
    rx: options.r ?? 14,
    fill: options.fill ?? C.paper,
    stroke: options.stroke,
    "stroke-width": options.sw
  })}/>`;
}

function line(x1, y1, x2, y2, color = C.line, width = 1) {
  return `<line ${attrs({ x1, y1, x2, y2, stroke: color, "stroke-width": width })}/>`;
}

function circle(cx, cy, r, fill, stroke, sw) {
  return `<circle ${attrs({ cx, cy, r, fill, stroke, "stroke-width": sw })}/>`;
}

function text(x, y, value, options = {}) {
  return `<text ${attrs({
    x,
    y,
    fill: options.fill ?? C.ink,
    "font-family": options.mono ? "IBM Plex Mono, monospace" : "Golos Text, Arial, sans-serif",
    "font-size": options.size ?? 14,
    "font-weight": options.weight ?? 400,
    "text-anchor": options.anchor,
    "letter-spacing": options.spacing
  })}>${esc(value)}</text>`;
}

function multiline(x, y, values, options = {}) {
  const lines = Array.isArray(values) ? values : [values];
  const gap = options.gap ?? (options.size ?? 14) * 1.45;
  return lines
    .map((value, index) => text(x, y + index * gap, value, options))
    .join("");
}

function pill(x, y, label, tone = "neutral", width) {
  const tones = {
    success: [C.greenSoft, C.green],
    warning: [C.yellowSoft, C.orange],
    danger: [C.redSoft, C.red],
    accent: [C.blueSoft, C.blue],
    discovery: [C.purpleSoft, C.purple],
    dark: [C.ink, C.paper],
    neutral: [C.canvas, C.muted]
  };
  const [fill, ink] = tones[tone] ?? tones.neutral;
  const w = width ?? Math.max(70, label.length * 7.2 + 24);
  return `${rect(x, y, w, 28, { r: 14, fill })}${text(x + w / 2, y + 18, label, {
    size: 11,
    weight: 700,
    fill: ink,
    anchor: "middle",
    spacing: 0.2
  })}`;
}

function button(x, y, label, options = {}) {
  const w = options.w ?? Math.max(112, label.length * 8 + 34);
  const primary = options.kind === "primary";
  const signal = options.kind === "signal";
  const danger = options.kind === "danger";
  const fill = danger ? C.red : signal ? C.brand : primary ? C.ink : C.paper;
  const ink = primary || signal || danger ? C.paper : C.ink;
  return `${rect(x, y, w, 44, {
    r: 10,
    fill,
    stroke: primary || signal || danger ? fill : C.lineStrong,
    sw: primary || signal || danger ? 1 : 1.5
  })}${text(x + w / 2, y + 28, label, {
    size: 13,
    weight: 700,
    fill: ink,
    anchor: "middle"
  })}`;
}

function field(x, y, width, label, value = "", options = {}) {
  const h = options.multiline ? 88 : 52;
  const parts = [
    text(x, y, label, { size: 11, weight: 700, fill: C.muted, spacing: 0.6 }),
    rect(x, y + 12, width, h, {
      r: 10,
      fill: options.disabled ? C.canvas : C.paper,
      stroke: options.error ? C.red : C.lineStrong,
      sw: options.error ? 2 : 1.5
    }),
    text(x + 14, y + (options.multiline ? 42 : 44), value, {
      size: 14,
      fill: value ? C.ink : C.muted,
      mono: options.mono
    })
  ];
  if (options.error) parts.push(text(x, y + h + 32, options.error, { size: 11, fill: C.red, weight: 600 }));
  return parts.join("");
}

function metric(x, y, width, label, value, options = {}) {
  const dark = options.dark;
  const accent = options.accent;
  const fill = dark ? C.ink : accent ? C.blue : C.paper;
  const ink = dark || accent ? C.paper : C.ink;
  return [
    rect(x, y, width, options.h ?? 118, {
      r: 14,
      fill,
      stroke: dark || accent ? fill : C.line,
      sw: 1
    }),
    text(x + 18, y + 34, label, {
      size: 11,
      weight: 700,
      fill: dark ? "#9BC7C3" : accent ? "#FFE6DF" : C.muted,
      spacing: 0.5
    }),
    text(x + 18, y + 82, value, { size: options.size ?? 32, weight: 700, fill: ink, mono: options.mono }),
    options.note ? text(x + width - 18, y + 82, options.note, { size: 11, fill: dark || accent ? C.paper : C.muted, anchor: "end" }) : ""
  ].join("");
}

function progress(x, y, width, value, color = C.brand, background = "#DCE7E4") {
  const safe = Math.max(0, Math.min(1, value));
  return `${rect(x, y, width, 8, { r: 4, fill: background })}${rect(x, y, width * safe, 8, { r: 4, fill: color })}`;
}

function sparkline(x, y, width, height, values, options = {}) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const px = x + (index / (values.length - 1)) * width;
      const py = y + height - ((value - min) / span) * height;
      return [px, py];
    });
  const polyline = points.map(point => point.join(",")).join(" ");
  const area = `${x},${y + height} ${polyline} ${x + width},${y + height}`;
  return [
    line(x, y + height, x + width, y + height, options.grid ?? C.line, 1),
    `<polygon points="${area}" fill="${options.soft ?? C.mint}" opacity="0.85"/>`,
    `<polyline points="${polyline}" fill="none" stroke="${options.color ?? C.brand}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    ...points.filter((_, index) => index === points.length - 1).map(point => circle(point[0], point[1], 5, options.color ?? C.brand, C.paper, 2))
  ].join("");
}

function heatmapPanel(x, y, width, height, compact = false) {
  const innerX = x + 18;
  const innerY = y + (compact ? 46 : 58);
  const innerW = width - 36;
  const innerH = height - (compact ? 88 : 110);
  const spots = [
    [0.31, 0.42, 42, C.brand, 0.3],
    [0.35, 0.46, 26, C.brand, 0.55],
    [0.69, 0.38, 38, C.blue, 0.28],
    [0.66, 0.42, 22, C.blue, 0.52],
    [0.57, 0.68, 30, C.purple, 0.28]
  ];
  return [
    rect(x, y, width, height, { fill: C.paper, stroke: C.line, sw: 1 }),
    text(x + 18, y + 30, "Карта внимания", { size: compact ? 15 : 18, weight: 750 }),
    text(x + width - 18, y + 30, "n=118", { size: 10, mono: true, fill: C.muted, anchor: "end" }),
    rect(innerX, innerY, innerW, innerH, { r: 10, fill: "#E5ECE9" }),
    `<rect x="${innerX + innerW * 0.08}" y="${innerY + innerH * 0.16}" width="${innerW * 0.36}" height="${innerH * 0.56}" rx="8" fill="${C.paper}" stroke="${C.lineStrong}" stroke-width="1.5" stroke-dasharray="5 4"/>`,
    `<rect x="${innerX + innerW * 0.56}" y="${innerY + innerH * 0.16}" width="${innerW * 0.36}" height="${innerH * 0.56}" rx="8" fill="${C.paper}" stroke="${C.lineStrong}" stroke-width="1.5" stroke-dasharray="5 4"/>`,
    text(innerX + innerW * 0.11, innerY + innerH * 0.25, "AOI A", { size: 10, mono: true, fill: C.muted }),
    text(innerX + innerW * 0.59, innerY + innerH * 0.25, "AOI B", { size: 10, mono: true, fill: C.muted }),
    ...spots.map(([px, py, radius, color, opacity]) => `<circle cx="${innerX + innerW * px}" cy="${innerY + innerH * py}" r="${compact ? radius * 0.68 : radius}" fill="${color}" opacity="${opacity}"/>`),
    circle(x + 22, y + height - 20, 5, C.brand),
    text(x + 34, y + height - 16, "gaze", { size: 10, fill: C.muted }),
    circle(x + (compact ? 102 : 120), y + height - 20, 5, C.blue),
    text(x + (compact ? 114 : 132), y + height - 16, "вовлечённость", { size: 10, fill: C.muted }),
    circle(x + (compact ? 226 : 262), y + height - 20, 5, C.purple),
    text(x + (compact ? 238 : 274), y + height - 16, "valence", { size: 10, fill: C.muted })
  ].join("");
}

function row(x, y, width, title, meta, options = {}) {
  const h = options.h ?? 62;
  return [
    options.fill ? rect(x, y, width, h, { r: 10, fill: options.fill }) : "",
    text(x + 14, y + 25, title, { size: 14, weight: 650, fill: options.ink ?? C.ink }),
    meta ? text(x + 14, y + 46, meta, { size: 11, fill: options.metaInk ?? C.muted, mono: options.mono }) : "",
    options.right ? text(x + width - 14, y + 34, options.right, { size: 12, weight: 700, fill: options.rightInk ?? C.ink, anchor: "end", mono: options.rightMono }) : "",
    options.tone ? pill(x + width - (options.pillW ?? 108) - 12, y + 17, options.tone, options.toneKind ?? "neutral", options.pillW ?? 108) : "",
    line(x, y + h, x + width, y + h, options.noLine ? "transparent" : C.line)
  ].join("");
}

function iconRail(activeIndex, height = 900) {
  const iconY = [154, 212, 270, 328, 386, 444];
  const glyphs = [
    y => `<path d="M30 ${y+1} L38 ${y-7} L46 ${y+1} V${y+9} H41 V${y+3} H35 V${y+9} H30 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
    y => `<path d="M29 ${y-6} H36 L39 ${y-3} H47 V${y+8} H29 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
    y => `<path d="M29 ${y-8} H34 V${y+8} H29 Z M36 ${y-5} H41 V${y+8} H36 Z M43 ${y-9} H48 V${y+8} H43 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    y => `<path d="M29 ${y+8} V${y+1} M36 ${y+8} V${y-4} M43 ${y+8} V${y-9} M28 ${y+8} H48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
    y => `<circle cx="38" cy="${y}" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="38" cy="${y}" r="2.5" fill="currentColor"/>`,
    y => `<rect x="29" y="${y-7}" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M29 ${y-2} H47" stroke="currentColor" stroke-width="1.8"/>`
  ];
  return [
    rect(0, 0, 76, height, { r: 0, fill: C.ink }),
    circle(38, 38, 12, C.brand2),
    circle(38, 38, 4, C.paper),
    ...iconY.map((y, index) => {
      const active = index === activeIndex;
      return `${active ? rect(12, y - 22, 52, 44, { r: 12, fill: C.brand }) : ""}<g color="${active ? C.paper : "#7FA09D"}">${glyphs[index](y)}</g>`;
    }),
    line(20, 488, 56, 488, "#315657"),
    circle(38, height - 38, 15, C.paper),
    text(38, height - 34, "В", { size: 11, weight: 800, fill: C.ink, anchor: "middle" })
  ].join("");
}

function mobileTop(title, id) {
  return [
    rect(0, 0, 390, 68, { r: 0, fill: C.ink }),
    circle(22, 24, 7, C.brand2),
    text(38, 29, "WEC", { size: 12, weight: 800, fill: C.paper, spacing: 1 }),
    text(18, 55, title, { size: 16, weight: 700, fill: C.paper }),
    text(338, 29, id, { size: 10, mono: true, fill: "#9BC7C3", anchor: "end" }),
    line(354, 20, 372, 20, "#9BC7C3", 1.5),
    line(354, 26, 372, 26, "#9BC7C3", 1.5),
    line(354, 32, 372, 32, "#9BC7C3", 1.5)
  ].join("");
}

function desktopHeader(id, title, action) {
  const context = id === "R1"
    ? "КАБИНЕТ"
    : id === "R2" || id === "R3"
      ? "ПРОЕКТЫ"
      : /^R([4-9]|10|11)$/.test(id)
        ? "ПРОЕКТЫ / WEC-014"
        : id === "R12" || id === "R13"
          ? "БИБЛИОТЕКА"
          : "АККАУНТ";
  return [
    text(116, 44, id, { size: 11, weight: 700, fill: C.brand, mono: true, spacing: 1 }),
    text(154, 44, context, { size: 10, weight: 700, fill: C.muted, mono: true, spacing: 0.8 }),
    text(116, 82, title, { size: 30, weight: 750, fill: C.ink }),
    action ? button(1260, 42, action, { kind: "primary", w: 132 }) : "",
    line(116, 106, 1392, 106, C.line)
  ].join("");
}

function projectTabs(id) {
  const tabs = [
    ["R4", "Обзор"],
    ["R5", "Протоколы"],
    ["R7", "Участники"],
    ["R8", "Мониторинг"],
    ["R9", "Результаты"]
  ];
  const active = id === "R6" ? "R5" : id === "R10" ? "R9" : id;
  return [
    rect(116, 114, 1276, 42, { r: 10, fill: C.paper, stroke: C.line, sw: 1 }),
    ...tabs.map(([tabId, label], index) => {
      const x = 124 + index * 132;
      const selected = tabId === active;
      return `${selected ? rect(x, 121, 124, 28, { r: 8, fill: C.ink }) : ""}${text(x + 62, 140, label, {
        size: 11,
        weight: 700,
        fill: selected ? C.paper : C.muted,
        anchor: "middle"
      })}`;
    }),
    text(1372, 140, "Настройки", { size: 11, weight: 700, fill: id === "R11" ? C.brand : C.muted, anchor: "end" })
  ].join("");
}

function svgDocument(width, height, title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <rect width="${width}" height="${height}" fill="${C.canvas}"/>
  ${body}
</svg>
`;
}

function researcherShell(id, title, body, options = {}) {
  const mobile = options.mobile;
  if (id === "R0") return loginScreen(mobile);
  if (mobile) {
    return svgDocument(390, 844, `${id} ${title} mobile`, `${mobileTop(title, id)}${body}`);
  }
  const active = id === "R1" ? 0 : id === "R2" || id === "R3" || /^R([4-9]|10|11)$/.test(id) ? 1 : id === "R12" || id === "R13" ? 2 : 4;
  const tabs = /^R([4-9]|10|11)$/.test(id) ? projectTabs(id) : "";
  return svgDocument(1440, 900, `${id} ${title} desktop`, `${iconRail(active)}${desktopHeader(id, title, options.action)}${tabs}${body}`);
}

function loginScreen(mobile) {
  if (mobile) {
    const body = [
      mobileTop("Вход", "R0"),
      text(20, 128, "Кабинет", { size: 34, weight: 800 }),
      text(20, 168, "исследователя", { size: 34, weight: 800, fill: C.brand }),
      field(20, 232, 350, "EMAIL", "valeria@wecog.ru"),
      field(20, 318, 350, "ПАРОЛЬ", "••••••••"),
      button(20, 404, "Войти", { kind: "signal", w: 350 }),
      text(195, 480, "SSO организации", { size: 13, weight: 700, fill: C.brand, anchor: "middle" }),
      line(20, 516, 370, 516),
      text(20, 560, "Нет аккаунта?", { size: 13, fill: C.muted }),
      text(370, 560, "Регистрация →", { size: 13, weight: 700, fill: C.ink, anchor: "end" })
    ].join("");
    return svgDocument(390, 844, "R0 Вход mobile", body);
  }
  const body = [
    rect(0, 0, 720, 900, { r: 0, fill: C.ink }),
    circle(64, 62, 12, C.brand2),
    text(88, 69, "WEB EMOCOG", { size: 13, weight: 800, fill: C.paper, spacing: 1.8 }),
    multiline(64, 328, ["Исследования", "без визуального", "шума."], { size: 50, weight: 800, fill: C.paper, gap: 58 }),
    rect(64, 548, 162, 8, { r: 4, fill: C.blue }),
    text(64, 782, "Данные с видимым качеством.", { size: 14, fill: "#A9C5C2" }),
    text(836, 194, "Вход", { size: 36, weight: 800 }),
    text(836, 232, "Кабинет исследователя", { size: 14, fill: C.muted }),
    field(836, 298, 460, "EMAIL", "valeria@wecog.ru"),
    field(836, 390, 460, "ПАРОЛЬ", "••••••••"),
    button(836, 488, "Войти", { kind: "signal", w: 460 }),
    text(1066, 566, "SSO организации", { size: 13, weight: 700, fill: C.brand, anchor: "middle" }),
    line(836, 620, 1296, 620),
    text(836, 660, "Нет аккаунта?", { size: 13, fill: C.muted }),
    text(1296, 660, "Регистрация →", { size: 13, weight: 700, fill: C.ink, anchor: "end" })
  ].join("");
  return svgDocument(1440, 900, "R0 Вход desktop", body);
}

function registrationScreen(mobile) {
  if (mobile) {
    const body = [
      mobileTop("Регистрация", "R0b"),
      text(20, 120, "Аккаунт", { size: 31, weight: 800 }),
      text(20, 156, "исследователя", { size: 31, weight: 800, fill: C.brand }),
      field(20, 202, 350, "ИМЯ", "Валерия Фирсова"),
      field(20, 284, 350, "EMAIL", "valeria@wecog.ru"),
      field(20, 366, 350, "ОРГАНИЗАЦИЯ", "Лаборатория"),
      field(20, 448, 350, "ПАРОЛЬ", "••••••••"),
      rect(20, 542, 350, 72, { fill: C.mint }),
      circle(40, 568, 10, C.brand),
      text(40, 572, "✓", { size: 11, weight: 800, fill: C.paper, anchor: "middle" }),
      multiline(58, 564, ["Принимаю условия", "и политику данных"], { size: 12, weight: 650, gap: 20 }),
      button(20, 648, "Создать аккаунт", { kind: "signal", w: 350 }),
      text(195, 730, "Уже есть аккаунт? Войти →", { size: 12, weight: 700, fill: C.brand, anchor: "middle" })
    ].join("");
    return svgDocument(390, 844, "R0 Регистрация mobile", body);
  }
  const body = [
    rect(0, 0, 600, 900, { r: 0, fill: C.ink }),
    circle(64, 62, 12, C.brand2),
    text(88, 69, "WEB EMOCOG", { size: 13, weight: 800, fill: C.paper, spacing: 1.8 }),
    multiline(64, 310, ["Исследование", "начинается", "с ясной цели."], { size: 46, weight: 800, fill: C.paper, gap: 56 }),
    rect(64, 514, 120, 8, { r: 4, fill: C.blue }),
    text(64, 782, "Команда, протокол, качество.", { size: 14, fill: "#9BC7C3" }),
    text(728, 112, "Создать аккаунт", { size: 34, weight: 800 }),
    field(728, 166, 300, "ИМЯ", "Валерия Фирсова"),
    field(1048, 166, 300, "EMAIL", "valeria@wecog.ru"),
    field(728, 258, 620, "ОРГАНИЗАЦИЯ", "Университет или лаборатория"),
    field(728, 350, 620, "ПАРОЛЬ", "••••••••"),
    rect(728, 458, 620, 76, { fill: C.mint }),
    circle(752, 486, 10, C.brand),
    text(752, 490, "✓", { size: 11, weight: 800, fill: C.paper, anchor: "middle" }),
    text(776, 486, "Принимаю условия использования и политику данных", { size: 13, weight: 650 }),
    text(776, 510, "Участники исследования аккаунт не создают", { size: 11, fill: C.muted }),
    button(728, 574, "Создать аккаунт", { kind: "signal", w: 620 }),
    text(1038, 660, "Уже есть аккаунт? Войти →", { size: 13, weight: 700, fill: C.brand, anchor: "middle" })
  ].join("");
  return svgDocument(1440, 900, "R0 Регистрация desktop", body);
}

function researcherBody(id, mobile) {
  const x = mobile ? 18 : 116;
  const projectScreen = /^R([4-9]|10|11)$/.test(id);
  const y = mobile ? 92 : projectScreen ? 170 : 132;
  const w = mobile ? 354 : 1276;
  const gap = mobile ? 10 : 14;

  if (id === "R1") {
    if (mobile) {
      return [
        metric(x, y, 172, "СЕССИИ", "128", { dark: true }),
        metric(x + 182, y, 172, "QC", "0.83", { accent: true }),
        text(x, y + 154, "В работе", { size: 18, weight: 750 }),
        rect(x, y + 174, w, 126, { fill: C.paper, stroke: C.line, sw: 1 }),
        text(x + 16, y + 204, "Шрифтовые пары", { size: 16, weight: 700 }),
        pill(x + 224, y + 190, "сбор данных", "success", 112),
        text(x + 16, y + 238, "141 / 200", { size: 12, mono: true, fill: C.muted }),
        progress(x + 16, y + 258, w - 32, 0.7),
        rect(x, y + 316, w, 88, { fill: C.orangeSoft }),
        text(x + 16, y + 348, "QC снизился до 0.61", { size: 15, weight: 750, fill: C.red }),
        text(x + 16, y + 377, "Открыть мониторинг →", { size: 12, weight: 700, fill: C.ink }),
        text(x, y + 446, "Последние", { size: 18, weight: 750 }),
        row(x, y + 462, w, "P-1042", "14:12", { right: "0.91", rightMono: true }),
        row(x, y + 524, w, "P-1041", "13:45", { right: "0.42", rightInk: C.red, rightMono: true }),
        button(x, 770, "Новый проект", { kind: "signal", w })
      ].join("");
    }
    return [
      metric(x, y, 298, "АКТИВНЫЕ ПРОЕКТЫ", "3", { dark: true }),
      metric(x + 312, y, 298, "СЕССИИ · 7 ДНЕЙ", "128"),
      metric(x + 624, y, 298, "СРЕДНИЙ QC", "0.83", { accent: true }),
      metric(x + 936, y, 340, "ЗАВЕРШАЕМОСТЬ", "74%"),
      rect(x, y + 142, 748, 276, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 22, y + 178, "Активные проекты", { size: 18, weight: 750 }),
      row(x + 22, y + 196, 704, "Шрифтовые пары", "141 / 200 · QC 0.83", { tone: "сбор", toneKind: "success", pillW: 78 }),
      row(x + 22, y + 258, 704, "Чтение новостей", "Черновик", { right: "Открыть →", rightInk: C.brand }),
      row(x + 22, y + 320, 704, "UI-паттерны", "212 / 200", { tone: "анализ", toneKind: "neutral", pillW: 78 }),
      rect(x + 762, y + 142, 514, 276, { fill: C.ink }),
      text(x + 786, y + 180, "Требует внимания", { size: 18, weight: 750, fill: C.paper }),
      rect(x + 786, y + 208, 466, 74, { fill: C.red, r: 10 }),
      text(x + 804, y + 238, "QC снизился до 0.61", { size: 16, weight: 750, fill: C.paper }),
      text(x + 804, y + 262, "Мониторинг →", { size: 12, weight: 700, fill: C.paper }),
      row(x + 786, y + 296, 466, "Черновик · 12 дней", "", { ink: C.paper, right: "Проверить →", rightInk: "#9BC7C3", noLine: true }),
      text(x, y + 468, "Последние сессии", { size: 18, weight: 750 }),
      row(x, y + 492, w, "P-1042  ·  Шрифтовые пары", "14:12", { right: "QC 0.91", rightMono: true }),
      row(x, y + 554, w, "P-1041  ·  Шрифтовые пары", "13:45", { right: "QC 0.42", rightInk: C.red, rightMono: true }),
      row(x, y + 616, w, "P-1040  ·  UI-паттерны", "03:02", { right: "прервана", rightInk: C.muted })
    ].join("");
  }

  if (id === "R2") {
    const rows = [
      ["WEC-014", "Шрифтовые пары", "сбор", "0.83"],
      ["WEC-009", "Чтение новостей", "черновик", "—"],
      ["WEC-004", "UI-паттерны", "анализ", "0.88"]
    ];
    if (mobile) {
      return [
        field(x, y, w, "ПОИСК", "Название или код"),
        ...rows.map((item, index) => {
          const yy = y + 94 + index * 128;
          return `${rect(x, yy, w, 112, { fill: index === 0 ? C.ink : C.paper, stroke: index === 0 ? C.ink : C.line, sw: 1 })}
            ${text(x + 16, yy + 28, item[0], { size: 11, mono: true, fill: index === 0 ? "#9BC7C3" : C.brand })}
            ${text(x + 16, yy + 58, item[1], { size: 16, weight: 700, fill: index === 0 ? C.paper : C.ink })}
            ${text(x + 16, yy + 88, item[2], { size: 12, fill: index === 0 ? C.paper : C.muted })}
            ${text(x + w - 16, yy + 88, item[3], { size: 14, mono: true, weight: 700, fill: index === 0 ? C.yellow : C.ink, anchor: "end" })}`;
        }),
        button(x, 770, "Новый проект", { kind: "signal", w })
      ].join("");
    }
    return [
      field(x, y, 510, "ПОИСК", "Название или код проекта"),
      pill(x + 532, y + 28, "Все статусы", "neutral", 116),
      button(x + w - 132, y + 18, "Новый проект", { kind: "signal", w: 132 }),
      text(x, y + 112, "3 проекта", { size: 13, mono: true, fill: C.muted }),
      ...rows.map((item, index) => {
        const yy = y + 138 + index * 116;
        return `${rect(x, yy, w, 96, { fill: index === 0 ? C.ink : C.paper, stroke: index === 0 ? C.ink : C.line, sw: 1 })}
          ${text(x + 20, yy + 32, item[0], { size: 11, mono: true, fill: index === 0 ? "#9BC7C3" : C.brand })}
          ${text(x + 146, yy + 55, item[1], { size: 18, weight: 700, fill: index === 0 ? C.paper : C.ink })}
          ${pill(x + 740, yy + 34, item[2], index === 0 ? "success" : "neutral", 100)}
          ${text(x + 1030, yy + 57, item[3], { size: 20, mono: true, weight: 700, fill: index === 0 ? C.yellow : C.ink })}
          ${text(x + w - 22, yy + 57, "Открыть →", { size: 12, weight: 700, fill: index === 0 ? C.paper : C.brand, anchor: "end" })}`;
      })
    ].join("");
  }

  if (id === "R3") {
    if (mobile) {
      return [
        field(x, y, w, "НАЗВАНИЕ", "Внимание при чтении"),
        field(x, y + 88, w, "КОД", "WEC-015", { mono: true, disabled: true }),
        field(x, y + 176, w, "ОТВЕТСТВЕННЫЙ", "Валерия Фирсова"),
        field(x, y + 264, w, "ЦЕЛЬ", "Что проверяем и как используем результат", { multiline: true }),
        rect(x, y + 392, w, 72, { fill: C.mint }),
        text(x + 16, y + 424, "Обезличенные ID", { size: 14, weight: 750, fill: C.brand }),
        text(x + 16, y + 448, "Raw media выключено", { size: 12, fill: C.ink }),
        button(x, 770, "Создать проект", { kind: "signal", w })
      ].join("");
    }
    return [
      rect(x, y, 860, 620, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 26, y + 44, "Основа проекта", { size: 20, weight: 750 }),
      field(x + 26, y + 82, 808, "НАЗВАНИЕ", "Внимание при чтении новостей"),
      field(x + 26, y + 174, 260, "КОД", "WEC-015", { mono: true, disabled: true }),
      field(x + 304, y + 174, 530, "ОТВЕТСТВЕННЫЙ", "Валерия Фирсова"),
      field(x + 26, y + 266, 808, "ЦЕЛЬ", "Что проверяем и как будет использован результат", { multiline: true }),
      field(x + 26, y + 394, 392, "ЯЗЫК", "Русский"),
      field(x + 442, y + 394, 392, "ХРАНЕНИЕ", "90 дней"),
      rect(x + 26, y + 502, 808, 72, { fill: C.mint }),
      text(x + 44, y + 534, "Обезличенные participant_id и session_id", { size: 14, weight: 700, fill: C.brand }),
      text(x + 44, y + 557, "Видео и аудио не сохраняются", { size: 12, fill: C.ink }),
      rect(x + 884, y, 392, 216, { fill: C.ink }),
      text(x + 910, y + 44, "Следующий шаг", { size: 12, mono: true, fill: "#9BC7C3" }),
      multiline(x + 910, y + 88, ["Создать", "протокол"], { size: 32, weight: 800, fill: C.paper, gap: 38 }),
      rect(x + 910, y + 172, 72, 6, { r: 3, fill: C.blue }),
      button(x + 884, y + 576, "Создать проект", { kind: "signal", w: 392 })
    ].join("");
  }

  if (id === "R4") {
    if (mobile) {
      return [
        rect(x, y, w, 164, { fill: C.ink }),
        text(x + 18, y + 32, "WEC-014", { size: 11, mono: true, fill: "#9BC7C3" }),
        multiline(x + 18, y + 70, ["Шрифтовые", "пары"], { size: 28, weight: 800, fill: C.paper, gap: 34 }),
        pill(x + 224, y + 116, "сбор", "success", 92),
        metric(x, y + 178, 172, "СЕССИИ", "141"),
        metric(x + 182, y + 178, 172, "QC", "0.83", { accent: true }),
        text(x, y + 336, "Фокус", { size: 18, weight: 750 }),
        row(x, y + 352, w, "Проверить мобильные", "18 сессий", { right: "→", rightInk: C.red }),
        row(x, y + 414, w, "Добрать выборку", "59 сессий", { right: "70%", rightMono: true }),
        button(x, 770, "Новая ссылка", { kind: "signal", w })
      ].join("");
    }
    return [
      rect(x, y, w, 176, { fill: C.ink }),
      text(x + 24, y + 34, "WEC-014 · СБОР ДАННЫХ", { size: 11, mono: true, fill: "#9BC7C3", spacing: 1 }),
      text(x + 24, y + 88, "Шрифтовые пары", { size: 34, weight: 800, fill: C.paper }),
      text(x + 24, y + 130, "141 / 200", { size: 16, mono: true, fill: C.yellow }),
      progress(x + 148, y + 123, 420, 0.7, C.yellow, "#315657"),
      button(x + w - 170, y + 96, "Новая ссылка", { kind: "signal", w: 146 }),
      metric(x, y + 192, 298, "ВАЛИДНЫЕ", "118"),
      metric(x + 312, y + 192, 298, "СРЕДНИЙ QC", "0.83", { accent: true }),
      metric(x + 624, y + 192, 298, "ЗАВЕРШАЕМОСТЬ", "78%"),
      metric(x + 936, y + 192, 340, "МЕДИАНА", "13:48", { dark: true, mono: true }),
      rect(x, y + 334, 620, 262, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 22, y + 370, "Фокус", { size: 18, weight: 750 }),
      row(x + 22, y + 388, 576, "Проверить мобильные", "18 сессий с плохим светом", { right: "Важно", rightInk: C.red }),
      row(x + 22, y + 450, 576, "Добрать выборку", "Осталось 59", { right: "70%", rightMono: true }),
      rect(x + 634, y + 334, 642, 262, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 656, y + 370, "Устройства", { size: 18, weight: 750 }),
      text(x + 656, y + 416, "Ноутбук", { size: 12, fill: C.muted }),
      progress(x + 750, y + 408, 460, 0.78),
      text(x + 656, y + 470, "Телефон", { size: 12, fill: C.muted }),
      progress(x + 750, y + 462, 460, 0.54, C.orange),
      text(x + 656, y + 524, "Планшет", { size: 12, fill: C.muted }),
      progress(x + 750, y + 516, 460, 0.33)
    ].join("");
  }

  if (id === "R5") {
    const versions = [
      ["Основной", "v3", "Опубликован", "141"],
      ["Пилот-короткий", "v2", "Черновик", "12"],
      ["Пилот", "v1", "Заморожен", "18"]
    ];
    if (mobile) {
      return [
        ...versions.map((item, index) => {
          const yy = y + index * 128;
          return `${rect(x, yy, w, 112, { fill: index === 0 ? C.ink : C.paper, stroke: index === 0 ? C.ink : C.line, sw: 1 })}
            ${text(x + 16, yy + 28, item[1], { size: 11, mono: true, fill: index === 0 ? C.yellow : C.brand })}
            ${text(x + 16, yy + 58, item[0], { size: 17, weight: 700, fill: index === 0 ? C.paper : C.ink })}
            ${text(x + 16, yy + 88, item[2], { size: 12, fill: index === 0 ? "#9BC7C3" : C.muted })}
            ${text(x + w - 16, yy + 88, item[3], { size: 15, mono: true, weight: 700, fill: index === 0 ? C.paper : C.ink, anchor: "end" })}`;
        }),
        rect(x, y + 406, w, 92, { fill: C.yellowSoft }),
        text(x + 16, y + 440, "Версии не перезаписываются", { size: 14, weight: 750 }),
        text(x + 16, y + 466, "Публикация создаёт снимок", { size: 12, fill: C.muted }),
        button(x, 770, "Создать протокол", { kind: "signal", w })
      ].join("");
    }
    return [
      text(x, y + 18, "3 версии", { size: 13, mono: true, fill: C.muted }),
      button(x + w - 158, y, "Создать протокол", { kind: "signal", w: 158 }),
      ...versions.map((item, index) => {
        const yy = y + 72 + index * 128;
        return `${rect(x, yy, w, 108, { fill: index === 0 ? C.ink : C.paper, stroke: index === 0 ? C.ink : C.line, sw: 1 })}
          ${text(x + 24, yy + 42, item[1], { size: 12, mono: true, fill: index === 0 ? C.yellow : C.brand })}
          ${text(x + 148, yy + 64, item[0], { size: 20, weight: 750, fill: index === 0 ? C.paper : C.ink })}
          ${pill(x + 666, yy + 40, item[2], index === 0 ? "success" : "neutral", 126)}
          ${text(x + 990, yy + 64, `${item[3]} сессий`, { size: 13, mono: true, fill: index === 0 ? C.paper : C.ink })}
          ${text(x + w - 24, yy + 64, "Открыть →", { size: 12, weight: 700, fill: index === 0 ? C.paper : C.brand, anchor: "end" })}`;
      }),
      rect(x, y + 472, w, 88, { fill: C.yellowSoft }),
      text(x + 22, y + 508, "Опубликованный протокол неизменяем", { size: 15, weight: 750 }),
      text(x + 22, y + 535, "Редактирование создаёт новую draft-версию.", { size: 12, fill: C.muted })
    ].join("");
  }

  if (id === "R6") {
    if (mobile) {
      const blocks = ["Согласие", "Проверка", "Калибровка", "Шрифтовые пары", "SAM"];
      return [
        text(x, y + 18, "Поток · 14 минут", { size: 13, mono: true, fill: C.muted }),
        ...blocks.map((item, index) => row(x, y + 44 + index * 66, w, `${String(index + 1).padStart(2, "0")}  ${item}`, "", {
          fill: index === 3 ? C.ink : C.paper,
          ink: index === 3 ? C.paper : C.ink,
          right: index === 3 ? "выбран" : "⋮",
          rightInk: index === 3 ? C.yellow : C.muted,
          noLine: true
        })),
        rect(x, y + 392, w, 154, { fill: C.mint }),
        text(x + 16, y + 424, "Шрифтовые пары", { size: 17, weight: 750 }),
        text(x + 16, y + 458, "3000 мс", { size: 13, mono: true, fill: C.brand }),
        text(x + 16, y + 490, "gaze · blinks · emotion · RT", { size: 12, fill: C.ink }),
        text(x + 16, y + 520, "AOI · 2 зоны", { size: 12, weight: 700, fill: C.blue }),
        button(x, 716, "Предпросмотр", { w }),
        button(x, 770, "Опубликовать", { kind: "signal", w })
      ].join("");
    }
    const blocks = ["Согласие", "Проверка устройства", "Калибровка", "Шрифтовые пары", "SAM", "Перерыв"];
    return [
      rect(x, y, 216, 636, { fill: C.ink }),
      text(x + 20, y + 36, "ДОБАВИТЬ", { size: 11, mono: true, fill: "#9BC7C3", spacing: 1 }),
      ...["Инструкция", "Стимулы", "Задача", "Опросник", "SAM"].map((item, index) => `${rect(x + 16, y + 64 + index * 58, 184, 44, { fill: index === 1 ? C.brand : "#174748", r: 9 })}${text(x + 32, y + 92 + index * 58, item, { size: 13, weight: 650, fill: C.paper })}`),
      rect(x + 230, y, 650, 636, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 254, y + 38, "Поток · 14 минут", { size: 16, weight: 750 }),
      pill(x + 706, y + 18, "сохранено", "success", 118),
      ...blocks.map((item, index) => row(x + 254, y + 70 + index * 78, 602, `${String(index + 1).padStart(2, "0")}  ${item}`, index === 3 ? "24 стимула · 3000 мс" : "", {
        h: 66,
        fill: index === 3 ? C.ink : C.canvas,
        ink: index === 3 ? C.paper : C.ink,
        metaInk: index === 3 ? "#9BC7C3" : C.muted,
        right: index === 3 ? "выбран" : "⋮",
        rightInk: index === 3 ? C.yellow : C.muted,
        noLine: true
      })),
      rect(x + 894, y, 382, 636, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 918, y + 38, "Шрифтовые пары", { size: 18, weight: 750 }),
      field(x + 918, y + 76, 334, "НАБОР", "Шрифты / Основной"),
      field(x + 918, y + 168, 334, "ВРЕМЯ", "3000 мс", { mono: true }),
      field(x + 918, y + 260, 334, "ОТВЕТ", "Клик"),
      rect(x + 918, y + 356, 334, 128, { fill: C.mint }),
      text(x + 936, y + 390, "Сигналы", { size: 14, weight: 750, fill: C.brand }),
      text(x + 936, y + 420, "gaze · blinks · emotion · RT", { size: 12, fill: C.ink }),
      text(x + 936, y + 454, "AOI · 2 зоны", { size: 12, weight: 700, fill: C.blue }),
      button(x + 918, y + 502, "Предпросмотр", { w: 334 }),
      button(x + 918, y + 558, "Опубликовать", { kind: "signal", w: 334 })
    ].join("");
  }

  if (id === "R7") {
    if (mobile) {
      return [
        rect(x, y, w, 122, { fill: C.ink }),
        text(x + 16, y + 30, "ОСНОВНАЯ ССЫЛКА", { size: 10, mono: true, fill: "#9BC7C3" }),
        text(x + 16, y + 66, "wecog.ru/i/WEC-014-A", { size: 13, mono: true, fill: C.paper }),
        button(x + 16, y + 78, "Копировать", { w: 118 }),
        metric(x, y + 138, 172, "ПЕРЕХОДЫ", "184"),
        metric(x + 182, y + 138, 172, "ЗАВЕРШИЛИ", "141", { accent: true }),
        text(x, y + 296, "Последние", { size: 18, weight: 750 }),
        row(x, y + 314, w, "P-7Q31", "S-1042 · ноутбук", { right: "0.91", rightMono: true }),
        row(x, y + 376, w, "P-7Q30", "S-1041 · телефон", { right: "0.42", rightInk: C.red, rightMono: true }),
        row(x, y + 438, w, "P-7Q29", "S-1040 · прервана", { right: "—", rightMono: true }),
        button(x, 770, "Новая ссылка", { kind: "signal", w })
      ].join("");
    }
    return [
      rect(x, y, w, 114, { fill: C.ink }),
      text(x + 24, y + 32, "ОСНОВНАЯ ССЫЛКА", { size: 10, mono: true, fill: "#9BC7C3", spacing: 1 }),
      text(x + 24, y + 72, "wecog.ru/invite/WEC-014-A", { size: 17, mono: true, fill: C.paper }),
      button(x + w - 156, y + 35, "Копировать", { kind: "signal", w: 132 }),
      metric(x, y + 130, 298, "ПЕРЕХОДЫ", "184"),
      metric(x + 312, y + 130, 298, "СОГЛАСИЕ", "166"),
      metric(x + 624, y + 130, 298, "НАЧАЛИ", "151"),
      metric(x + 936, y + 130, 340, "ЗАВЕРШИЛИ", "141", { accent: true }),
      text(x, y + 296, "Последние прохождения", { size: 18, weight: 750 }),
      row(x, y + 320, w, "P-7Q31  ·  S-1042", "ноутбук · 12 мин назад", { right: "QC 0.91", rightMono: true }),
      row(x, y + 382, w, "P-7Q30  ·  S-1041", "телефон · 40 мин назад", { right: "QC 0.42", rightInk: C.red, rightMono: true }),
      row(x, y + 444, w, "P-7Q29  ·  S-1040", "ноутбук · 1 ч назад", { right: "прервана", rightInk: C.muted })
    ].join("");
  }

  if (id === "R8") {
    if (mobile) {
      return [
        metric(x, y, 172, "СЕЙЧАС", "6", { dark: true }),
        metric(x + 182, y, 172, "INVALID", "2", { accent: true }),
        rect(x, y + 138, w, 236, { fill: C.ink }),
        text(x + 16, y + 172, "6 часов", { size: 13, mono: true, fill: "#9BC7C3" }),
        sparkline(x + 16, y + 208, w - 32, 118, [21, 30, 38, 46, 40, 58, 65, 54, 70], { color: C.yellow, soft: "#174748", grid: "#315657" }),
        text(x, y + 420, "Причины QC", { size: 18, weight: 750 }),
        row(x, y + 438, w, "Плохой свет", "", { right: "33%", rightMono: true }),
        row(x, y + 500, w, "Потеря лица", "", { right: "21%", rightMono: true }),
        row(x, y + 562, w, "Низкий FPS", "", { right: "17%", rightMono: true }),
        rect(x, y + 650, w, 70, { fill: C.orangeSoft }),
        text(x + 16, y + 680, "Low confidence не рисуется", { size: 13, weight: 750, fill: C.red }),
        text(x + 16, y + 704, "Сохраняется как событие", { size: 11, fill: C.ink })
      ].join("");
    }
    return [
      metric(x, y, 298, "СЕЙЧАС", "6", { dark: true }),
      metric(x + 312, y, 298, "ЗАВЕРШИЛИ СЕГОДНЯ", "24"),
      metric(x + 624, y, 298, "ПОГРАНИЧНЫЙ QC", "5"),
      metric(x + 936, y, 340, "INVALID", "2", { accent: true }),
      rect(x, y + 142, 790, 396, { fill: C.ink }),
      text(x + 24, y + 180, "Поток · 6 часов", { size: 18, weight: 750, fill: C.paper }),
      text(x + 742, y + 180, "30 мин", { size: 11, mono: true, fill: "#9BC7C3", anchor: "end" }),
      sparkline(x + 24, y + 232, 742, 230, [21, 30, 38, 46, 40, 58, 65, 54, 70, 76], { color: C.yellow, soft: "#174748", grid: "#315657" }),
      rect(x + 804, y + 142, 472, 396, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 828, y + 180, "Причины QC", { size: 18, weight: 750 }),
      row(x + 828, y + 202, 424, "Плохой свет", "", { right: "33%", rightMono: true }),
      row(x + 828, y + 264, 424, "Потеря лица", "", { right: "21%", rightMono: true }),
      row(x + 828, y + 326, 424, "Низкий FPS", "", { right: "17%", rightMono: true }),
      row(x + 828, y + 388, 424, "Вне viewport", "", { right: "12%", rightMono: true }),
      rect(x, y + 552, w, 72, { fill: C.orangeSoft }),
      text(x + 20, y + 584, "Low confidence и off-screen не притягиваются к цели", { size: 15, weight: 750, fill: C.red }),
      text(x + w - 20, y + 584, "технические события", { size: 12, mono: true, fill: C.ink, anchor: "end" })
    ].join("");
  }

  if (id === "R9") {
    if (mobile) {
      return [
        metric(x, y, 172, "ВЫБОРКА", "118", { dark: true }),
        metric(x + 182, y, 172, "ON TARGET", "72%", { accent: true }),
        pill(x, y + 134, "valid only", "success", 96),
        pill(x + 106, y + 134, "AOI A/B", "accent", 88),
        heatmapPanel(x, y + 176, w, 316, true),
        metric(x, y + 508, 172, "BLINKS", "17.4"),
        metric(x + 182, y + 508, 172, "RT", "418", { mono: true }),
        rect(x, y + 642, w, 66, { fill: C.blueSoft }),
        text(x + 16, y + 670, "118 валидных сессий", { size: 13, weight: 750, fill: C.blue }),
        text(x + 16, y + 693, "low confidence исключён", { size: 10, fill: C.ink }),
        button(x, 770, "Экспорт", { kind: "signal", w })
      ].join("");
    }
    return [
      metric(x, y, 298, "В ВЫБОРКЕ", "118", { dark: true }),
      metric(x + 312, y, 298, "GAZE ON TARGET", "72%", { accent: true }),
      metric(x + 624, y, 298, "BLINKS / МИН", "17.4"),
      metric(x + 936, y, 340, "RT · МЕДИАНА", "418", { mono: true }),
      pill(x, y + 136, "valid only", "success", 100),
      pill(x + 112, y + 136, "AOI A/B", "accent", 94),
      pill(x + 218, y + 136, "Основной · v3", "neutral", 132),
      heatmapPanel(x, y + 178, 790, 410),
      rect(x + 804, y + 178, 472, 410, { fill: C.ink }),
      text(x + 828, y + 216, "Контекст данных", { size: 18, weight: 750, fill: C.paper }),
      metric(x + 828, y + 246, 200, "VALID", "118", { accent: true, h: 108 }),
      metric(x + 1040, y + 246, 188, "ИСКЛЮЧЕНО", "23", { h: 108 }),
      text(x + 828, y + 398, "СЛОИ", { size: 10, mono: true, fill: "#9BC7C3", spacing: 1 }),
      pill(x + 828, y + 418, "gaze", "success", 76),
      pill(x + 916, y + 418, "engagement", "accent", 108),
      pill(x + 1036, y + 418, "valence", "discovery", 88),
      multiline(x + 828, y + 486, ["gaze v3 · emotion v2", "qc contract 1.0"], { size: 12, mono: true, fill: "#9BC7C3", gap: 24 }),
      button(x + 828, y + 526, "Экспорт", { kind: "signal", w: 400 })
    ].join("");
  }

  if (id === "R10") {
    if (mobile) {
      return [
        metric(x, y, 172, "QC", "0.91", { dark: true }),
        metric(x + 182, y, 172, "BLINKS", "19", { accent: true }),
        rect(x, y + 138, w, 224, { fill: C.ink }),
        text(x + 16, y + 172, "Gaze confidence", { size: 14, weight: 700, fill: C.paper }),
        sparkline(x + 16, y + 214, w - 32, 100, [92, 88, 84, 91, 76, 43, 71, 86, 90], { color: C.yellow, soft: "#174748", grid: "#315657" }),
        text(x, y + 408, "Качество", { size: 18, weight: 750 }),
        row(x, y + 426, w, "Лицо в кадре", "", { right: "96%", rightMono: true }),
        row(x, y + 488, w, "Положение головы", "", { right: "06:42", rightInk: C.orange, rightMono: true }),
        row(x, y + 550, w, "Off-screen", "", { right: "18 сек", rightMono: true }),
        rect(x, y + 638, w, 82, { fill: C.orangeSoft }),
        text(x + 16, y + 670, "Low confidence исключён", { size: 13, weight: 750, fill: C.red }),
        text(x + 16, y + 696, "из heatmap", { size: 12, fill: C.ink })
      ].join("");
    }
    return [
      metric(x, y, 298, "QC SCORE", "0.91", { dark: true }),
      metric(x + 312, y, 298, "ДЛИТЕЛЬНОСТЬ", "14:12", { mono: true }),
      metric(x + 624, y, 298, "VALID GAZE", "88%"),
      metric(x + 936, y, 340, "BLINKS", "19", { accent: true }),
      rect(x, y + 142, 790, 426, { fill: C.ink }),
      text(x + 24, y + 180, "Таймлайн", { size: 18, weight: 750, fill: C.paper }),
      text(x + 24, y + 224, "Gaze confidence", { size: 11, mono: true, fill: "#9BC7C3" }),
      sparkline(x + 24, y + 252, 742, 120, [92, 88, 84, 91, 76, 43, 71, 86, 90, 88], { color: C.yellow, soft: "#174748", grid: "#315657" }),
      text(x + 24, y + 414, "Engagement proxy", { size: 11, mono: true, fill: "#9BC7C3" }),
      sparkline(x + 24, y + 438, 742, 76, [54, 61, 58, 69, 72, 66, 74, 70], { color: C.brand2, soft: "#174748", grid: "#315657" }),
      rect(x + 804, y + 142, 472, 426, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 828, y + 180, "Качество", { size: 18, weight: 750 }),
      row(x + 828, y + 202, 424, "Лицо в кадре", "", { right: "96%", rightMono: true }),
      row(x + 828, y + 264, 424, "Освещение", "", { right: "valid", rightInk: C.brand }),
      row(x + 828, y + 326, 424, "Положение головы", "", { right: "06:42", rightInk: C.orange, rightMono: true }),
      row(x + 828, y + 388, 424, "Off-screen", "", { right: "18 сек", rightMono: true }),
      rect(x + 828, y + 470, 424, 70, { fill: C.orangeSoft }),
      text(x + 846, y + 501, "Low confidence исключён из heatmap", { size: 13, weight: 750, fill: C.red })
    ].join("");
  }

  if (id === "R11") {
    const team = [["ВФ", "Валерия", "владелец"], ["А", "Анна", "редактор"], ["Ю", "Юлия", "администратор"]];
    if (mobile) {
      return [
        text(x, y + 18, "Команда", { size: 18, weight: 750 }),
        ...team.map((item, index) => `${circle(x + 22, y + 64 + index * 62, 20, index === 0 ? C.ink : C.mint)}${text(x + 22, y + 68 + index * 62, item[0], { size: 11, weight: 800, fill: index === 0 ? C.paper : C.brand, anchor: "middle" })}${text(x + 54, y + 60 + index * 62, item[1], { size: 14, weight: 700 })}${text(x + 54, y + 80 + index * 62, item[2], { size: 11, fill: C.muted })}`),
        line(x, y + 264, x + w, y + 264),
        text(x, y + 310, "Данные", { size: 18, weight: 750 }),
        field(x, y + 338, w, "СОГЛАСИЕ", "RU v1.2"),
        field(x, y + 430, w, "ХРАНЕНИЕ", "90 дней"),
        rect(x, y + 540, w, 90, { fill: C.mint }),
        text(x + 16, y + 574, "Raw media выключено", { size: 14, weight: 750, fill: C.brand }),
        text(x + 16, y + 600, "По умолчанию", { size: 12, fill: C.ink })
      ].join("");
    }
    return [
      rect(x, y, 620, 540, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 24, y + 40, "Команда", { size: 20, weight: 750 }),
      ...team.map((item, index) => `${circle(x + 48, y + 104 + index * 82, 24, index === 0 ? C.ink : C.mint)}${text(x + 48, y + 108 + index * 82, item[0], { size: 12, weight: 800, fill: index === 0 ? C.paper : C.brand, anchor: "middle" })}${text(x + 88, y + 98 + index * 82, item[1], { size: 15, weight: 700 })}${text(x + 88, y + 122 + index * 82, item[2], { size: 12, fill: C.muted })}${line(x + 24, y + 144 + index * 82, x + 596, y + 144 + index * 82)}`),
      button(x + 24, y + 458, "Пригласить", { w: 146 }),
      rect(x + 634, y, 642, 540, { fill: C.ink }),
      text(x + 658, y + 40, "Данные", { size: 20, weight: 750, fill: C.paper }),
      field(x + 658, y + 82, 594, "СОГЛАСИЕ", "RU v1.2 · 21.07.2026"),
      field(x + 658, y + 174, 594, "ХРАНЕНИЕ", "90 дней"),
      rect(x + 658, y + 292, 594, 112, { fill: C.mint }),
      text(x + 680, y + 332, "Raw media выключено", { size: 16, weight: 750, fill: C.brand }),
      text(x + 680, y + 362, "Debug capture требует feature flag и согласие", { size: 12, fill: C.ink }),
      button(x + 658, y + 458, "Сохранить", { kind: "signal", w: 594 })
    ].join("");
  }

  if (id === "R12") {
    const items = [["SH-001", "Шрифтовая пара"], ["NW-014", "Новостная карточка"], ["VPC-021", "Лев"], ["VPC-022", "Рысь"], ["RT-003", "Инструкция RT"], ["BG-002", "Фон"]];
    if (mobile) {
      return [
        field(x, y, w, "ПОИСК", "Название или ID"),
        ...items.slice(0, 4).map((item, index) => {
          const yy = y + 92 + index * 128;
          return `${rect(x, yy, w, 112, { fill: index === 2 ? C.ink : C.paper, stroke: index === 2 ? C.ink : C.line, sw: 1 })}${rect(x + 12, yy + 12, 88, 88, { fill: index === 2 ? C.brand : C.mint, r: 10 })}${text(x + 56, yy + 61, item[0].slice(0, 2), { size: 13, mono: true, weight: 700, fill: index === 2 ? C.paper : C.brand, anchor: "middle" })}${text(x + 118, yy + 48, item[1], { size: 15, weight: 700, fill: index === 2 ? C.paper : C.ink })}${text(x + 118, yy + 74, item[0], { size: 11, mono: true, fill: index === 2 ? "#9BC7C3" : C.muted })}`;
        }),
        button(x, 770, "Загрузить", { kind: "signal", w })
      ].join("");
    }
    return [
      field(x, y, 510, "ПОИСК", "Название или ID"),
      button(x + w - 132, y + 18, "Загрузить", { kind: "signal", w: 132 }),
      ...items.map((item, index) => {
        const col = index % 3;
        const rowIndex = Math.floor(index / 3);
        const xx = x + col * 430;
        const yy = y + 104 + rowIndex * 246;
        const active = index === 2;
        return `${rect(xx, yy, 414, 224, { fill: active ? C.ink : C.paper, stroke: active ? C.ink : C.line, sw: 1 })}${rect(xx + 14, yy + 14, 386, 130, { fill: active ? C.brand : index % 2 ? C.yellowSoft : C.mint, r: 10 })}${text(xx + 207, yy + 86, item[0], { size: 13, mono: true, weight: 700, fill: active ? C.paper : C.brand, anchor: "middle" })}${text(xx + 18, yy + 180, item[1], { size: 17, weight: 750, fill: active ? C.paper : C.ink })}${text(xx + 18, yy + 204, item[0], { size: 11, mono: true, fill: active ? "#9BC7C3" : C.muted })}`;
      })
    ].join("");
  }

  if (id === "R13") {
    const items = [["T-01", "VPC", "10–15 мин"], ["T-02", "Gaze drawing", "5–8 мин"], ["T-03", "Simple RT", "4–6 мин"], ["T-04", "Пассивный просмотр", "8–12 мин"], ["T-05", "Визуальный поиск", "6–10 мин"], ["T-06", "Пустой", "—"]];
    if (mobile) {
      return items.slice(0, 5).map((item, index) => {
        const yy = y + index * 118;
        return `${rect(x, yy, w, 102, { fill: index === 0 ? C.ink : C.paper, stroke: index === 0 ? C.ink : C.line, sw: 1 })}${text(x + 16, yy + 28, item[0], { size: 11, mono: true, fill: index === 0 ? C.yellow : C.brand })}${text(x + 16, yy + 60, item[1], { size: 16, weight: 750, fill: index === 0 ? C.paper : C.ink })}${text(x + w - 16, yy + 60, item[2], { size: 12, mono: true, fill: index === 0 ? "#9BC7C3" : C.muted, anchor: "end" })}`;
      }).join("");
    }
    return items.map((item, index) => {
      const col = index % 3;
      const rowIndex = Math.floor(index / 3);
      const xx = x + col * 430;
      const yy = y + rowIndex * 280;
      const active = index === 0;
      return `${rect(xx, yy, 414, 254, { fill: active ? C.ink : C.paper, stroke: active ? C.ink : C.line, sw: 1 })}${text(xx + 22, yy + 38, item[0], { size: 11, mono: true, fill: active ? C.yellow : C.brand })}${text(xx + 22, yy + 96, item[1], { size: 22, weight: 800, fill: active ? C.paper : C.ink })}${text(xx + 22, yy + 132, item[2], { size: 12, mono: true, fill: active ? "#9BC7C3" : C.muted })}${line(xx + 22, yy + 174, xx + 392, yy + 174, active ? "#315657" : C.line)}${text(xx + 22, yy + 214, "Создать →", { size: 13, weight: 750, fill: active ? C.paper : C.brand })}`;
    }).join("");
  }

  if (id === "R14") {
    if (mobile) {
      return [
        rect(x, y, w, 202, { fill: C.ink }),
        text(x + 18, y + 34, "RESEARCH", { size: 11, mono: true, fill: "#9BC7C3" }),
        text(x + 18, y + 92, "20 000 ₽", { size: 34, weight: 800, fill: C.paper }),
        text(x + 18, y + 122, "в месяц", { size: 12, fill: "#9BC7C3" }),
        button(x + 18, y + 142, "Изменить", { kind: "signal", w: 150 }),
        text(x, y + 252, "Использование", { size: 18, weight: 750 }),
        text(x, y + 296, "Сессии", { size: 13, weight: 700 }),
        text(x + w, y + 296, "1 742 / 2 000", { size: 12, mono: true, anchor: "end" }),
        progress(x, y + 312, w, 0.87, C.orange),
        text(x, y + 364, "Хранилище", { size: 13, weight: 700 }),
        text(x + w, y + 364, "4.2 / 20 GB", { size: 12, mono: true, anchor: "end" }),
        progress(x, y + 380, w, 0.21),
        text(x, y + 432, "Команда", { size: 13, weight: 700 }),
        text(x + w, y + 432, "4 / 10", { size: 12, mono: true, anchor: "end" }),
        progress(x, y + 448, w, 0.4)
      ].join("");
    }
    return [
      rect(x, y, 420, 530, { fill: C.ink }),
      text(x + 26, y + 44, "RESEARCH", { size: 12, mono: true, fill: "#9BC7C3", spacing: 1 }),
      text(x + 26, y + 116, "20 000 ₽", { size: 42, weight: 800, fill: C.paper }),
      text(x + 26, y + 150, "в месяц", { size: 13, fill: "#9BC7C3" }),
      rect(x + 26, y + 194, 90, 7, { r: 3.5, fill: C.orange }),
      multiline(x + 26, y + 256, ["2 000 сессий", "20 GB", "10 участников"], { size: 16, weight: 650, fill: C.paper, gap: 44 }),
      button(x + 26, y + 452, "Изменить", { kind: "signal", w: 368 }),
      rect(x + 434, y, 842, 530, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(x + 460, y + 44, "Использование · июль", { size: 20, weight: 750 }),
      text(x + 460, y + 118, "Сессии", { size: 14, weight: 700 }),
      text(x + 1248, y + 118, "1 742 / 2 000", { size: 13, mono: true, anchor: "end" }),
      progress(x + 460, y + 138, 788, 0.87, C.orange),
      text(x + 460, y + 218, "Хранилище", { size: 14, weight: 700 }),
      text(x + 1248, y + 218, "4.2 / 20 GB", { size: 13, mono: true, anchor: "end" }),
      progress(x + 460, y + 238, 788, 0.21),
      text(x + 460, y + 318, "Команда", { size: 14, weight: 700 }),
      text(x + 1248, y + 318, "4 / 10", { size: 13, mono: true, anchor: "end" }),
      progress(x + 460, y + 338, 788, 0.4),
      rect(x + 460, y + 402, 788, 82, { fill: C.yellowSoft }),
      text(x + 482, y + 436, "87% лимита", { size: 16, weight: 750 }),
      text(x + 482, y + 462, "Повышение лимита не прерывает сбор", { size: 12, fill: C.muted })
    ].join("");
  }

  return "";
}

function participantChrome(width, height, step, id) {
  const mobile = width === 390;
  const margin = mobile ? 18 : 40;
  const progressWidth = mobile ? 220 : 360;
  return [
    rect(0, 0, width, mobile ? 66 : 82, { r: 0, fill: C.paper }),
    circle(margin + 6, mobile ? 24 : 34, 8, C.brand),
    text(margin + 24, mobile ? 29 : 39, "WEC", { size: 12, weight: 800, spacing: 1 }),
    progress(width - margin - progressWidth, mobile ? 22 : 30, progressWidth, step / 7, C.brand, "#DCE7E4"),
    text(width - margin, mobile ? 50 : 62, `${step}/7`, { size: 10, mono: true, fill: C.muted, anchor: "end" }),
    text(margin, height - 24, id, { size: 10, mono: true, fill: C.muted })
  ].join("");
}

function participantScreen(id, title, kind, mobile) {
  const width = mobile ? 390 : 1440;
  const height = mobile ? 844 : 900;
  const step = Math.min(7, Number(id.slice(1)) || 1);
  const cardX = mobile ? 18 : 310;
  const cardY = mobile ? 92 : 124;
  const cardW = mobile ? 354 : 820;
  const cardH = mobile ? 680 : 650;
  let body = participantChrome(width, height, step, id);

  const heading = (headline, accentLine) => [
    text(cardX, cardY + 34, id, { size: 10, mono: true, weight: 700, fill: C.brand, spacing: 1 }),
    multiline(cardX, cardY + 92, headline, {
      size: mobile ? 28 : 38,
      weight: 800,
      fill: C.ink,
      gap: mobile ? 34 : 46
    }),
    accentLine ? rect(cardX, cardY + (mobile ? 128 : 150), 72, 7, { r: 3.5, fill: C.blue }) : ""
  ].join("");

  if (kind === "invite") {
    body += heading(mobile ? ["Исследование", "восприятия"] : ["Исследование восприятия"], true);
    if (mobile) {
      body += [
        text(cardX, cardY + 178, "14 минут", { size: 16, weight: 750 }),
        text(cardX, cardY + 214, "Камера · локальная обработка", { size: 13, fill: C.muted }),
        text(cardX, cardY + 246, "Можно остановиться", { size: 13, fill: C.muted }),
        button(cardX, cardY + 328, "Начать", { kind: "signal", w: cardW })
      ].join("");
    } else {
      body += [
        metric(cardX, cardY + 198, 250, "ВРЕМЯ", "14 мин", { dark: true }),
        metric(cardX + 266, cardY + 198, 250, "КАМЕРА", "локально"),
        metric(cardX + 532, cardY + 198, 288, "ВЫХОД", "в любой момент", { accent: true, size: 22 }),
        button(cardX, cardY + 360, "Начать", { kind: "signal", w: cardW })
      ].join("");
    }
  }

  if (kind === "consent") {
    body += heading(mobile ? ["Согласие"] : ["Условия участия"], true);
    const items = ["Положение лица и глаз", "Моргания и реакции", "Ответы и RT"];
    body += [
      ...items.map((item, index) => `${circle(cardX + 8, cardY + (mobile ? 174 : 210) + index * 42, 5, C.brand)}${text(cardX + 24, cardY + (mobile ? 179 : 215) + index * 42, item, { size: mobile ? 13 : 15, weight: 650 })}`),
      rect(cardX, cardY + (mobile ? 310 : 370), cardW, mobile ? 106 : 98, { fill: C.mint }),
      circle(cardX + 24, cardY + (mobile ? 340 : 400), 10, C.brand),
      text(cardX + 24, cardY + (mobile ? 344 : 404), "✓", { size: 12, weight: 800, fill: C.paper, anchor: "middle" }),
      text(cardX + 48, cardY + (mobile ? 344 : 404), "Я согласен(на) участвовать", { size: mobile ? 13 : 15, weight: 700 }),
      text(cardX + 48, cardY + (mobile ? 374 : 434), "Видео не сохраняется", { size: 11, fill: C.muted }),
      mobile
        ? button(cardX, cardY + 454, "Продолжить", { kind: "signal", w: cardW })
        : button(cardX + 256, cardY + 500, "Продолжить", { kind: "signal", w: cardW - 256 }),
      mobile
        ? text(cardX + cardW / 2, cardY + 532, "Отказаться и выйти", { size: 12, weight: 700, fill: C.red, anchor: "middle" })
        : button(cardX, cardY + 500, "Отказаться", { w: 240 })
    ].join("");
  }

  if (kind === "device") {
    body += heading(mobile ? ["Проверка", "устройства"] : ["Проверка устройства"], false);
    const checks = [["Камера", "разрешена"], ["Освещение", "готово"], ["Задержка", "74 мс"]];
    body += checks.map((item, index) => {
      const yy = cardY + (mobile ? 174 : 184) + index * (mobile ? 80 : 92);
      return `${rect(cardX, yy, cardW, mobile ? 64 : 76, { fill: index === 0 ? C.ink : C.paper, stroke: index === 0 ? C.ink : C.line, sw: 1 })}${circle(cardX + 24, yy + (mobile ? 32 : 38), 8, index === 0 ? C.yellow : C.brand)}${text(cardX + 46, yy + (mobile ? 28 : 34), item[0], { size: 15, weight: 750, fill: index === 0 ? C.paper : C.ink })}${text(cardX + cardW - 18, yy + (mobile ? 40 : 46), item[1], { size: 12, mono: true, fill: index === 0 ? "#9BC7C3" : C.muted, anchor: "end" })}`;
    }).join("");
    body += button(cardX, cardY + (mobile ? 442 : 486), "Продолжить", { kind: "signal", w: cardW });
  }

  if (kind === "calibration") {
    body += heading(mobile ? ["Следите", "за точкой"] : ["Следите за точкой"], false);
    const areaY = cardY + (mobile ? 158 : 162);
    const areaH = mobile ? 310 : 354;
    body += [
      rect(cardX, areaY, cardW, areaH, { fill: C.ink }),
      circle(cardX + cardW * 0.72, areaY + areaH * 0.34, mobile ? 15 : 18, C.blue),
      circle(cardX + cardW * 0.72, areaY + areaH * 0.34, mobile ? 27 : 32, "none", C.blueSoft, 2),
      text(cardX + 18, areaY + 30, "2 / 9", { size: 11, mono: true, fill: "#9BC7C3" }),
      text(cardX + cardW - 18, areaY + areaH - 20, "не кликайте", { size: 11, fill: "#9BC7C3", anchor: "end" }),
      button(cardX, cardY + (mobile ? 506 : 548), "Проверить точность", { kind: "signal", w: cardW })
    ].join("");
  }

  if (kind === "instruction") {
    body += heading(mobile ? ["Сравните", "два варианта"] : ["Сравните два варианта"], true);
    body += [
      multiline(cardX, cardY + (mobile ? 188 : 218), mobile ? ["Смотрите свободно.", "Затем выберите один."] : ["Смотрите свободно. Затем выберите один вариант."], { size: mobile ? 15 : 18, weight: 650, gap: 28 }),
      rect(cardX, cardY + (mobile ? 276 : 306), cardW, mobile ? 116 : 108, { fill: C.ink }),
      text(cardX + 18, cardY + (mobile ? 310 : 342), "Нет красной точки", { size: mobile ? 14 : 16, weight: 750, fill: C.paper }),
      text(cardX + 18, cardY + (mobile ? 342 : 376), "Off-screen сохраняется как событие", { size: 11, fill: "#9BC7C3" }),
      button(cardX, cardY + (mobile ? 432 : 468), "К заданию", { kind: "signal", w: cardW })
    ].join("");
  }

  if (kind === "task") {
    body += text(cardX, cardY + 22, "Какой вариант подходит новостям?", { size: mobile ? 17 : 24, weight: 800 });
    const boxY = cardY + (mobile ? 54 : 76);
    const boxW = mobile ? cardW : 396;
    const boxH = mobile ? 196 : 360;
    const secondX = mobile ? cardX : cardX + 424;
    const secondY = mobile ? boxY + 212 : boxY;
    body += [
      rect(cardX, boxY, boxW, boxH, { fill: C.paper, stroke: C.line, sw: 1 }),
      text(cardX + 18, boxY + 30, "A", { size: 11, mono: true, fill: C.brand }),
      text(cardX + 18, boxY + (mobile ? 104 : 180), "Городские новости", { size: mobile ? 23 : 30, weight: 700, fill: C.ink }),
      rect(secondX, secondY, boxW, boxH, { fill: C.ink }),
      text(secondX + 18, secondY + 30, "B", { size: 11, mono: true, fill: C.yellow }),
      text(secondX + 18, secondY + (mobile ? 104 : 180), "ГОРОДСКИЕ", { size: mobile ? 22 : 30, weight: 800, fill: C.paper, spacing: -0.8 }),
      text(secondX + 18, secondY + (mobile ? 132 : 216), "НОВОСТИ", { size: mobile ? 22 : 30, weight: 800, fill: C.paper, spacing: -0.8 }),
      button(cardX, cardY + (mobile ? 504 : 476), "Подтвердить", { kind: "signal", w: cardW })
    ].join("");
  }

  if (kind === "final") {
    body += [
      circle(cardX + (mobile ? 34 : 52), cardY + 56, mobile ? 28 : 38, C.brand),
      text(cardX + (mobile ? 34 : 52), cardY + (mobile ? 64 : 66), "✓", { size: mobile ? 26 : 34, weight: 800, fill: C.paper, anchor: "middle" }),
      multiline(cardX, cardY + (mobile ? 132 : 154), mobile ? ["Результат", "сохранён"] : ["Результат сохранён"], { size: mobile ? 30 : 40, weight: 800, gap: 36 }),
      rect(cardX, cardY + (mobile ? 238 : 244), cardW, mobile ? 114 : 126, { fill: C.ink }),
      text(cardX + 18, cardY + (mobile ? 274 : 284), "МОРГАНИЯ", { size: 10, mono: true, fill: "#9BC7C3" }),
      text(cardX + 18, cardY + (mobile ? 326 : 338), "19", { size: 34, weight: 800, fill: C.yellow }),
      text(cardX + cardW - 18, cardY + (mobile ? 326 : 338), "WEC-8F2K", { size: 18, mono: true, weight: 700, fill: C.paper, anchor: "end" }),
      text(cardX, cardY + (mobile ? 404 : 420), "Камера выключена", { size: 14, weight: 750, fill: C.brand }),
      text(cardX, cardY + (mobile ? 434 : 450), "Данные загружены", { size: 12, fill: C.muted })
    ].join("");
  }

  if (kind === "edge") {
    body += [
      rect(cardX, cardY, cardW, mobile ? 208 : 250, { fill: C.red }),
      text(cardX + 20, cardY + 42, "P8", { size: 11, mono: true, fill: C.redSoft }),
      multiline(cardX + 20, cardY + (mobile ? 94 : 112), mobile ? ["Камера", "недоступна"] : ["Камера недоступна"], { size: mobile ? 30 : 42, weight: 800, fill: C.paper, gap: 38 }),
      text(cardX, cardY + (mobile ? 260 : 316), "1. Закройте другое приложение", { size: mobile ? 14 : 17, weight: 650 }),
      text(cardX, cardY + (mobile ? 302 : 360), "2. Разрешите доступ в браузере", { size: mobile ? 14 : 17, weight: 650 }),
      text(cardX, cardY + (mobile ? 344 : 404), "3. Повторите проверку", { size: mobile ? 14 : 17, weight: 650 }),
      button(cardX, cardY + (mobile ? 402 : 472), "Повторить", { kind: "signal", w: cardW })
    ].join("");
  }

  return svgDocument(width, height, `${id} ${title} ${mobile ? "mobile" : "desktop"}`, body);
}

function participantVariantScreen(variant, mobile) {
  const width = mobile ? 390 : 1440;
  const height = mobile ? 844 : 900;
  const cardX = mobile ? 18 : 310;
  const cardY = mobile ? 94 : 124;
  const cardW = mobile ? 354 : 820;
  let id = "P4";
  let step = 4;
  let title = "Проверка точности";
  if (variant === "sam") {
    id = "P6b";
    step = 6;
    title = "SAM";
  } else if (variant === "phone") {
    id = "P8b";
    step = 3;
    title = "Неподдерживаемый экран";
  } else if (variant === "offline") {
    id = "P8c";
    step = 7;
    title = "Ожидает загрузки";
  } else if (variant === "validation-retry") {
    id = "P4b";
    title = "Повторная калибровка";
  } else {
    id = "P4a";
  }

  let body = participantChrome(width, height, step, id);

  if (variant === "validation-pass") {
    body += [
      text(cardX, cardY + 28, "ПРОВЕРКА · 5 ТОЧЕК", { size: 10, mono: true, fill: C.brand, spacing: 1 }),
      text(cardX, cardY + 82, "Точность достаточна", { size: mobile ? 27 : 38, weight: 800 }),
      rect(cardX, cardY + 120, cardW, mobile ? 252 : 300, { fill: C.ink }),
      ...[[0.18,0.25],[0.72,0.2],[0.5,0.48],[0.22,0.75],[0.78,0.72]].map(([px,py], index) => {
        const panelY = cardY + 120;
        const panelH = mobile ? 252 : 300;
        const cx = cardX + cardW * px;
        const cy = panelY + panelH * py;
        return `${circle(cx, cy, mobile ? 7 : 9, C.blue)}${circle(cx + (index % 2 ? 5 : -4), cy + 3, mobile ? 3 : 4, C.yellow)}`;
      }),
      metric(cardX, cardY + (mobile ? 390 : 450), mobile ? 170 : 260, "ОШИБКА", "1.6°", { dark: true, h: 104 }),
      metric(cardX + (mobile ? 184 : 278), cardY + (mobile ? 390 : 450), mobile ? 170 : 260, "В ЦЕЛИ", "89%", { accent: true, h: 104 }),
      mobile ? "" : pill(cardX + 556, cardY + 488, "QC pass", "success", 120),
      button(cardX, cardY + (mobile ? 528 : 584), "Продолжить", { kind: "signal", w: cardW })
    ].join("");
  }

  if (variant === "validation-retry") {
    body += [
      rect(cardX, cardY, cardW, mobile ? 188 : 222, { fill: C.red }),
      text(cardX + 20, cardY + 36, "QC · RETRY", { size: 10, mono: true, fill: C.redSoft, spacing: 1 }),
      multiline(cardX + 20, cardY + (mobile ? 88 : 104), mobile ? ["Точность", "ниже порога"] : ["Точность ниже порога"], { size: mobile ? 29 : 40, weight: 800, fill: C.paper, gap: 36 }),
      metric(cardX, cardY + (mobile ? 216 : 258), mobile ? 170 : 260, "ОШИБКА", "4.8°", { h: 104 }),
      metric(cardX + (mobile ? 184 : 278), cardY + (mobile ? 216 : 258), mobile ? 170 : 260, "В ЦЕЛИ", "54%", { accent: true, h: 104 }),
      mobile ? "" : rect(cardX + 556, cardY + 258, 264, 104, { fill: C.orangeSoft }),
      mobile ? "" : multiline(cardX + 574, cardY + 294, ["Проверьте свет", "и положение камеры"], { size: 12, weight: 650, fill: C.orange, gap: 22 }),
      text(cardX, cardY + (mobile ? 370 : 418), "Результат не скрывается и не сглаживается.", { size: mobile ? 12 : 14, weight: 650, fill: C.muted }),
      button(cardX, cardY + (mobile ? 420 : 478), "Проверить устройство", { w: cardW }),
      button(cardX, cardY + (mobile ? 476 : 534), "Повторить калибровку", { kind: "signal", w: cardW })
    ].join("");
  }

  if (variant === "sam") {
    const values = ["1", "2", "3", "4", "5"];
    body += [
      text(cardX, cardY + 30, "ПОСЛЕ ВЫБОРА", { size: 10, mono: true, fill: C.brand, spacing: 1 }),
      text(cardX, cardY + 82, "Ваше впечатление", { size: mobile ? 28 : 38, weight: 800 }),
      text(cardX, cardY + 142, "VALENCE", { size: 11, mono: true, weight: 700, fill: C.muted, spacing: 1 }),
      ...values.map((value, index) => {
        const gap = mobile ? 68 : 124;
        const cx = cardX + 32 + index * gap;
        const cy = cardY + 198;
        const selected = index === 3;
        return `${circle(cx, cy, mobile ? 25 : 34, selected ? C.brand : C.paper, selected ? C.brand : C.lineStrong, 1.5)}${text(cx, cy + 5, value, { size: 14, weight: 800, fill: selected ? C.paper : C.ink, anchor: "middle" })}`;
      }),
      text(cardX, cardY + 278, "AROUSAL", { size: 11, mono: true, weight: 700, fill: C.muted, spacing: 1 }),
      ...values.map((value, index) => {
        const gap = mobile ? 68 : 124;
        const xx = cardX + 8 + index * gap;
        const selected = index === 2;
        return `${rect(xx, cardY + 314, mobile ? 48 : 92, 54, { r: 10, fill: selected ? C.blue : C.paper, stroke: selected ? C.blue : C.lineStrong, sw: 1.5 })}${text(xx + (mobile ? 24 : 46), cardY + 347, value, { size: 14, weight: 800, fill: selected ? C.paper : C.ink, anchor: "middle" })}`;
      }),
      rect(cardX, cardY + 406, cardW, 76, { fill: C.blueSoft }),
      text(cardX + 18, cardY + 438, "Ответ связан со стимулом #12", { size: 13, weight: 700, fill: C.blue }),
      text(cardX + 18, cardY + 462, "в общей временной шкале", { size: 11, fill: C.ink }),
      button(cardX, cardY + 520, "Следующий стимул", { kind: "signal", w: cardW })
    ].join("");
  }

  if (variant === "phone") {
    body += [
      rect(cardX, cardY, cardW, mobile ? 196 : 230, { fill: C.orange }),
      text(cardX + 20, cardY + 38, "DEVICE", { size: 10, mono: true, fill: C.yellowSoft, spacing: 1 }),
      multiline(cardX + 20, cardY + (mobile ? 92 : 106), mobile ? ["Экран", "слишком мал"] : ["Экран слишком мал"], { size: mobile ? 30 : 42, weight: 800, fill: C.paper, gap: 38 }),
      text(cardX, cardY + (mobile ? 252 : 296), "Для этого протокола нужен экран от 1024 px.", { size: mobile ? 13 : 16, weight: 650 }),
      text(cardX, cardY + (mobile ? 288 : 332), "Откройте ссылку на ноутбуке или компьютере.", { size: mobile ? 12 : 14, fill: C.muted }),
      button(cardX, cardY + (mobile ? 358 : 404), "Скопировать ссылку", { kind: "signal", w: cardW }),
      text(cardX + cardW / 2, cardY + (mobile ? 438 : 486), "Выйти", { size: 12, weight: 700, fill: C.red, anchor: "middle" })
    ].join("");
  }

  if (variant === "offline") {
    body += [
      rect(cardX, cardY, cardW, mobile ? 216 : 250, { fill: C.blue }),
      text(cardX + 20, cardY + 38, "PENDING UPLOAD", { size: 10, mono: true, fill: C.blueSoft, spacing: 1 }),
      multiline(cardX + 20, cardY + (mobile ? 96 : 112), mobile ? ["Результат", "сохранён"] : ["Результат сохранён локально"], { size: mobile ? 29 : 40, weight: 800, fill: C.paper, gap: 38 }),
      text(cardX, cardY + (mobile ? 274 : 316), "Камера выключена", { size: 15, weight: 750, fill: C.green }),
      text(cardX, cardY + (mobile ? 312 : 352), "Отправка продолжится после восстановления сети.", { size: mobile ? 12 : 14, fill: C.muted }),
      rect(cardX, cardY + (mobile ? 354 : 400), cardW, 86, { fill: C.blueSoft }),
      text(cardX + 18, cardY + (mobile ? 388 : 436), "Повтор через 24 сек", { size: 14, weight: 750, fill: C.blue }),
      progress(cardX + 18, cardY + (mobile ? 414 : 462), cardW - 36, 0.62, C.blue, C.paper),
      button(cardX, cardY + (mobile ? 484 : 520), "Повторить сейчас", { kind: "signal", w: cardW })
    ].join("");
  }

  return svgDocument(width, height, `${id} ${title} ${mobile ? "mobile" : "desktop"}`, body);
}

function systemStatesScreen(mobile) {
  const width = mobile ? 390 : 1440;
  const height = mobile ? 844 : 900;
  const states = [
    ["Нет данных", "0", "neutral"],
    ["Ошибка", "!", "danger"],
    ["Нет доступа", "○", "warning"],
    ["Low confidence", "≈", "accent"],
    ["Off-screen", "↗", "neutral"],
    ["Degraded", "~", "warning"]
  ];
  let body = mobile ? mobileTop("Состояния", "SYS") : `${iconRail(5)}${desktopHeader("SYS", "Системные состояния")}`;
  const x = mobile ? 18 : 116;
  const y = mobile ? 96 : 136;
  const cardW = mobile ? 354 : 404;
  const cardH = mobile ? 94 : 220;
  body += states.map((item, index) => {
    const col = mobile ? 0 : index % 3;
    const rowIndex = mobile ? index : Math.floor(index / 3);
    const xx = x + col * 436;
    const yy = y + rowIndex * (mobile ? 108 : 246);
    const dark = item[0] === "Low confidence";
    const fill = dark ? C.ink : item[2] === "danger" ? C.redSoft : item[2] === "warning" ? C.yellowSoft : C.paper;
    const ink = dark ? C.paper : C.ink;
    return `${rect(xx, yy, cardW, cardH, { fill, stroke: dark ? C.ink : C.line, sw: 1 })}
      ${circle(xx + (mobile ? 34 : 42), yy + (mobile ? 46 : 50), mobile ? 18 : 22, item[2] === "danger" ? C.red : item[2] === "warning" ? C.yellow : item[0] === "Low confidence" ? C.blue : C.brand)}
      ${text(xx + (mobile ? 34 : 42), yy + (mobile ? 52 : 57), item[1], { size: mobile ? 18 : 22, weight: 800, fill: item[2] === "warning" ? C.ink : C.paper, anchor: "middle" })}
      ${text(xx + (mobile ? 68 : 24), yy + (mobile ? 42 : 104), item[0], { size: mobile ? 15 : 20, weight: 750, fill: ink })}
      ${mobile ? "" : text(xx + 24, yy + 142, item[0] === "Low confidence" ? "Точка не отображается" : item[0] === "Off-screen" ? "Координаты не clamp-ятся" : "Явное техническое состояние", { size: 12, fill: dark ? "#9BC7C3" : C.muted })}
      ${mobile ? text(xx + 68, yy + 67, item[0] === "Low confidence" ? "не рисовать точку" : "техническое состояние", { size: 11, fill: dark ? "#9BC7C3" : C.muted }) : ""}`;
  }).join("");
  return svgDocument(width, height, `Системные состояния ${mobile ? "mobile" : "desktop"}`, body);
}

function designSystemScreen() {
  const body = [
    text(64, 62, "WEC / MINIMAL UI", { size: 12, mono: true, weight: 700, fill: C.brand, spacing: 1.4 }),
    text(64, 116, "Контраст. Действие. Данные.", { size: 38, weight: 800 }),
    rect(64, 152, 98, 8, { r: 4, fill: C.blue }),
    ...Object.entries({
      INK: C.ink,
      BRAND: C.brand,
      DATA: C.blue,
      DANGER: C.red,
      CANVAS: C.canvas,
      SUCCESS: C.green
    }).map(([name, color], index) => {
      const x = 64 + index * 214;
      return `${rect(x, 218, 194, 120, { fill: color, stroke: color === C.paper ? C.line : color, sw: 1 })}${text(x + 16, 306, name, { size: 11, mono: true, weight: 700, fill: [C.ink, C.brand, C.blue, C.red, C.green].includes(color) ? C.paper : C.ink })}`;
    }),
    text(64, 400, "Golos Text", { size: 34, weight: 800 }),
    text(64, 446, "Один экран — одно главное действие", { size: 22, weight: 650 }),
    text(64, 488, "IBM PLEX MONO · QC 0.83 · SESSION S-1042", { size: 13, mono: true, fill: C.brand }),
    button(64, 548, "Продолжить", { kind: "signal", w: 164 }),
    button(244, 548, "Назад", { w: 126 }),
    pill(390, 556, "QC 0.91", "success", 98),
    pill(502, 556, "QC 0.42", "danger", 98),
    field(64, 638, 360, "НАЗВАНИЕ", "Шрифтовые пары"),
    field(444, 638, 360, "ОШИБКА", "Обязательное поле", { error: "Заполните поле" }),
    rect(840, 384, 536, 390, { fill: C.ink }),
    text(872, 430, "Правила", { size: 20, weight: 750, fill: C.paper }),
    multiline(872, 486, [
      "Без декоративных подписей",
      "Не более одного primary action",
      "No data ≠ 0",
      "Low confidence видим",
      "Off-screen не исправляется UI",
      "Контраст WCAG AA"
    ], { size: 15, weight: 650, fill: C.paper, gap: 42 }),
    rect(872, 724, 84, 7, { r: 3.5, fill: C.blue })
  ].join("");
  return svgDocument(1440, 900, "WEC minimal design system", body);
}

async function ensureDirectories() {
  for (const path of [
    join(OUT, "researcher", "desktop"),
    join(OUT, "researcher", "mobile"),
    join(OUT, "participant", "desktop"),
    join(OUT, "participant", "mobile"),
    join(OUT, "system")
  ]) {
    await mkdir(path, { recursive: true });
  }
}

async function generate() {
  await ensureDirectories();
  const manifest = [];
  const actionMap = {
    R2: "Новый проект",
    R5: "Новый протокол",
    R7: "Новая ссылка",
    R9: "Экспорт",
    R12: "Загрузить"
  };

  for (const [id, title, slug] of researcherScreens) {
    for (const mobile of [false, true]) {
      const size = mobile ? "mobile" : "desktop";
      const file = join(OUT, "researcher", size, `${id}-${slug}.svg`);
      const body = researcherBody(id, mobile);
      const svg = researcherShell(id, title, body, {
        mobile,
        action: actionMap[id]
      });
      await writeFile(file, svg);
      manifest.push({ id, title, audience: "researcher", size, file });
    }
  }

  for (const mobile of [false, true]) {
    const size = mobile ? "mobile" : "desktop";
    const file = join(OUT, "researcher", size, "R0b-registration.svg");
    await writeFile(file, registrationScreen(mobile));
    manifest.push({
      id: "R0b",
      title: "Регистрация",
      audience: "researcher",
      size,
      file
    });
  }

  for (const [id, title, kind] of participantScreens) {
    for (const mobile of [false, true]) {
      const size = mobile ? "mobile" : "desktop";
      const file = join(OUT, "participant", size, `${id}-${kind}.svg`);
      await writeFile(file, participantScreen(id, title, kind, mobile));
      manifest.push({ id, title, audience: "participant", size, file });
    }
  }

  const participantVariants = [
    ["P4a", "Валидация пройдена", "validation-pass"],
    ["P4b", "Повторная калибровка", "validation-retry"],
    ["P6b", "SAM", "sam"],
    ["P8b", "Неподдерживаемый экран", "phone"],
    ["P8c", "Ожидает загрузки", "offline"]
  ];
  for (const [id, title, variant] of participantVariants) {
    for (const mobile of [false, true]) {
      const size = mobile ? "mobile" : "desktop";
      const file = join(OUT, "participant", size, `${id}-${variant}.svg`);
      await writeFile(file, participantVariantScreen(variant, mobile));
      manifest.push({ id, title, audience: "participant", size, file });
    }
  }

  await writeFile(join(OUT, "system", "design-system.svg"), designSystemScreen());
  manifest.push({
    id: "DS",
    title: "Дизайн-система",
    audience: "system",
    size: "desktop",
    file: join(OUT, "system", "design-system.svg")
  });
  await writeFile(join(OUT, "system", "states-desktop.svg"), systemStatesScreen(false));
  manifest.push({
    id: "SYS",
    title: "Системные состояния",
    audience: "system",
    size: "desktop",
    file: join(OUT, "system", "states-desktop.svg")
  });
  await writeFile(join(OUT, "system", "states-mobile.svg"), systemStatesScreen(true));
  manifest.push({
    id: "SYS",
    title: "Системные состояния",
    audience: "system",
    size: "mobile",
    file: join(OUT, "system", "states-mobile.svg")
  });

  const relativeManifest = manifest.map(item => ({
    ...item,
    file: item.file.slice(ROOT.length + 1)
  }));
  await writeFile(join(OUT, "manifest.json"), `${JSON.stringify(relativeManifest, null, 2)}\n`);
  process.stdout.write(`Generated ${manifest.length} SVG files.\n`);
}

await generate();
