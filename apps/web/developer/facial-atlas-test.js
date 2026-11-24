import { mountProtocolDiagnostic } from './protocol-diagnostic-page.mjs?v=20261122-validtime1';
import { mountAtlasPanel } from './facial-atlas-panel.mjs';

const runner = mountProtocolDiagnostic('atlas');
try {
    await mountAtlasPanel(runner, document.getElementById('atlasPanel'));
} catch (_) {
    document.getElementById('atlasLoadStatus').textContent = 'Не удалось загрузить атлас. Обновите страницу и проверьте доступность файлов.';
    document.getElementById('btnStart').disabled = true;
    runner.blocked = true;
    runner.stop();
}
