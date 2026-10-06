import { test, expect } from '@playwright/test';

const base = 'http://127.0.0.1:4173';
const researcher = `${base}/apps/web/researcher.html?analyticsPreview=1`;
const participant = `${base}/apps/participant-web/mvp_with_precheck_1-updated.html`;

for (const editing of [false, true]) {
  test(`metadata survives language changes and reload (${editing ? 'edit' : 'new'})`, async ({ page }) => {
    await page.goto(`${researcher}#/overview`);
    await page.evaluate((editing) => {
      localStorage.removeItem('emocog_protocol_meta_draft');
      localStorage.setItem('emocog_protocol_step_draft', '0');
      if (editing) localStorage.setItem('emocog_my_experiments', JSON.stringify([{
        id: 'metadata-edit', status: 'draft', savedStep: 0, blocks: [],
        updatedAt: '2026-10-06T12:00:00Z', metadata: { title: 'Original title' }
      }]));
    }, editing);
    await page.goto(`${researcher}#/experiments/${editing ? 'edit/metadata-edit' : 'builder'}`);
    if (editing) await page.locator('.bstep[data-step="0"]').click();
    await page.locator('#metaTitle').fill('My custom experiment');
    await page.locator('#metaProtocolId').fill('custom-id-2026');
    await page.locator('#metaDuration').fill('12 minutes');
    await page.locator('#metaDescription').fill('My custom description');
    for (const lang of ['en', 'ru']) {
      await page.locator(`#lang${lang === 'en' ? 'En' : 'Ru'}`).click();
      await expect(page.locator('#metaTitle')).toHaveValue('My custom experiment');
      await expect(page.locator('#metaProtocolId')).toHaveValue('custom-id-2026');
      await expect(page.locator('#metaDuration')).toHaveValue('12 minutes');
      await expect(page.locator('#metaDescription')).toHaveValue('My custom description');
    }
    await page.reload();
    await expect(page.locator('#metaTitle')).toHaveValue('My custom experiment');
    await expect(page.locator('#metaProtocolId')).toHaveValue('custom-id-2026');
    await expect(page.locator('#metaDuration')).toHaveValue('12 minutes');
  });
}

test('refine selection keeps its explicit open or closed state across filter changes', async ({ page }) => {
  await page.goto(`${researcher}#/analytics/session-card`);
  await expect(page.locator('#analyticsIncludeIncomplete')).toBeAttached();
  const details = page.locator('details').filter({ has: page.locator('#analyticsIncludeIncomplete') });
  await details.locator('summary').click();
  await page.locator('#analyticsIncludeIncomplete').check();
  await expect(details).toHaveAttribute('open', '');
  await page.locator('#analyticsIncludeIncomplete').uncheck();
  await expect(details).toHaveAttribute('open', '');
  await page.locator('#analyticsDateFrom').fill('2026-01-01');
  await details.locator('summary').click();
  await page.locator('#langEn').click();
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await page.locator('#analyticsResetFilters').click();
  await expect(details).toHaveAttribute('open', '');
});

test('editing metadata neither overwrites a new draft nor overrides a newer saved revision', async ({ page }) => {
  await page.goto(`${researcher}#/overview`);
  await page.evaluate(() => {
    localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({ title: 'Independent new draft' }));
    localStorage.setItem('emocog_my_experiments', JSON.stringify([{
      id: 'metadata-revision', status: 'draft', savedStep: 1, blocks: [],
      updatedAt: '2026-10-06T12:00:00Z', metadata: { title: 'Original saved title' }
    }]));
  });
  await page.goto(`${researcher}#/experiments/edit/metadata-revision`);
  await page.locator('.bstep[data-step="0"]').click();
  await page.locator('#metaTitle').fill('Unfinished edit');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_protocol_meta_draft')!).title)).toBe('Independent new draft');
  await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('emocog_my_experiments')!);
    entries[0].updatedAt = '2026-10-06T13:00:00Z';
    entries[0].metadata.title = 'Newer saved revision';
    localStorage.setItem('emocog_my_experiments', JSON.stringify(entries));
  });
  await page.reload();
  await page.locator('.bstep[data-step="0"]').click();
  await expect(page.locator('#metaTitle')).toHaveValue('Newer saved revision');
});

