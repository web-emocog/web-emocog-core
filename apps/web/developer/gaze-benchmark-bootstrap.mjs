import { DiagnosticRun } from './diagnostic-run.mjs?v=20261104-4';

// Import has no side effects: an expired/late module cannot mount a new screen.
const run = new DiagnosticRun();
const cancel = () => run.stop();
addEventListener('pagehide', cancel, { once: true });
try {
  const { mountDeveloperGazeBenchmark } = await run.wait(
    () => import('./gaze-benchmark-page.mjs?v=20261109-143n'), { timeoutMs: 30000 });
  run.check();
  await mountDeveloperGazeBenchmark();
} catch (_) {
  if (!run.signal.aborted || !document.hidden) {
    document.getElementById('status').textContent = 'Не удалось загрузить диагностику. Камера выключена. Обновите страницу после восстановления соединения.';
    document.getElementById('start').disabled = true;
  }
} finally { removeEventListener('pagehide', cancel); run.stop(); }
