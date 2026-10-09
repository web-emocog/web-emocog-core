/* Canonical physical response keys, independent of the active keyboard layout. */
(function (root) {
  'use strict';
  const aliases = {
    space: 'Space', ' ': 'Space',
    arrow_up: 'ArrowUp', arrowup: 'ArrowUp',
    arrow_down: 'ArrowDown', arrowdown: 'ArrowDown',
    arrow_left: 'ArrowLeft', arrowleft: 'ArrowLeft',
    arrow_right: 'ArrowRight', arrowright: 'ArrowRight',
    keyz: 'KeyZ', z: 'KeyZ', '\u044f': 'KeyZ',
    keyx: 'KeyX', x: 'KeyX', '\u0447': 'KeyX',
    comma: 'Comma', ',': 'Comma', '\u0431': 'Comma',
    period: 'Period', '.': 'Period', '\u044e': 'Period'
  };
  function normalize(value) {
    return aliases[String(value == null ? '' : value).toLowerCase()] || null;
  }
  function fromEvent(event) {
    if (!event || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
    // Never reinterpret an unrelated physical key through its printed character.
    return normalize(event.code || event.key);
  }
  function label(value) {
    return { KeyZ: '\u042f / Z', KeyX: '\u0427 / X', Comma: '\u0411 / ,', Period: '\u042e / .' }[normalize(value)] || null;
  }
  const api = Object.freeze({ normalize, fromEvent, label });
  root.WecogKeyboardResponses = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