test('precheck contour follows real pose and distance checks, not an ideal face size', async ({ page }) => {
  await page.goto(participant);
  const result = await page.evaluate(async () => {
    const { updateHeadPoseGuide, resetHeadPoseReference, setHeadPoseGuideMode } = await import(
      new URL('js/gaze-tracker/head-pose-guide.js?v=20261006-3', location.href).href);
    resetHeadPoseReference();
    setHeadPoseGuideMode('precheck');
    const frame = {
      face: { detected: true, bbox: { x: 0.4, y: 0.3, width: 0.2, height: 0.3 } },
      pose: { status: 'stable', isStable: true, isTilted: false, yaw: 0, pitch: 0, roll: 0 }
    };
    const stable = updateHeadPoseGuide(frame);
    const tilted = updateHeadPoseGuide({ ...frame, pose: { ...frame.pose, status: 'tilted', isTilted: true } });
    const far = updateHeadPoseGuide({ ...frame, face: { ...frame.face, bbox: { ...frame.face.bbox, height: 0.16 } } });
    const missing = updateHeadPoseGuide({ face: { detected: false }, pose: { status: 'no_face' } });
    return { stable, tilted, far, missing };
  });
  expect(result.stable.precheckStatus).toBe('passed');
  expect(result.tilted.precheckStatus).toBe('failed');
  expect(result.far.precheckStatus).toBe('failed');
  expect(result.missing.precheckStatus).toBe('failed');
});

test('precheck overlay uses the mirrored cover crop and the real gate accepts a smaller stable face', async ({ page }) => {
  await page.goto(participant);
  const result = await page.evaluate(async () => {
    const frame = {
      face: { detected: true, bbox: { x: 0.3, y: 0.3, width: 0.2, height: 0.3 } },
      pose: { status: 'stable', yaw: 0, pitch: 0, roll: 0 }
    };
    const canvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
    const video = document.getElementById('precheckVideo')!;
    canvas.getBoundingClientRect = () => ({ width: 400, height: 300 }) as DOMRect;
    Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
    const context = canvas.getContext('2d')!;
    const translations: number[][] = [];
    const translate = context.translate.bind(context);
    context.translate = (x, y) => { translations.push([x, y]); translate(x, y); };
    const guide = await import(new URL('js/gaze-tracker/head-pose-guide.js?v=20261006-3', location.href).href);
    guide.resetHeadPoseReference();
    guide.setHeadPoseGuideMode('precheck');
    translations.length = 0;
    guide.updateHeadPoseGuide(frame);
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.precheckData = frame;
    shared.runtime.successFrames = 1000;
    shared.indicatorsStatus = { illumination: 'passed', face: 'passed', pose: 'passed', visibility: 'passed' };
    const precheck = await import(new URL('js/web-page/precheck-updated.js?v=20261006-3', location.href).href);
    precheck.checkAllIndicators();
    return { translations, status: canvas.dataset.precheckStatus, pass: shared.sessionData.precheck.pass_fail };
  });
  expect(result.translations[0][0]).toBeCloseTo(-66.67, 1);
  expect(result.translations[0][1]).toBe(0);
  expect(result.status).toBe('passed');
  expect(result.pass).toBe(true);
});

test('calibration permits blinking between targets in both instruction surfaces', async ({ page }) => {
  await page.goto(participant);
  const packs = await page.evaluate(async () => {
    const { translations } = await import(new URL('translations.js?v=20261006-3', location.href).href);
    return ['ru', 'en'].map(lang => ({ intro: translations[lang].calibration_intro_body, clicks: translations[lang].calib_click_instruction }));
  });
  expect(packs[0].intro).toMatch(/моргать между/i);
  expect(packs[0].clicks).toMatch(/моргать между/i);
  expect(packs[1].intro).toMatch(/blink between/i);
  expect(packs[1].clicks).toMatch(/blink between/i);
});

