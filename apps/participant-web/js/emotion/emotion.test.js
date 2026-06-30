/**
 * Unit-тесты для модуля emotion.
 * Запуск: vitest / jest (ES-модули)
 * @module emotion.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractActionUnits }                    from './au-extractor.js';
import { classifyFACS, calcAffective }           from './facs-classifier.js';
import { computeAggregatedMetrics }              from './emotion-aggregator.js';
import { EmotionAnalyzer }                       from './emotion-analyzer.js';
import { getEmotionSample, appendEmotionSample } from './public-api.js';
import { EMOTION_CONFIG }                        from './emotion-config.js';

// ─────────────────────────────────────────────────────────────────────────
// Фабрика тестовых landmarks
// ─────────────────────────────────────────────────────────────────────────

function makeLandmarks(overrides = {}) {
    const lm = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

    const defaults = {
        234: { x: 0.30, y: 0.50, z: 0 },
        454: { x: 0.70, y: 0.50, z: 0 },
        10:  { x: 0.50, y: 0.25, z: 0 },
        152: { x: 0.50, y: 0.75, z: 0 },
        33:  { x: 0.42, y: 0.42, z: 0 },
        263: { x: 0.58, y: 0.42, z: 0 },
        159: { x: 0.42, y: 0.40, z: 0 },
        145: { x: 0.42, y: 0.44, z: 0 },
        386: { x: 0.58, y: 0.40, z: 0 },
        374: { x: 0.58, y: 0.44, z: 0 },
        61:  { x: 0.44, y: 0.62, z: 0 },
        291: { x: 0.56, y: 0.62, z: 0 },
        13:  { x: 0.50, y: 0.61, z: 0 },
        14:  { x: 0.50, y: 0.63, z: 0 },
        0:   { x: 0.50, y: 0.60, z: 0 },
        17:  { x: 0.50, y: 0.65, z: 0 },
        1:   { x: 0.50, y: 0.55, z: 0 },
        107: { x: 0.44, y: 0.37, z: 0 },
        336: { x: 0.56, y: 0.37, z: 0 },
        70:  { x: 0.38, y: 0.37, z: 0 },
        300: { x: 0.62, y: 0.37, z: 0 },
        117: { x: 0.38, y: 0.52, z: 0 },
        346: { x: 0.62, y: 0.52, z: 0 },
        203: { x: 0.47, y: 0.57, z: 0 },
        423: { x: 0.53, y: 0.57, z: 0 },
        127: { x: 0.35, y: 0.65, z: 0 },
        356: { x: 0.65, y: 0.65, z: 0 },
    };

    for (const [idx, pt] of Object.entries({ ...defaults, ...overrides })) {
        lm[Number(idx)] = pt;
    }
    return lm;
}

function addNoise(lm, sigma = 0.002) {
    return lm.map(pt => ({
        x: pt.x + (Math.random() - 0.5) * sigma * 2,
        y: pt.y + (Math.random() - 0.5) * sigma * 2,
        z: pt.z,
    }));
}

// ─────────────────────────────────────────────────────────────────────────
// extractActionUnits
// ─────────────────────────────────────────────────────────────────────────

describe('extractActionUnits', () => {

    it('все AU в [0, 1] для нейтрального лица', () => {
        const au = extractActionUnits(makeLandmarks());
        for (const [key, value] of Object.entries(au)) {
            expect(value, `${key} >= 0`).toBeGreaterThanOrEqual(0);
            expect(value, `${key} <= 1`).toBeLessThanOrEqual(1);
        }
    });

    it('все AU в [0, 1] при шуме (100 итераций)', () => {
        const lm = makeLandmarks();
        for (let i = 0; i < 100; i++) {
            const au = extractActionUnits(addNoise(lm, 0.005));
            for (const [key, value] of Object.entries(au)) {
                expect(value, `iter ${i}: ${key}`).toBeGreaterThanOrEqual(0);
                expect(value, `iter ${i}: ${key}`).toBeLessThanOrEqual(1);
            }
        }
    });

    it('возвращает ровно 16 AU', () => {
        expect(Object.keys(extractActionUnits(makeLandmarks()))).toHaveLength(16);
    });

    it('AU12 выше при широкой улыбке', () => {
        const neutral = extractActionUnits(makeLandmarks());
        const smile   = extractActionUnits(makeLandmarks({
            61:  { x: 0.36, y: 0.62, z: 0 },
            291: { x: 0.64, y: 0.62, z: 0 },
        }));
        expect(smile.AU12).toBeGreaterThan(neutral.AU12);
    });

    it('AU5 выше при широко открытых глазах', () => {
        const neutral  = extractActionUnits(makeLandmarks());
        const wideEyes = extractActionUnits(makeLandmarks({
            159: { x: 0.42, y: 0.37, z: 0 },
            145: { x: 0.42, y: 0.47, z: 0 },
            386: { x: 0.58, y: 0.37, z: 0 },
            374: { x: 0.58, y: 0.47, z: 0 },
        }));
        expect(wideEyes.AU5).toBeGreaterThan(neutral.AU5);
    });

    it('AU4 выше при сведённых бровях', () => {
        const neutral  = extractActionUnits(makeLandmarks());
        const furrowed = extractActionUnits(makeLandmarks({
            107: { x: 0.49, y: 0.37, z: 0 },
            336: { x: 0.51, y: 0.37, z: 0 },
        }));
        expect(furrowed.AU4).toBeGreaterThan(neutral.AU4);
    });

    it('AU25/AU27 выше при открытом рте', () => {
        const neutral   = extractActionUnits(makeLandmarks());
        const openMouth = extractActionUnits(makeLandmarks({
            13: { x: 0.50, y: 0.59, z: 0 },
            14: { x: 0.50, y: 0.68, z: 0 },
            0:  { x: 0.50, y: 0.58, z: 0 },
            17: { x: 0.50, y: 0.70, z: 0 },
        }));
        expect(openMouth.AU25).toBeGreaterThan(neutral.AU25);
        expect(openMouth.AU27).toBeGreaterThan(neutral.AU27);
    });

});

// ─────────────────────────────────────────────────────────────────────────
// classifyFACS
// ─────────────────────────────────────────────────────────────────────────

describe('classifyFACS', () => {

    it('сумма scores ≈ 1 для нейтральных AU', () => {
        const scores = classifyFACS(extractActionUnits(makeLandmarks()));
        expect(Object.values(scores).reduce((s, v) => s + v, 0)).toBeCloseTo(1.0, 1);
    });

    it('все scores в [0, 1]', () => {
        const scores = classifyFACS(extractActionUnits(makeLandmarks()));
        for (const [k, v] of Object.entries(scores)) {
            expect(v, `${k} >= 0`).toBeGreaterThanOrEqual(0);
            expect(v, `${k} <= 1`).toBeLessThanOrEqual(1);
        }
    });

    it('сумма scores ≈ 1 при шуме (50 итераций)', () => {
        const lm = makeLandmarks();
        for (let i = 0; i < 50; i++) {
            const scores = classifyFACS(extractActionUnits(addNoise(lm, 0.005)));
            expect(
                Object.values(scores).reduce((s, v) => s + v, 0),
                `iter ${i}`
            ).toBeCloseTo(1.0, 1);
        }
    });

    it('happiness доминирует при высоком AU12 + AU6', () => {
        const au = {
            AU1:0, AU2:0, AU4:0, AU5:0, AU6:0.6, AU7:0, AU9:0,
            AU10:0, AU12:0.8, AU15:0, AU17:0, AU20:0, AU23:0,
            AU25:0, AU26:0, AU27:0,
        };
        const dominant = Object.entries(classifyFACS(au))
            .reduce((a, b) => a[1] > b[1] ? a : b)[0];
        expect(dominant).toBe('happiness');
    });

    it('sadness доминирует при высоких AU1 + AU15 + AU17', () => {
        const au = {
            AU1:0.7, AU2:0, AU4:0, AU5:0, AU6:0, AU7:0, AU9:0,
            AU10:0, AU12:0, AU15:0.7, AU17:0.5, AU20:0, AU23:0,
            AU25:0, AU26:0, AU27:0,
        };
        const dominant = Object.entries(classifyFACS(au))
            .reduce((a, b) => a[1] > b[1] ? a : b)[0];
        expect(dominant).toBe('sadness');
    });

    it('anger доминирует при высоком AU4 + AU7 + AU23', () => {
        const au = {
            AU1:0, AU2:0, AU4:0.8, AU5:0, AU6:0, AU7:0.6, AU9:0,
            AU10:0, AU12:0, AU15:0, AU17:0, AU20:0, AU23:0.7,
            AU25:0, AU26:0, AU27:0,
        };
        const dominant = Object.entries(classifyFACS(au))
            .reduce((a, b) => a[1] > b[1] ? a : b)[0];
        expect(dominant).toBe('anger');
    });

    it('surprise доминирует при AU5 + AU1 + AU2 + AU26', () => {
        const au = {
            AU1:0.6, AU2:0.6, AU4:0, AU5:0.8, AU6:0, AU7:0, AU9:0,
            AU10:0, AU12:0, AU15:0, AU17:0, AU20:0, AU23:0,
            AU25:0, AU26:0.5, AU27:0.3,
        };
        const dominant = Object.entries(classifyFACS(au))
            .reduce((a, b) => a[1] > b[1] ? a : b)[0];
        expect(dominant).toBe('surprise');
    });

    it('disgust доминирует при высоком AU9 + AU10', () => {
        const au = {
            AU1:0, AU2:0, AU4:0, AU5:0, AU6:0, AU7:0, AU9:0.7,
            AU10:0.6, AU12:0, AU15:0, AU17:0, AU20:0, AU23:0,
            AU25:0, AU26:0, AU27:0,
        };
        const dominant = Object.entries(classifyFACS(au))
            .reduce((a, b) => a[1] > b[1] ? a : b)[0];
        expect(dominant).toBe('disgust');
    });

    it('neutral доминирует при нулевых AU', () => {
        const au = Object.fromEntries(
            ['AU1','AU2','AU4','AU5','AU6','AU7','AU9',
             'AU10','AU12','AU15','AU17','AU20','AU23','AU25','AU26','AU27']
            .map(k => [k, 0])
        );
        const dominant = Object.entries(classifyFACS(au))
            .reduce((a, b) => a[1] > b[1] ? a : b)[0];
        expect(dominant).toBe('neutral');
    });

    it('scores содержат все 7 эмоций', () => {
        expect(Object.keys(classifyFACS(extractActionUnits(makeLandmarks()))).sort())
            .toEqual(['anger','disgust','fear','happiness','neutral','sadness','surprise']);
    });

});

// ─────────────────────────────────────────────────────────────────────────
// calcAffective
// ─────────────────────────────────────────────────────────────────────────

describe('calcAffective', () => {

    it('valence в [-1, 1]', () => {
        const { valence } = calcAffective(classifyFACS(extractActionUnits(makeLandmarks())));
        expect(valence).toBeGreaterThanOrEqual(-1);
        expect(valence).toBeLessThanOrEqual(1);
    });

    it('arousal в [0, 1]', () => {
        const { arousal } = calcAffective(classifyFACS(extractActionUnits(makeLandmarks())));
        expect(arousal).toBeGreaterThanOrEqual(0);
        expect(arousal).toBeLessThanOrEqual(1);
    });

    it('valence > 0 при доминирующем happiness', () => {
        const { valence } = calcAffective({
            neutral:0.05, happiness:0.70, sadness:0.05,
            anger:0.05, fear:0.05, surprise:0.05, disgust:0.05,
        });
        expect(valence).toBeGreaterThan(0);
    });

    it('valence < 0 при доминирующем sadness', () => {
        const { valence } = calcAffective({
            neutral:0.05, happiness:0.05, sadness:0.70,
            anger:0.05, fear:0.05, surprise:0.05, disgust:0.05,
        });
        expect(valence).toBeLessThan(0);
    });

    it('arousal > 0.5 при доминирующем anger', () => {
        const { arousal } = calcAffective({
            neutral:0.05, happiness:0.05, sadness:0.05,
            anger:0.70, fear:0.05, surprise:0.05, disgust:0.05,
        });
        expect(arousal).toBeGreaterThan(0.5);
    });

    it('valence и arousal в диапазоне при шуме (50 итераций)', () => {
        const lm = makeLandmarks();
        for (let i = 0; i < 50; i++) {
            const { valence, arousal } = calcAffective(
                classifyFACS(extractActionUnits(addNoise(lm, 0.005)))
            );
            expect(valence, `iter ${i}: valence`).toBeGreaterThanOrEqual(-1);
            expect(valence, `iter ${i}: valence`).toBeLessThanOrEqual(1);
            expect(arousal, `iter ${i}: arousal`).toBeGreaterThanOrEqual(0);
            expect(arousal, `iter ${i}: arousal`).toBeLessThanOrEqual(1);
        }
    });

});

// ─────────────────────────────────────────────────────────────────────────
// EmotionAnalyzer — lifecycle и инварианты
// ─────────────────────────────────────────────────────────────────────────

describe('EmotionAnalyzer', () => {
    let a;

    beforeEach(() => {
        a = new EmotionAnalyzer();
        a.startSession('test-session');
    });

    it('startSession сбрасывает буферы предыдущей сессии', () => {
        a.processLandmarks(makeLandmarks());
        a.processLandmarks(makeLandmarks());
        expect(a.emotionEvents.length).toBe(2);

        a.startSession('new-session');
        expect(a.emotionEvents.length).toBe(0);
        expect(a.smoothingBuffer.length).toBe(0);
        expect(a.temporalBuffer.length).toBe(0);
    });

    it('endSession возвращает корректные метаданные', () => {
        const result = a.endSession();
        expect(result.sessionId).toBe('test-session');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(typeof result.eventCount).toBe('number');
    });

    it('start() выводит console.warn об устаревании', () => {
        const b    = new EmotionAnalyzer();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        b.start();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('start() устарел'));
        warn.mockRestore();
    });

    it('stop() выводит console.warn об устаревании', () => {
        const b = new EmotionAnalyzer();
        b.startSession();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        b.stop();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('stop() устарел'));
        warn.mockRestore();
    });

    it('processLandmarks не работает до startSession', () => {
        const b = new EmotionAnalyzer();
        b.processLandmarks(makeLandmarks());
        expect(b.emotionEvents.length).toBe(0);
    });

    it('processLandmarks записывает success', () => {
        a.processLandmarks(makeLandmarks());
        expect(a.emotionEvents[0].status).toBe('success');
    });

    it('processLandmarks записывает no_landmarks при пустом массиве', () => {
        a.processLandmarks([]);
        expect(a.emotionEvents[0].status).toBe('no_landmarks');
    });

    it('processLandmarks записывает no_landmarks при null', () => {
        a.processLandmarks(null);
        expect(a.emotionEvents[0].status).toBe('no_landmarks');
    });

    it('событие success содержит confidence в [0, 1]', () => {
        a.processLandmarks(makeLandmarks());
        const c = a.emotionEvents[0].data.confidence;
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
    });

    it('событие success содержит scores с суммой ≈ 1', () => {
        a.processLandmarks(makeLandmarks());
        const total = Object.values(a.emotionEvents[0].data.scores)
            .reduce((s, v) => s + v, 0);
        expect(total).toBeCloseTo(1.0, 1);
    });

    it('буфер событий не превышает maxEvents', () => {
        const cap = a.config.maxEvents;
        for (let i = 0; i < cap + 50; i++) a.processLandmarks(makeLandmarks());
        expect(a.emotionEvents.length).toBeLessThanOrEqual(cap);
    });

    it('analyzeLandmarks → нейтральный результат при пустом массиве', () => {
        const r = a.analyzeLandmarks([]);
        expect(r.dominant).toBe('neutral');
        expect(r.confidence).toBe(0);
        expect(r.scores.neutral).toBe(1);
    });

    it('analyzeLandmarks → нейтральный результат при null', () => {
        expect(a.analyzeLandmarks(null).dominant).toBe('neutral');
    });

    it('getAggregatedMetrics → null если нет событий', () => {
        expect(a.getAggregatedMetrics()).toBeNull();
    });

    it('getAggregatedMetrics → корректная структура', () => {
        for (let i = 0; i < 5; i++) a.processLandmarks(makeLandmarks());
        const m = a.getAggregatedMetrics();
        expect(m).not.toBeNull();
        expect(m).toHaveProperty('meanScores');
        expect(m).toHaveProperty('maxScores');
        expect(m).toHaveProperty('stdDev');
        expect(m).toHaveProperty('timeAboveThreshold');
        expect(m).toHaveProperty('meanValence');
        expect(m).toHaveProperty('meanArousal');
        expect(m).toHaveProperty('dominantEmotion');
        expect(m.validDataPct).toBeGreaterThan(0);
    });

    it('meanScores все в [0, 1]', () => {
        for (let i = 0; i < 10; i++) a.processLandmarks(makeLandmarks());
        for (const [k, v] of Object.entries(a.getAggregatedMetrics().meanScores)) {
            expect(v, `meanScores.${k}`).toBeGreaterThanOrEqual(0);
            expect(v, `meanScores.${k}`).toBeLessThanOrEqual(1);
        }
    });

    it('timeAboveThreshold все >= 0 (в секундах)', () => {
        for (let i = 0; i < 10; i++) a.processLandmarks(makeLandmarks());
        for (const [k, v] of Object.entries(a.getAggregatedMetrics().timeAboveThreshold)) {
            expect(v, `timeAboveThreshold.${k}`).toBeGreaterThanOrEqual(0);
        }
    });

    it('getEmotionCategoryStats суммируется в ≈ 1', () => {
        for (let i = 0; i < 5; i++) a.processLandmarks(makeLandmarks());
        const s = a.getEmotionCategoryStats();
        expect(s.positive + s.neutral + s.negative).toBeCloseTo(1.0, 1);
    });

    it('clear() полностью сбрасывает состояние', () => {
        a.processLandmarks(makeLandmarks());
        a.clear();
        expect(a.emotionEvents.length).toBe(0);
        expect(a.smoothingBuffer.length).toBe(0);
        expect(a.temporalBuffer.length).toBe(0);
        expect(a.currentFaceMask).toBeNull();
    });

});

// ─────────────────────────────────────────────────────────────────────────
// getEmotionSample
// ─────────────────────────────────────────────────────────────────────────

describe('getEmotionSample', () => {

    it('missing: нет аргумента → missingData: true', () => {
        const r = getEmotionSample(undefined);
        expect(r.missingData).toBe(true);
        expect(r.confidence).toBe(0);
        expect(r.dataSource).toBe('none');
    });

    it('missing: null → missingData: true', () => {
        expect(getEmotionSample(null).missingData).toBe(true);
    });

    it('landmarks: dataSource = landmarks', () => {
        const r = getEmotionSample({ landmarks: makeLandmarks() });
        expect(r.dataSource).toBe('landmarks');
        expect(r.dataQuality).toBe('high');
    });

    it('landmarks: scores суммируются в ≈ 1', () => {
        const r = getEmotionSample({ landmarks: makeLandmarks() });
        expect(Object.values(r.scores).reduce((s, v) => s + v, 0)).toBeCloseTo(1.0, 1);
    });

    it('landmarks: confidence в [0, 1]', () => {
        const r = getEmotionSample({ landmarks: makeLandmarks() });
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
    });

    it('landmarks: valence в [-1, 1]', () => {
        const r = getEmotionSample({ landmarks: makeLandmarks() });
        expect(r.valence).toBeGreaterThanOrEqual(-1);
        expect(r.valence).toBeLessThanOrEqual(1);
    });

    it('landmarks: arousal в [0, 1]', () => {
        const r = getEmotionSample({ landmarks: makeLandmarks() });
        expect(r.arousal).toBeGreaterThanOrEqual(0);
        expect(r.arousal).toBeLessThanOrEqual(1);
    });

    it('landmarks: недостаточно точек → fallback на metadata', () => {
        const r = getEmotionSample({
            landmarks: Array(100).fill({ x: 0.5, y: 0.5, z: 0 }),
        });
        expect(r.dataSource).toBe('metadata');
    });

    it('metadata: isHeuristic: true', () => {
        const r = getEmotionSample({
            face:         { detected: true },
            illumination: { meanBrightness: 0.6 },
            eyes:         { bothOpen: true },
            pose:         { yaw: 5, pitch: 3, roll: 2 },
        });
        expect(r.isHeuristic).toBe(true);
        expect(r.dataSource).toBe('metadata');
        expect(r.dataQuality).toBe('low');
    });

    it('metadata: scores суммируются в ≈ 1', () => {
        const r = getEmotionSample({
            face:         { detected: true },
            illumination: { meanBrightness: 0.7 },
            eyes:         { bothOpen: true },
            pose:         { yaw: 0, pitch: 0, roll: 0 },
        });
        expect(Object.values(r.scores).reduce((s, v) => s + v, 0)).toBeCloseTo(1.0, 1);
    });

    it('metadata: confidence ниже при face.detected=false', () => {
        const withFace    = getEmotionSample({ face: { detected: true  } });
        const withoutFace = getEmotionSample({ face: { detected: false } });
        expect(withoutFace.confidence).toBeLessThan(withFace.confidence);
    });

    it('metadata: valence в [-1, 1]', () => {
        const r = getEmotionSample({ face: { detected: true } });
        expect(r.valence).toBeGreaterThanOrEqual(-1);
        expect(r.valence).toBeLessThanOrEqual(1);
    });

    it('metadata: arousal в [0, 1]', () => {
        const r = getEmotionSample({ face: { detected: true } });
        expect(r.arousal).toBeGreaterThanOrEqual(0);
        expect(r.arousal).toBeLessThanOrEqual(1);
    });

});

// ─────────────────────────────────────────────────────────────────────────
// appendEmotionSample
// ─────────────────────────────────────────────────────────────────────────

describe('appendEmotionSample', () => {

    function makeState() {
        return { sessionData: { startTime: Date.now(), emotionSamples: [] } };
    }

    const sample = { valence: 0.5, arousal: 0.6, dominant: 'happiness', scores: null };

    it('добавляет сэмпл в emotionSamples', () => {
        const state = makeState();
        appendEmotionSample(state, sample);
        expect(state.sessionData.emotionSamples).toHaveLength(1);
    });

    it('инициализирует emotionSamples если массив отсутствует', () => {
        const state = { sessionData: { startTime: Date.now() } };
        appendEmotionSample(state, sample);
        expect(Array.isArray(state.sessionData.emotionSamples)).toBe(true);
        expect(state.sessionData.emotionSamples).toHaveLength(1);
    });

    it('не падает если state.sessionData отсутствует', () => {
        expect(() => appendEmotionSample({}, sample)).not.toThrow();
        expect(() => appendEmotionSample(null, sample)).not.toThrow();
    });

    it(`cap: не более ${EMOTION_CONFIG.maxEmotionSamples} сэмплов`, () => {
        const state = makeState();
        const cap   = EMOTION_CONFIG.maxEmotionSamples;
        for (let i = 0; i < cap + 100; i++) {
            appendEmotionSample(state, sample);
        }
        expect(state.sessionData.emotionSamples.length).toBeLessThanOrEqual(cap);
    });

    it('cap: при переполнении удаляются старые записи (FIFO)', () => {
        const state = makeState();
        const cap   = EMOTION_CONFIG.maxEmotionSamples;

        for (let i = 0; i < cap; i++) {
            appendEmotionSample(state, { ...sample, valence: i / cap });
        }
        // Добавляем ещё одну — должна вытолкнуть первую
        appendEmotionSample(state, { ...sample, valence: 999 });

        const samples = state.sessionData.emotionSamples;
        expect(samples.length).toBeLessThanOrEqual(cap);
        // Последний элемент — только что добавленный
        expect(samples[samples.length - 1].valence).toBe(999);
        // Первый элемент — уже не нулевой (был вытолкнут)
        expect(samples[0].valence).not.toBe(0);
    });

    it('tRelMs вычисляется корректно если не передан явно', () => {
        const now   = Date.now();
        const state = { sessionData: { startTime: now - 1000, emotionSamples: [] } };
        appendEmotionSample(state, sample, now);
        const tRelMs = state.sessionData.emotionSamples[0].tRelMs;
        expect(tRelMs).toBeGreaterThanOrEqual(900);
        expect(tRelMs).toBeLessThanOrEqual(1100);
    });

    it('tRelMs = 0 если t < startTime (защита от отрицательных значений)', () => {
        const now   = Date.now();
        const state = { sessionData: { startTime: now + 5000, emotionSamples: [] } };
        appendEmotionSample(state, sample, now);
        expect(state.sessionData.emotionSamples[0].tRelMs).toBe(0);
    });

    it('tRelMs передаётся явно если указан', () => {
        const state = makeState();
        appendEmotionSample(state, sample, Date.now(), 12345);
        expect(state.sessionData.emotionSamples[0].tRelMs).toBe(12345);
    });

});

// ─────────────────────────────────────────────────────────────────────────
// computeAggregatedMetrics
// ─────────────────────────────────────────────────────────────────────────

describe('computeAggregatedMetrics', () => {

    function makeEvent(scores, valence = 0, arousal = 0.5, tsOffset = 0) {
        return {
            timestamp: Date.now() + tsOffset,
            status:    'success',
            data:      { scores, affective: { valence, arousal } },
        };
    }

    const neutralScores = {
        neutral:1, happiness:0, sadness:0, anger:0, fear:0, surprise:0, disgust:0,
    };

    it('null при пустом массиве событий', () => {
        expect(computeAggregatedMetrics([], 0, {})).toBeNull();
    });

    it('null если нет success-событий', () => {
        const events = [{ timestamp: Date.now(), status: 'error', data: null }];
        expect(computeAggregatedMetrics(events, 1, {})).toBeNull();
    });

    it('validDataPct корректен', () => {
        const events = [
            makeEvent(neutralScores),
            makeEvent(neutralScores),
            { timestamp: Date.now(), status: 'error', data: null },
        ];
        expect(computeAggregatedMetrics(events, 3, {}).validDataPct).toBeCloseTo(66.67, 1);
    });

    it('meanScores все в [0, 1]', () => {
        const m = computeAggregatedMetrics(
            [makeEvent(neutralScores), makeEvent(neutralScores)], 2, {}
        );
        for (const [k, v] of Object.entries(m.meanScores)) {
            expect(v, `meanScores.${k}`).toBeGreaterThanOrEqual(0);
            expect(v, `meanScores.${k}`).toBeLessThanOrEqual(1);
        }
    });

    it('timeAboveThreshold считается в секундах и >= 0', () => {
        const scores = {
            neutral:0.9, happiness:0.5, sadness:0, anger:0, fear:0, surprise:0, disgust:0,
        };
        const events = [
            makeEvent(scores, 0, 0.5,   0),
            makeEvent(scores, 0, 0.5, 100),
        ];
        const m = computeAggregatedMetrics(events, 2, {});
        // happiness > confidenceThreshold (0.4) → время > 0
        expect(m.timeAboveThreshold.happiness).toBeGreaterThan(0);
        for (const v of Object.values(m.timeAboveThreshold)) {
            expect(v).toBeGreaterThanOrEqual(0);
        }
    });

    it('dominantEmotion — одна из 7 эмоций', () => {
        const m = computeAggregatedMetrics([makeEvent(neutralScores)], 1, {});
        const valid = ['neutral','happiness','sadness','anger','fear','surprise','disgust'];
        expect(valid).toContain(m.dominantEmotion);
    });

    it('meanValence и meanArousal в корректных диапазонах', () => {
        const events = [
            makeEvent(neutralScores,  0.5, 0.8),
            makeEvent(neutralScores, -0.3, 0.2),
        ];
        const m = computeAggregatedMetrics(events, 2, {});
        expect(m.meanValence).toBeGreaterThanOrEqual(-1);
        expect(m.meanValence).toBeLessThanOrEqual(1);
        expect(m.meanArousal).toBeGreaterThanOrEqual(0);
        expect(m.meanArousal).toBeLessThanOrEqual(1);
    });

    it('stdDev все >= 0', () => {
        const events = [
            makeEvent(neutralScores),
            makeEvent({ neutral:0.5, happiness:0.5, sadness:0, anger:0, fear:0, surprise:0, disgust:0 }),
        ];
        const m = computeAggregatedMetrics(events, 2, {});
        for (const [k, v] of Object.entries(m.stdDev)) {
            expect(v, `stdDev.${k}`).toBeGreaterThanOrEqual(0);
        }
    });

    it('categoryStats передаётся в метрики без изменений', () => {
        const catStats = { positive: 0.3, neutral: 0.5, negative: 0.2 };
        const m = computeAggregatedMetrics([makeEvent(neutralScores)], 1, catStats);
        expect(m.categoryStats).toEqual(catStats);
    });

});