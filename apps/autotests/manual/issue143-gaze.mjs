// Loopback-only historical harness; the developer page has a separate auth gate.
import { mountGazeBenchmark } from '../../web/developer/gaze-benchmark.mjs?v=20261109-143n';
const params = new URLSearchParams(location.search);
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const diagnostic = mountGazeBenchmark({ mode: params.get('models'), pose: params.get('pose') === '1',
  temporal: params.get('temporal') === '1', canStart: () => loopback });
if (!loopback) diagnostic.stop('Этот диагностический тест разрешён только на localhost/127.0.0.1. Камера не запрашивалась.');
