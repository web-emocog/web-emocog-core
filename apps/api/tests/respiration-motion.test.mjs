import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MotionRespirationEstimator, MOTION_RESPIRATION_METHOD_VERSION, headMotionFeatures, removeReferenceComponent, resampleWindow,
} from '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/signal/respiration-motion.js';
import { RppgEngine } from '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/RppgEngine.js';
import { motionFeatures, publishedRespiration } from '../../participant-web/js/session-runtime/continuous-bpm.js';
import {
  resolvePhysiologyMethods, validatePhysiologyMethods, HEART_RATE_METHODS, RESPIRATION_METHODS,
} from '../../shared/physiology-methods.mjs';
import { inspectProtocolPreflight } from '../../shared/protocol-preflight.mjs';
import { readFileSync } from 'node:fs';

const W = 320, H = 240, FPS = 30;

// Сетка лица: нужные точки на своих местах, остальные — внутри овала лица.
function landmarksAt({ breath, screen, k }) {
  const lm = Array.from({ length: 478 }, (_, i) => ({ x: 0.4 + 0.2 * ((i * 37) % 100) / 100, y: 0.3 + 0.4 * ((i * 61) % 100) / 100, z: 0 }));
  const top = 0.30, chin = 0.70 + k.scale * screen;
  lm[10] = { x: 0.5, y: top, z: 0 };
  lm[152] = { x: 0.5, y: chin, z: 0 };
  lm[1] = { x: 0.5, y: 0.52 + 0.004 * breath + k.pitch * screen, z: 0 };
  const eye = 0.08 + 0.0015 * breath + k.scale * screen;
  lm[33] = { x: 0.5 - eye, y: 0.45, z: 0 };
  lm[263] = { x: 0.5 + eye, y: 0.45, z: 0 };
  for (const i of [6, 168, 197, 195]) lm[i] = { x: 0.5, y: 0.47 + 0.003 * breath + k.bridge * screen, z: 0 };
  return lm;
}

function frameImage(level) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = level; data[i + 3] = 255; }
  return { data, width: W, height: H };
}

// Дыхание 12/мин + «стимулы»: картинка 4,3 с / пусто 4,3 с (≈7/мин), которая
// меняет яркость кадра и сдвигает найденные точки (как в стенде #146).
function runEstimator({ seconds = 60, k = { bridge: 0.0005, pitch: 0.02, scale: 0.01 }, shoulders = false, breathRate = 12 } = {}) {
  const est = new MotionRespirationEstimator();
  const bright = frameImage(170), dark = frameImage(90);
  let out = null;
  for (let f = 0; f < seconds * FPS; f++) {
    const t = 1000 + f * 1000 / FPS;
    const sec = f / FPS;
    const screen = Math.floor(sec / 4.3) % 2 === 0 ? 1 : 0;
    const breath = Math.sin(2 * Math.PI * breathRate / 60 * sec);
    est.pushFace(t, landmarksAt({ breath, screen, k }), screen ? bright : dark, W, H);
    if (shoulders && f % 6 === 0) {
      const y = 0.85 + 0.004 * breath + 0.01 * screen;
      est.pushShoulders(t, { x: 0.3, y, visibility: 0.9 }, { x: 0.7, y, visibility: 0.9 });
    }
    out = est.estimate(t);
  }
  return out;
}

test('method version is distinct from the luma method', () => {
  assert.equal(MOTION_RESPIRATION_METHOD_VERSION, 'respiration_motion.consensus.v1');
  assert.equal(RESPIRATION_METHODS.motion.methodVersion, MOTION_RESPIRATION_METHOD_VERSION);
  assert.notEqual(RESPIRATION_METHODS.luma.methodVersion, MOTION_RESPIRATION_METHOD_VERSION);
});

