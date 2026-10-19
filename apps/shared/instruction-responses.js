(function (root) {
  'use strict';
  function render(text, response, options = {}) {
    const source = String(text || '');
    if (!response) return source;
    if (source.includes('{response}')) return source.replaceAll('{response}', response);
    const named = 'space(?:bar)?|пробел(?:а|ом)?|enter|backspace|delete|home|end|page(?:up|down)|numpad\\s*(?:[0-9]|enter|add|subtract|multiply|divide|decimal)|(?:the\\s+)?(?:up|down|left|right)\\s+arrow(?:\\s+key)?|arrow\\s*(?:up|down|left|right)|стрелк[ауи]\\s+(?:вверх|вниз|влево|вправо)';
    const character = '[a-zа-яё0-9,.;\\[\\]`=\\/\\\\+−-]';
    const token = '[«“"\']?(?:' + named + '|' + character + ')[»”"\']?';
    const key = token + '(?:\\s*/\\s*' + token + '){0,8}';
    const press = new RegExp('(^|[^\\p{L}\\p{N}])(?:нажимайте|нажмите|нажать|жмите|press|hit|tap)\\s+(?:(?:the|a)\\s+)?(?:(?:клавиш[ауи]|кнопк[ауи]|key|button)\\s+)?' + key + '(?=$|[^\\p{L}\\p{N}])', 'giu');
    const actual = options.multiple
      ? (options.lang === 'ru' ? 'используйте схему ответов ниже' : 'use the response mapping below')
      : response;
    return source.replaceAll('{response}', response)
      .replace(press, (match, prefix) => prefix + (/^[A-ZА-ЯЁ]/u.test(match.slice(prefix.length))
        ? actual.charAt(0).toUpperCase() + actual.slice(1) : actual))
      .replace(/click\s+(?:the\s+)?(?:left\s+)?mouse(?:\s+button)?|нажмите\s+(?:левую\s+)?кнопку\s+мыши|кликните(?:\s+мышью)?/giu,
        match => /^[A-ZА-ЯЁ]/u.test(match) ? actual.charAt(0).toUpperCase() + actual.slice(1) : actual);
  }
  const api = Object.freeze({ render });
  root.WecogInstructionResponses = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
