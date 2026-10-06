(function (global) {
  'use strict';

  const PD_ID = 'photodiode';
  let isFlashing = false;

  function getEl() {
    return document.getElementById(PD_ID);
  }

  function blinkOnce(durationMs) {
    durationMs = durationMs || 100;
    const el = getEl();
    if (!el || isFlashing) return Promise.resolve();

    isFlashing = true;
    const start = performance.now();
    el.style.backgroundColor = '#fff';

    return new Promise(resolve => {
      function turnOff() {
        const now = performance.now();
        if (now - start >= durationMs) {
          el.style.backgroundColor = '#000';
          isFlashing = false;
          resolve();
        } else {
          requestAnimationFrame(turnOff);
        }
      }
      requestAnimationFrame(turnOff);
    });
  }

  async function blinkBurst(count) {
    count = count || 1;
    for (let i = 0; i < count; i++) {
      await blinkOnce(100);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const COUNTS = {
    experiment: 4,
    task: 3,
    stage: 2,
    stimulus: 1,
  };

  function signal(kind) {
    const count = COUNTS[kind] || 1;
    return blinkBurst(count);
  }

  global.Photodiode = {
    blinkOnce: blinkOnce,
    blinkBurst: blinkBurst,
    signal: signal,
  };
})(window);