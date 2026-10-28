import { test, expect } from '@playwright/test';

test('legacy protocol questionnaires escape field attributes, preserve answer names and bound scales', async ({ page }) => {
  await page.goto('/apps/participant-web/js/precheck-analyzer/illumination.js');
  const result = await page.evaluate(async () => {
    const script = document.createElement('script'); script.src = '/apps/participant-web/js/protocol-runner-new.js';
    await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error('script')); document.head.append(script); });
    const malicious = '\"><img src=x onerror="window.__injected=true"><input name="';
    const definition = { blocks: [{ type: 'questionnaire', params: { config: ['text', 'number', 'scale', 'other'].map(type =>
      ({ type, name: malicious, label: malicious, min: malicious, max: malicious })) } }] };
    window.fetch = async () => new Response(JSON.stringify({ definition }), { headers: { 'content-type': 'application/json' } });
    const runner = (window as any).ProtocolRunner;
    await runner.loadByCode('synthetic');
    const host = document.createElement('div'); document.body.append(host); runner.start(host);
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input'));
    const scale = inputs[2];
    const first = { inputCount: inputs.length, namesPreserved: inputs.every(input => input.name === malicious),
      scripts: host.querySelectorAll('img,script,[onerror],[onfocus]').length,
      scale: { min: scale.min, max: scale.max }, injected: (window as any).__injected === true };
    window.fetch = async () => new Response(JSON.stringify({ definition: { blocks: [{ type: 'questionnaire',
      params: { config: ['__proto__', 'constructor', 'normal'].map(name => ({ name, type: 'text' })) } }] } }));
    await runner.loadByCode('synthetic-special-keys'); runner.start(host);
    host.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.value = 'retained-answer'; });
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const answers = runner.getRunLog().answers;
    return { ...first, specialKeysRetained: Object.keys(answers).length === 3
      && ['__proto__', 'constructor', 'normal'].every(name => answers[name] === 'retained-answer')
      && Object.getPrototypeOf(answers) === null };
  });
  expect(result).toEqual({ inputCount: 4, namesPreserved: true, scripts: 0, scale: { min: '1', max: '10' }, injected: false, specialKeysRetained: true });
});

test('the real aggregate worker does not invent a blink across missing camera frames', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/session-runtime/checkpoint-messages.mjs';
    const { createCheckpointRequest } = await import(modulePath);
    const sample = (t: number, earAvg: number) => ({ t, earAvg, leftEAR: earAvg, rightEAR: earAvg });
    const source = { ids: { session: 'synthetic-eye-gap' }, checkpointViewport: { width: 1200, height: 800 },
      eyeSignals: [...Array.from({ length: 20 }, (_, i) => sample(i * 50, .3)),
        sample(1000, .08), sample(1050, .08), sample(1400, .3), sample(1450, .3)] };
    const worker = new Worker('/apps/participant-web/js/session-runtime/aggregate-worker.mjs', { type: 'module' });
    try {
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker deadline')), 10000);
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        worker.onerror = () => { clearTimeout(timer); reject(new Error('worker failed')); };
        worker.postMessage(createCheckpointRequest(source));
      });
    } finally { worker.terminate(); }
  });
  expect(result.error).toBeUndefined();
  expect(result.packet.blink_summary.blinkCount).toBe(0);
  expect(result.packet.attentionMetrics.global.meta.algorithmVersion).toBe('2.4.0');
});

test('imported numeric fields cannot create event handlers in the real trial editor', async ({ page }) => {
  await page.addInitScript(() => {
    const value = '1" onmouseover="window.__xssExecuted=true" data-audit="';
    localStorage.setItem('emocog_protocol_step_draft', '3');
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{
      id: 'security', type: 'cognitive_task', label: 'Security regression', content: {
        taskType: 'simple_rt', responseMode: 'keypress', rtMin: value, rtWindow: value,
        fixationDuration: value, interStimulusMinMs: value, interStimulusMaxMs: value,
        feedbackCorrect: value, feedbackIncorrect: value, trials: [{
          stimulusId: 'std_simple_black_square', action: 'space', duration: value, repetitions: value
        }]
      }
    }]));
  });
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/experiments/builder');
  await page.locator('.open-trials-btn').click();
  for (const selector of ['.t-duration', '.t-reps', '#rtMinInput', '#rtWindowInput', '#fixationDuration',
    '#randomIsiMin', '#randomIsiMax', '#fbCorr', '#fbInc']) {
    const input = page.locator(selector).first();
    await expect(input).not.toHaveAttribute('onmouseover');
    await input.dispatchEvent('mouseover');
  }
  expect(await page.evaluate(() => (window as any).__xssExecuted)).toBeUndefined();
  await page.locator('.t-duration').fill('1250');
  await page.locator('.t-reps').fill('2');
  await page.locator('#rtMinInput').fill('100');
  await page.locator('#rtWindowInput').fill('2000');
  await page.locator('#trialSaveBtn').click();
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('.t-duration')).toHaveValue('1250');
  await expect(page.locator('.t-reps')).toHaveValue('2');
});

