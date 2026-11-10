import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { participantDebug, participantDebugError, participantDebugErrorOnce,
    resetParticipantDiagnostics, notifyParticipantCallback } from '../../participant-web/js/session-runtime/participant-diagnostic.mjs?v=20261109-issues2';
import { translations, participantLocales } from '../../participant-web/translations.js';

test('camera access errors offer an actionable explanation in every participant locale', () => {
    for (const locale of participantLocales) {
        const help = translations[locale].precheck_camera_error_help;
        assert.equal(typeof help, 'string', locale);
        assert.ok(help.trim().length > 40, locale);
        assert.notEqual(help, translations[locale].precheck_camera_error, locale);
    }
    assert.match(translations.en.precheck_camera_error_help, /Allow camera access/);
    assert.match(translations.ru.precheck_camera_error_help, /Разрешите доступ/);
});

test('participant diagnostics do not build summaries unless an optional sink is enabled', t => {
    const original = globalThis.WECOG_DEBUG;
    t.after(() => { if (original === undefined) delete globalThis.WECOG_DEBUG; else globalThis.WECOG_DEBUG = original; });
    const events = [];
    let computations = 0;
    const summary = () => { computations++; return { observedFrames: 40 }; };
    delete globalThis.WECOG_DEBUG;
    participantDebug('respiration', 'summary', summary);
    globalThis.WECOG_DEBUG = { enabled: false, log: (...args) => events.push(args) };
    participantDebug('respiration', 'summary', summary);
    assert.deepEqual([computations, events.length], [0, 0]);

    globalThis.WECOG_DEBUG.enabled = true;
    participantDebug('respiration', 'summary', summary);
    assert.deepEqual(events, [['respiration', 'summary', { observedFrames: 40 }]]);
    assert.equal(computations, 1);
    globalThis.WECOG_DEBUG.error = () => { throw new Error('sink unavailable'); };
    assert.doesNotThrow(() => participantDebugError('delivery', 'upload:failed', { httpStatus: 403 }));
    assert.doesNotThrow(() => participantDebug('respiration', 'summary', () => { throw new Error('optional computation'); }));
});

test('audited participant and expression modules use no direct console paths', async () => {
    const files = ['emotion/emotion-analyzer.js', 'emotion/index.js',
        'precheck-analyzer.js', 'face-segmenter.js', 'gaze-tracker.js', 'qc-metrics.js',
        'precheck-analyzer/PrecheckAnalyzer.js', 'face-segmenter/FaceSegmenter.js',
        'gaze-tracker/GazeTracker.js', 'qc-metrics/QCMetrics.js',
        ...['app-updated', 'consent-signature', 'experimental_task-updated', 'precheck-updated',
            'tests-updated', 'ui-updated'].map(name => 'web-page/' + name + '.js')];
    for (const file of files) {
        const source = await readFile(new URL('../../participant-web/js/' + file, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /\bconsole\s*\./, file);
    }
});

test('model error diagnostics are bounded even with a broken sink and can be reset', t => {
    const old = globalThis.WECOG_DEBUG;
    t.after(() => { if (old === undefined) delete globalThis.WECOG_DEBUG; else globalThis.WECOG_DEBUG = old; });
    const owner = {}, events = [];
    globalThis.WECOG_DEBUG = { enabled: false, error: (...args) => events.push(args) };
    participantDebugErrorOnce(owner, 'segment', 'inference:failed');
    assert.equal(events.length, 0);
    globalThis.WECOG_DEBUG.enabled = true;
    for (let i = 0; i < 1000; i++) participantDebugErrorOnce(owner, 'segment', 'inference:failed');
    assert.equal(events.length, 1);
    resetParticipantDiagnostics(owner);
    participantDebugErrorOnce(owner, 'segment', 'inference:failed');
    assert.equal(events.length, 2);
    let calls = 0;
    globalThis.WECOG_DEBUG.error = () => { calls++; throw new Error('synthetic sink failure'); };
    resetParticipantDiagnostics(owner);
    for (let i = 0; i < 1000; i++) participantDebugErrorOnce(owner, 'segment', 'inference:failed');
    assert.equal(calls, 1);
});

test('optional callback errors and rejected thenables do not escape or expose their body', async t => {
    const old = globalThis.WECOG_DEBUG;
    t.after(() => { if (old === undefined) delete globalThis.WECOG_DEBUG; else globalThis.WECOG_DEBUG = old; });
    const owner = {}, argument = {}, events = [];
    globalThis.WECOG_DEBUG = { enabled: true, error: (...args) => events.push(args) };
    for (const mode of ['throw', 'reject', 'then-getter']) {
        notifyParticipantCallback(function (value) {
            assert.equal(this, owner); assert.equal(value, argument);
            if (mode === 'throw') throw new Error('SYNTHETIC-PRIVATE-CALLBACK');
            if (mode === 'reject') return Promise.reject(new Error('SYNTHETIC-PRIVATE-CALLBACK'));
            return { get then() { throw new Error('SYNTHETIC-PRIVATE-CALLBACK'); } };
        }, owner, [argument], 'model', 'callback:failed');
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, [['model', 'callback:failed', undefined]]);
});