test('breathing is recovered from head motion despite stimulus-driven brightness changes', () => {
  const out = runEstimator();
  assert.ok(Math.abs(out.rate - 12) <= 1.5, JSON.stringify(out));
  assert.equal(out.published, true);
  assert.ok(out.agreeing >= 2);
  assert.equal(out.thirdSource, 'face_scale');
});

test('shoulders become the third estimate when the pose model sees them', () => {
  const out = runEstimator({ shoulders: true });
  assert.equal(out.thirdSource, 'shoulders');
  assert.ok(Math.abs(out.rate - 12) <= 1.5, JSON.stringify(out));
});

test('a frozen shoulder series is not counted as a vote', () => {
  const est = new MotionRespirationEstimator();
  for (let f = 0; f < 30 * 25; f++) est.pushShoulders(1000 + f * 100, { x: 0.3, y: 0.85, visibility: 0.9 }, { x: 0.7, y: 0.85, visibility: 0.9 });
  const out = est.estimate(1000 + 30 * 25 * 100);
  assert.equal(out.votes.third, null);
  assert.equal(out.published, false);
});

test('nothing is published before the 20 s window is filled', () => {
  const out = runEstimator({ seconds: 10 });
  assert.equal(out.rate, null);
  assert.equal(out.published, false);
  assert.equal(out.reason, 'insufficient_window');
});

test('the reference regression removes a shared component and leaves an unrelated one', () => {
  const fs = 10, n = 200;
  const screen = Array.from({ length: n }, (_, i) => (Math.floor(i / 43) % 2 ? 1 : 0));
  const breath = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * 12 / 60 * i / fs));
  const mixed = breath.map((v, i) => 0.3 * v + 2 * screen[i]);
  const cleaned = removeReferenceComponent(mixed, screen, fs, [0.1, 0.4]);
  assert.ok(Math.abs(cleaned.corr) > 0.8);
  const residual = cleaned.signal.map((v, i) => v - 0.3 * breath[i]);
  const spread = Math.max(...residual.slice(40)) - Math.min(...residual.slice(40));
  assert.ok(spread < 0.6, `остаток помехи ${spread}`);
  assert.equal(removeReferenceComponent(mixed, Array(n).fill(0.5), fs, [0.1, 0.4]), null);
});

test('resampling refuses windows with long gaps', () => {
  const pts = [];
  for (let t = 0; t <= 20000; t += 100) if (t < 8000 || t > 11000) pts.push({ t, v: 1 });
  assert.equal(resampleWindow(pts, 20000, { windowSec: 20, fs: 10, maxGapMs: 1500 }), null);
});

test('head motion features need a full face mesh', () => {
  assert.equal(headMotionFeatures([]), null);
  assert.ok(headMotionFeatures(landmarksAt({ breath: 0, screen: 0, k: { bridge: 0, pitch: 0, scale: 0 } })));
});

test('motion output replaces the respiration fields and respects the publication rule', () => {
  const base = { respRate: 23.4, respConf: 0.9, respMethodVersion: 'respiration_luma.log_peak.v2', other: 1 };
  const ok = motionFeatures(base, { rate: 12.1, conf: 2 / 3, published: true, agreeing: 2, thirdSource: 'face_scale' });
  assert.equal(ok.respMethodVersion, 'respiration_motion.consensus.v1');
  assert.equal(publishedRespiration(ok), 12.1);
  assert.equal(ok.other, 1);
  const disagree = motionFeatures(base, { rate: 15, conf: 1 / 3, published: false, agreeing: 1, reason: 'estimates_disagree' });
  assert.equal(publishedRespiration(disagree), null, 'старое значение по яркости не должно просочиться');
  assert.equal(disagree.respRateRaw, 15);
});