test('camera FPS measures a 10 FPS video rather than display refresh in every engine', async ({ page }) => {
  await page.goto('/apps/participant-web/js/precheck-analyzer/illumination.js');
  const result = await page.evaluate(async () => {
    const video = document.createElement('video');
    Object.assign(video, { muted: true, loop: true, playsInline: true });
    video.src = '/apps/autotests/tests/fixtures/passive-video.webm';
    document.body.append(video); await video.play();
    const modulePath = '/apps/participant-web/js/session-runtime/video-frames.mjs';
    const { measureVideoFps } = await import(modulePath);
    const result = await measureVideoFps(video, 2200);
    video.pause(); video.remove(); return result;
  });
  expect(result.method).toBe('decoded-frame-counter');
  expect(result.measurementVersion).toBe('video_cadence.v2');
  expect(result.fallbackReason).toBeNull();
  expect(result.playbackQuality.complete).toBe(true);
  expect(result.playbackQuality.displayedFrames + result.playbackQuality.droppedFrames).toBe(result.frames);
  expect(result.fps).toBeGreaterThanOrEqual(7);
  expect(result.fps).toBeLessThanOrEqual(14);
});

test('session JSON is displayed as text in summary, heatmaps and event details', async ({ page }) => {
  const marker = '<img src=x onerror="window.__xssExecuted=true">';
  await page.goto('/apps/participant-web/tools/session-report.html');
  await page.locator('#fileInput').setInputFiles({ name: 'synthetic-security.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ids: { session: marker, participant: marker },
      heatmaps: { perStimulus: [{ blockId: marker, stimulusId: marker, sampleCount: marker,
        timeRangeMs: { durationMs: marker }, bins: [[1]] }], perBlock: [] },
      events: [{ tRelMs: 100, type: marker, phase: marker, blockId: marker, trialId: marker,
        stimulusId: marker, detail: marker }] })) });
  await expect(page.locator('#status')).toContainText('Загружено:');
  await expect(page.locator('#summary')).toContainText(marker);
  await expect(page.locator('#heatmapStimulus')).toContainText(marker);
  await expect(page.locator('#timeline')).toContainText(marker);
  await expect(page.locator('img, [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xssExecuted)).toBeUndefined();
});

test('legacy gallery treats filenames and IDs as data and retains deletion behavior', async ({ page }) => {
  const marker = '<img src=x onerror="window.__xssExecuted=true">';
  await page.addInitScript(({ marker }) => {
    localStorage.setItem('emocog_stimuli', JSON.stringify([{ id: 'x\'"/><img src=x onerror="window.__xssExecuted=true">',
      name: marker, info: marker, type: 'text' }]));
    localStorage.setItem('emocog_folders', '[]');
  }, { marker });
  await page.goto('/apps/researcher-web/app_shell.html#/stimuli');
  const gallery = page.locator('#stimuliGallery');
  await expect(gallery).toContainText(marker);
  await expect(gallery.locator('img, [onerror], [onclick]')).toHaveCount(0);
  await gallery.locator('.stim-delete-btn').click();
  await expect(gallery.locator('.stimulus-card')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xssExecuted)).toBeUndefined();
});

test('trial editor does not interpret imported block labels as markup', async ({ page }) => {
  const label = '<img src=x onerror="window.__xssExecuted=true">';
  await page.addInitScript(({ label }) => {
    localStorage.setItem('emocog_protocol_step_draft', '3');
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{ id: 'safe-id', type: 'cognitive_task',
      label, content: { taskType: 'simple_rt', responseMode: 'keypress', trials: [] } }]));
  }, { label });
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/experiments/builder');
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('#trialCloseBtn').locator('..')).toContainText(label);
  await expect(page.locator('[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xssExecuted)).toBeUndefined();
});

test('analytics can enable and remove overrides for special block IDs without using inherited properties', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('emocog_protocol_step_draft', '7');
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify(['__proto__', 'constructor'].map(id => ({
      id, type: 'cognitive_task', label: id, content: { taskType: 'simple_rt', trials: [] }
    }))));
  });
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/experiments/builder');
  await page.locator('#analyticsOverridesDetails > summary').click();
  for (const id of ['__proto__', 'constructor']) {
    const checkbox = page.locator(`.an-block-override-cb[data-block-id="${id}"]`);
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    expect(await page.evaluate(id => {
      const plan = JSON.parse(localStorage.getItem('emocog_analytics_plan_draft') || '{}');
      return Object.prototype.hasOwnProperty.call(plan.blockOverrides, id) && Array.isArray(plan.blockOverrides[id].packages);
    }, id)).toBe(true);
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  }
});

test('real IndexedDB checkpoint round trip keeps special keys as data and still redacts identifiers', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/session-runtime/checkpoint-store.mjs';
    const { SessionCheckpointStore } = await import(modulePath);
    const source = JSON.parse('{"ids":{"session":"synthetic-special-key"},"__proto__":{"unexpected":"not inherited"},"metadata":{"__proto__":{"note":"retained","email":"private@example.test"}}}');
    const writer = new SessionCheckpointStore();
    await writer.save(source.ids.session, source, { state: 'running' });
    const reader = new SessionCheckpointStore();
    const restored = await reader.load(source.ids.session);
    const data = restored.sessionData;
    const result = { ownKey: Object.prototype.hasOwnProperty.call(data, '__proto__'),
      inherited: data.unexpected ?? null, note: data.metadata.__proto__.note,
      email: data.metadata.__proto__.email ?? null, mode: writer.lastPersistenceMode };
    await reader.clear(source.ids.session);
    return result;
  });
  expect(result).toEqual({ ownKey: true, inherited: null, note: 'retained', email: null, mode: 'indexeddb' });
});
