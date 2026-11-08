import { mountGazeBenchmark } from './gaze-benchmark.mjs?v=20261108-143m';
import { DiagnosticRun } from './diagnostic-run.mjs?v=20261104-4';
import { authorizeDiagnostic } from './diagnostic-access.mjs?v=20261104-4';

export async function mountDeveloperGazeBenchmark() {
const protocol = document.getElementById('protocol'), consent = document.getElementById('consent');
const requested = new URLSearchParams(location.search).get('protocol');
protocol.value = ['spatial', 'posture', 'temporal'].includes(requested) ? requested : 'spatial';
let allowed = false, blocked = false;
const canStart = () => allowed && !blocked && consent.checked;
const diagnostic = mountGazeBenchmark({ mode: 'tophat', cohort: true,
  pose: protocol.value === 'posture', temporal: protocol.value === 'temporal', canStart,
  async authorize(signal) {
    const accessRun = new DiagnosticRun(), cancel = () => accessRun.stop();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) accessRun.stop();
      await authorizeDiagnostic(accessRun, 'camera');
    } finally { signal.removeEventListener('abort', cancel); accessRun.stop(); }
  } });
consent.addEventListener('change', () => { document.getElementById('start').disabled = !canStart(); });
protocol.addEventListener('change', () => {
  // Versioned protocol is frozen before camera/calibration; changing it starts a new document.
  const url = new URL(location.href); url.search = ''; url.searchParams.set('protocol', protocol.value); location.assign(url);
});
addEventListener('wecog:staffsessionblocked', () => {
  blocked = true; diagnostic.stop('Аккаунт изменился. Войдите заново для запуска диагностики.', 'access_denied');
  diagnostic.clearReport(); document.getElementById('start').disabled = true;
});
if (!window.EmocogAuthGuard) {
  blocked = true; document.getElementById('status').textContent = 'Не удалось загрузить проверку доступа. Камера выключена.';
} else {
  window.WecogDiagnosticAccess = window.EmocogAuthGuard.ensureProtectedPage({ loginPath: '../../web/developer/login.html',
    allowedRoles: ['admin', 'developer'], preserveAuthOnRoleDenied: true, roleDeniedRedirect: '../../web/researcher.html' });
  const access = await window.WecogDiagnosticAccess;
  allowed = access?.ok === true;
  document.getElementById('start').disabled = !canStart();
  document.getElementById('status').textContent = allowed
    ? 'Доступ подтверждён. Камера выключена. Выберите программу и подтвердите согласие перед запуском.'
    : 'Доступ к диагностике не подтверждён. Камера выключена.';
}
// The shared controller supplies mode-specific descriptions. Keep the public title truthful.
document.getElementById('modelDescription').textContent = 'Четыре модели на одних кадрах: контрольная iris-модель, полный eye-patch, Gradient All и горизонтальный black top-hat. Это экспериментальные кандидаты, а не четыре подтверждённо точные модели. Общая калибровка и gates; контрольные цели не обучают predictor. Рабочие исследования не меняются.';
}