test('protocol settings resolve to known methods and fall back to the current ones', () => {
  assert.deepEqual(resolvePhysiologyMethods(null), { heartRate: 'pos', respiration: 'luma', heartRateAlgorithm: 'pos',
    heartRateMethodVersion: 'continuous_signals.v2', respirationMethodVersion: 'respiration_luma.log_peak.v2' });
  const chosen = resolvePhysiologyMethods({ settings: { physiologyMethods: { heartRate: 'chrom', respiration: 'motion' } } });
  assert.equal(chosen.heartRateAlgorithm, 'chrom');
  assert.equal(chosen.respirationMethodVersion, 'respiration_motion.consensus.v1');
  assert.equal(resolvePhysiologyMethods({ settings: { physiologyMethods: { heartRate: 'nope' } } }).heartRate, 'pos');
  assert.deepEqual(validatePhysiologyMethods({ heartRate: 'nope' }), ['heart_rate_method_unsupported']);
  assert.deepEqual(validatePhysiologyMethods({ respiration: 'motion' }), []);
  for (const m of [...Object.values(HEART_RATE_METHODS), ...Object.values(RESPIRATION_METHODS)])
    assert.match(m.methodVersion, /^[A-Za-z0-9_.:-]{1,64}$/, 'формат methodVersion из схемы интервалов');
});

test('preflight blocks unknown methods and warns about experimental ones', () => {
  const definition = (methods) => ({ blocks: [{ type: 'instruction', content: { text: 'x' } }], settings: { physiologyMethods: methods } });
  const codes = (r) => [...(r.errors || []), ...(r.warnings || [])].map(x => x.code);
  assert.ok(codes(inspectProtocolPreflight(definition({ respiration: 'bad' }))).includes('physiology_method_unsupported'));
  assert.ok(codes(inspectProtocolPreflight(definition({ respiration: 'motion' }))).includes('physiology_method_experimental'));
  const current = codes(inspectProtocolPreflight(definition({ heartRate: 'pos', respiration: 'luma' })));
  assert.ok(!current.includes('physiology_method_experimental') && !current.includes('physiology_method_unsupported'));
});

test('builder options match the shared method list', () => {
  const source = readFileSync(new URL('../../web/researcher-builder.js?v=20261124-recovery1', import.meta.url), 'utf8');
  const ids = (name) => [...source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1].matchAll(/id: '([a-z]+)'/g)].map(m => m[1]);
  assert.deepEqual(ids('BUILDER_HEART_RATE_METHODS'), Object.keys(HEART_RATE_METHODS));
  assert.deepEqual(ids('BUILDER_RESPIRATION_METHODS'), Object.keys(RESPIRATION_METHODS));
});

// Синтетическое лицо с пульсом 72 уд/мин: каждый алгоритм ЧСС из списка должен работать в движке.
test('every selectable heart-rate algorithm runs in the engine', () => {
  const w = 200, h = 150, fx = 100, fy = 75, rx = 30, ry = 40;
  const lms = Array.from({ length: 478 }, (_, i) => {
    const a = (i * 2.399963) % (2 * Math.PI), r = Math.sqrt((i % 97) / 97);
    return { x: (fx + rx * r * Math.cos(a)) / w, y: (fy + ry * r * Math.sin(a)) / h, z: 0 };
  });
  for (const method of Object.values(HEART_RATE_METHODS)) {
    const engine = new RppgEngine({ algorithm: method.algorithm, mode: 'safe' });
    const data = new Uint8ClampedArray(w * h * 4);
    let last = null;
    for (let f = 0; f < 30 * 25; f++) {
      const t = f / 30;
      const pulse = 1.5 * Math.sin(2 * Math.PI * 72 / 60 * t);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (((x - fx) / rx) ** 2 + ((y - fy) / ry) ** 2 <= 1) { data[i] = 190 + 0.4 * pulse; data[i + 1] = 130 + pulse; data[i + 2] = 105 + 0.2 * pulse; }
        else { data[i] = data[i + 1] = data[i + 2] = 120; }
        data[i + 3] = 255;
      }
      const out = engine.update({ timestampMs: 1000 + t * 1000, frameW: w, frameH: h, imageData: { data, width: w, height: h },
        landmarks: lms.map(p => ({ ...p })), fps: 30 });
      if (out) last = out;
    }
    const bpm = last?.bpmSmoothed ?? last?.bpm ?? last?.bpmRaw;
    assert.ok(Number.isFinite(bpm) && Math.abs(bpm - 72) < 4, `${method.algorithm}: ${bpm}`);
  }
});

