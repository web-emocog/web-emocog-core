/* Canonical physical response keys, independent of the active keyboard layout. */
(function (root) {
  'use strict';
  const aliases = Object.assign(Object.create(null), {
    space: 'Space', ' ': 'Space',
    arrow_up: 'ArrowUp', arrowup: 'ArrowUp',
    arrow_down: 'ArrowDown', arrowdown: 'ArrowDown',
    arrow_left: 'ArrowLeft', arrowleft: 'ArrowLeft',
    arrow_right: 'ArrowRight', arrowright: 'ArrowRight',
    keyz: 'KeyZ', z: 'KeyZ', '\u044f': 'KeyZ',
    keyx: 'KeyX', x: 'KeyX', '\u0447': 'KeyX',
    comma: 'Comma', ',': 'Comma', '\u0431': 'Comma',
    period: 'Period', '.': 'Period', '\u044e': 'Period'
  });
  const labels = Object.create(null);
  const en = 'qwertyuiopasdfghjklzxcvbnm';
  const ru = '\u0439\u0446\u0443\u043a\u0435\u043d\u0433\u0448\u0449\u0437\u0444\u044b\u0432\u0430\u043f\u0440\u043e\u043b\u0434\u044f\u0447\u0441\u043c\u0438\u0442\u044c';
  function register(code, english, russian) {
    aliases[code.toLowerCase()] = code;
    aliases[english.toLowerCase()] = code;
    if (russian) aliases[russian.toLowerCase()] = code;
    labels[code] = russian ? `${russian.toUpperCase()} / ${english.toUpperCase()}` : english;
  }
  [...en].forEach((letter, index) => register('Key' + letter.toUpperCase(), letter, ru[index]));
  for (let i = 0; i <= 9; i++) {
    register('Digit' + i, String(i));
    aliases['numpad' + i] = 'Numpad' + i;
    labels['Numpad' + i] = 'Numpad ' + i;
  }
  [['Comma', ',', '\u0431'], ['Period', '.', '\u044e'], ['BracketLeft', '[', '\u0445'],
    ['BracketRight', ']', '\u044a'], ['Semicolon', ';', '\u0436'], ['Quote', "'", '\u044d'],
    ['Backquote', '`', '\u0451'], ['Minus', '-'], ['Equal', '='], ['Slash', '/'],
    ['Backslash', '\\']].forEach(parts => register(...parts));
  ['Enter', 'NumpadEnter', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
    'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal']
    .forEach(code => register(code, code));
  function normalize(value) {
    return aliases[String(value == null ? '' : value).toLowerCase()] || null;
  }
  function fromEvent(event) {
    if (!event || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
    // Never reinterpret an unrelated physical key through its printed character.
    return normalize(event.code || event.key);
  }
  function label(value) {
    return labels[normalize(value)] || null;
  }
  const api = Object.freeze({ normalize, fromEvent, label });
  root.WecogKeyboardResponses = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