for (const lang of ['ru', 'en']) {
  for (const [mode, response, expected] of [
    ['keypress', 'KeyZ', 'Я / Z'], ['keypress', 'KeyX', 'Ч / X'],
    ['keypress', 'Comma', 'Б / ,'], ['keypress', 'Period', 'Ю / .'],
    ['click', 'Click', lang === 'ru' ? 'мыши' : 'click'],
    ['pointer_intent', 'PointerIntent', lang === 'ru' ? 'мыш' : 'mouse']
  ]) {
    test(`standard instruction substitutes ${mode}/${response} (${lang})`, async ({ page }) => {
      await page.goto(participant);
      await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
      await page.evaluate(async ({ lang, mode, response }) => {
        const shared = (window as any).__WECOG_STATE__;
        shared.currentLang = lang;
        shared.runtime.sessionRuntime.policyShown = true;
        const { loadAndStartCognitiveTask } = await import(new URL(
          'js/web-page/experimental_task-updated.js?v=20261006-3', location.href).href);
        await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: {
          version: 'instruction-regression', blocks: [
            { id: 'instruction', type: 'instruction', content: { title: 'Инструкция: Simple RT - тренировка', text: 'Нажмите Пробел.' } },
            { id: 'task', type: 'cognitive_task', taskType: 'simple_rt', blockConfig: { responseMode: mode },
              trials: [{ id: 'trial', correctResponse: response, stimulus: { type: 'shape' } }] }
          ]
        } });
      }, { lang, mode, response });
      await expect(page.locator('#cogText')).not.toContainText(/Space|Пробел|пробел/);
      await expect(page.locator('#cogText')).toContainText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      const paragraphs = (await page.locator('#cogText').innerText()).split('\n\n');
      expect(paragraphs[0].toLowerCase()).toContain(expected.toLowerCase());
    });
  }
}

test('choice rules use trial mappings, custom placeholders survive, and all ten locales resolve actions', async ({ page }) => {
  await page.goto(participant);
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  const results = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.sessionRuntime.policyShown = true;
    const { loadAndStartCognitiveTask } = await import(new URL(
      'js/web-page/experimental_task-updated.js?v=20261006-3', location.href).href);
    const rows: Array<{ lang: string; task: string; text: string }> = [];
    for (const lang of ['ru', 'en', 'zh', 'es', 'hi', 'ar', 'fr', 'bn', 'pt', 'ur']) {
      shared.currentLang = lang;
      for (const task of ['simple_rt', 'go_nogo', 'nback_2', 'pvt', 'ax_cpt', 'stroop', 'flanker', 'task_switching']) {
        await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'mapping-regression', blocks: [
          { id: 'instruction', type: 'instruction', content: { standardInstruction: true } },
          { id: 'task', type: 'cognitive_task', taskType: task, blockConfig: { responseMode: 'keypress' }, trials: [
            { id: 'red', condition: 'red', correctResponse: 'KeyZ', stimulus: { type: 'shape' } },
            { id: 'blue', condition: 'blue', correctResponse: 'KeyX', stimulus: { type: 'shape' } }
          ] }
        ] } });
        rows.push({ lang, task, text: document.getElementById('cogText')!.innerText });
      }
    }
    const custom: Record<string, string> = {};
    for (const [lang, suffix] of Object.entries({ ru: 'Ru', en: 'En', zh: 'Zh', es: 'Es', hi: 'Hi', ar: 'Ar', fr: 'Fr', bn: 'Bn', pt: 'Pt', ur: 'Ur' })) {
      shared.currentLang = lang;
      await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'custom-regression', blocks: [
        { id: 'instruction', type: 'instruction', content: { [`title${suffix}`]: 'My instructions', [`text${suffix}`]: 'Keep the custom explanation. On target: {response}.' } },
        { id: 'task', type: 'cognitive_task', taskType: 'simple_rt', blockConfig: { responseMode: 'keypress' },
          trials: [{ id: 'custom', correctResponse: 'KeyX', stimulus: { type: 'shape' } }] }
      ] } });
      custom[lang] = document.getElementById('cogText')!.innerText;
    }
    return { rows, custom };
  });
  for (const row of results.rows) {
    expect(row.text, `${row.lang}/${row.task}`).not.toMatch(/\{response\}|undefined|Space|Пробел|Arrow|стрелку (влево|вправо|вниз)/);
    expect(row.text).toContain('Я / Z');
    expect(row.text).toContain('Ч / X');
    if (['stroop', 'flanker', 'task_switching'].includes(row.task)) {
      expect(row.text).toMatch(/red: .*Я \/ Z/);
      expect(row.text).toMatch(/blue: .*Ч \/ X/);
    }
  }
  for (const text of Object.values(results.custom)) {
    expect(text).toContain('Keep the custom explanation. On target:');
    expect(text).toContain('Ч / X');
    expect(text).not.toContain('{response}');
  }
  expect(results.custom.en).toContain('Keep the custom explanation. On target: press Ч / X.');
});