test('session collector with the motion method records only motion respiration and the chosen HR version', async () => {
  const { ContinuousBpmCollector } = await import('../../participant-web/js/session-runtime/continuous-bpm.js');
  const hadDocument = 'document' in globalThis;
  globalThis.document ??= { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData() { return {}; } }) }) };
  try {
    const collector = new ContinuousBpmCollector({ heartRateMethod: 'chrom', respirationMethod: 'motion' });
    assert.equal(await collector.start(), true);
    assert.ok(collector.motionRespiration, 'модуль движения загружен из index.js');
    const bright = frameImage(170), dark = frameImage(90);
    for (let f = 0; f < 45 * FPS; f++) {
      const sec = f / FPS, screen = Math.floor(sec / 4.3) % 2 === 0 ? 1 : 0;
      const lm = landmarksAt({ breath: Math.sin(2 * Math.PI * 12 / 60 * sec), screen, k: { bridge: 0.0005, pitch: 0.02, scale: 0.01 } });
      collector.process(null, lm, 1000 + f * 1000 / FPS, screen ? bright : dark);
      const sy = 0.85 + 0.004 * Math.sin(2 * Math.PI * 12 / 60 * sec) + 0.01 * screen;
      if (f % 6 === 0) collector.recordShoulders(1000 + f * 1000 / FPS, { x: 0.3, y: sy, visibility: 0.9 }, { x: 0.7, y: sy, visibility: 0.9 });
    }
    const result = collector.finalize();
    assert.equal(result.methodVersion, 'continuous_signals.v2.chrom');
    assert.equal(result.respMethodVersion, 'respiration_motion.consensus.v1');
    const resp = result.samples.map(s => s.respRate).filter(Number.isFinite);
    assert.ok(resp.length > 0, 'есть опубликованные значения дыхания');
    assert.ok(resp.every(v => Math.abs(v - 12) <= 2), JSON.stringify(resp.slice(0, 10)));
    assert.ok(result.samples.every(s => s.bpmMethodVersion === 'continuous_signals.v2.chrom'));
  } finally {
    if (!hadDocument) delete globalThis.document;
  }
});

test('the default collector keeps the current methods', () => {
  return import('../../participant-web/js/session-runtime/continuous-bpm.js').then(({ ContinuousBpmCollector }) => {
    const c = new ContinuousBpmCollector({ heartRateMethod: 'unknown', respirationMethod: undefined });
    assert.equal(c.heartRateMethod, 'pos');
    assert.equal(c.respirationMethod, 'luma');
    assert.equal(c.bpmMethodVersion, 'continuous_signals.v2');
  });
});

test('the collector reads the methods from the protocol definition', () => {
  return import('../../participant-web/js/session-runtime/continuous-bpm.js').then(({ ContinuousBpmCollector }) => {
    const c = new ContinuousBpmCollector({ definition: { settings: { physiologyMethods: { heartRate: 'auto', respiration: 'motion' } } } });
    assert.equal(c.heartRateMethod, 'auto');
    assert.equal(c.respirationMethod, 'motion');
    assert.equal(c.bpmMethodVersion, 'continuous_signals.v2.auto');
    assert.equal(c.recordShoulders(1000, { x: 0.3, y: 0.8 }, { x: 0.7, y: 0.8 }), false, 'до start() плечи не принимаются');
    const legacy = new ContinuousBpmCollector({ definition: { settings: { signalProfileId: 'protocol_signals.v2' } } });
    assert.equal(legacy.respirationMethod, 'luma');
  });
});
