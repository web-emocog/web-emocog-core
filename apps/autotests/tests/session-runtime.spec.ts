import { test, expect } from '@playwright/test';
import { getPageUrl } from './helpers/testUtils';

const PAGE_URL = getPageUrl();

test.describe('Participant session runtime', () => {
  test('applies every participant locale to consent and precheck labels', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as any).setLanguage === 'function');

    const mismatches = await page.evaluate(async () => {
      const moduleUrl = new URL('translations.js', window.location.href).href;
      const { translations, participantLocales } = await import(moduleUrl);
      const selectors: Record<string, string> = {
        privacy_policy_link: '[data-i18n="privacy_policy_link"]',
        label_light: '[data-i18n="label_light"]',
        label_face: '[data-i18n="label_face"]',
        label_pose: '[data-i18n="label_pose"]',
        label_visibility: '[data-i18n="label_visibility"]',
        precheck_criteria_help: '[data-i18n="precheck_criteria_help"]',
      };
      const runtimeKeys = [
        'runtime_recalibrate',
        'runtime_upload_retry_action',
        'runtime_upload_preparing',
        'runtime_upload_attempt',
        'runtime_upload_retry_wait',
        'runtime_upload_success',
        'runtime_upload_failure',
        'runtime_protocol_start_failure_title',
        'runtime_protocol_start_failure_body',
        'runtime_protocol_retry_action',
      ];
      const failures: Array<{ locale: string; key: string; actual: string; expected: string }> = [];
      for (const locale of participantLocales) {
        (window as any).setLanguage(locale);
        if (document.documentElement.lang !== locale) {
          failures.push({
            locale,
            key: 'document.lang',
            actual: document.documentElement.lang,
            expected: locale,
          });
        }
        for (const [key, selector] of Object.entries(selectors)) {
          const actual = document.querySelector(selector)?.textContent?.trim() || '';
          const expected = String(translations[locale][key]).trim();
          if (actual !== expected) failures.push({ locale, key, actual, expected });
        }
        for (const key of runtimeKeys) {
          const actual = String(translations[locale][key] || '').trim();
          if (!actual) failures.push({ locale, key, actual, expected: 'localized text' });
          if (locale !== 'en' && actual === String(translations.en[key] || '').trim()) {
            failures.push({ locale, key, actual, expected: `non-English ${locale} text` });
          }
        }
      }
      return failures;
    });

    expect(mismatches).toEqual([]);
  });

  test('selects the highest-error validation zones for targeted recalibration', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const targets = await page.evaluate(async () => {
      const moduleUrl = new URL(
        'js/web-page/tests-updated.js?v=20260919-1',
        window.location.href,
      ).href;
      const { getWorstValidationTargets } = await import(moduleUrl);
      return getWorstValidationTargets([
        {
          targetX: 100,
          targetY: 50,
          samples: [{ targetX: 100, targetY: 50, gazeX: 600, gazeY: 50 }],
        },
        {
          targetX: 900,
          targetY: 450,
          samples: [{ targetX: 900, targetY: 450, gazeX: 910, gazeY: 460 }],
        },
        {
          targetX: 500,
          targetY: 250,
          samples: [{ targetX: 500, targetY: 250, gazeX: 700, gazeY: 250 }],
        },
      ], { width: 1000, height: 500 }, 2);
    });

    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ x: 10, y: 10, errorPx: 500 });
    expect(targets[1]).toMatchObject({ x: 50, y: 50, errorPx: 200 });
  });

  test('blocks an unknown invitation before consent and never requests ingest', async ({ page }) => {
    let tokenRequests = 0;
    let ingestRequests = 0;
    await page.route('**/invitations/by-code/**', async route => {
      if (route.request().url().endsWith('/ingest-token')) tokenRequests += 1;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invitation not found' }),
      });
    });
    await page.route('**/ingest', async route => {
      ingestRequests += 1;
      await route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto(`${PAGE_URL}?code=UNKNOWN-E2E`, { waitUntil: 'load' });
    await page.locator('#btnStartIntro').click();
    await expect(page.locator('#step1')).toHaveClass(/active/);
    await expect(page.locator('#inviteLinkHint')).toContainText(/не найдено|not found/i);
    expect(tokenRequests).toBe(0);
    expect(ingestRequests).toBe(0);
  });

  test('loads the shared stimulus registry before the participant runtime', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const referencedIds = await page.evaluate(() => {
      const registry = (window as any).WecogProtocolStimuli;
      return registry?.referencedStimulusIds({
        blocks: [{
          type: 'cognitive_task',
          params: { stimuli_ids: ['api:77'] },
          trials: [{ stimulusId: '42' }],
        }],
      }).sort() ?? null;
    });
    expect(referencedIds).toEqual(['42', '77']);
    expect(await page.evaluate(() => Boolean((window as any).__WECOG_STATE__))).toBe(true);
  });

  test('preloads uploaded invitation stimuli before the cognitive task starts', async ({ page }) => {
    const invitationCode = 'INV-STIMULUS-PRELOAD';
    let contentRequests = 0;
    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await page.route('**/invitations/by-code/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(`/by-code/${invitationCode}/stimuli/42/content`)) {
        contentRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: imageBytes,
        });
        return;
      }
      if (url.pathname.endsWith(`/by-code/${invitationCode}/stimuli`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            id: 42,
            name: 'Uploaded target',
            mime_type: 'image/png',
            metadata: {},
            content_url: `/invitations/by-code/${invitationCode}/stimuli/42/content`,
          }]),
        });
        return;
      }
      if (url.pathname.endsWith(`/by-code/${invitationCode}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            invitation_id: 42,
            code: invitationCode,
            protocol_id: 42,
            project_id: 1,
            protocol_name: 'Stimulus preload E2E',
            definition: {
              version: 'v2.0_universal',
              blocks: [{
                id: 'uploaded-image-task',
                type: 'cognitive_task',
                taskType: 'simple_rt',
                blockConfig: { stimulusDuration: 1000 },
                trials: [{ stimulusId: '42', condition: 'target', action: 'space' }],
              }],
            },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`${PAGE_URL}?code=${invitationCode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(
      (window as any).__WECOG_STATE__?.runtime?.invitationStimuliMap?.['42']
    ));
    const preloaded = await page.evaluate(async () => {
      const runtime = (window as any).__WECOG_STATE__.runtime;
      const row = runtime.invitationStimuliMap['42'];
      const resolved = (window as any).StandardStimuli.resolveParticipantStimulus({
        stimulusId: '42',
        meta: row,
      });
      const response = await fetch(resolved.src);
      const image = new Image();
      image.src = resolved.src;
      await image.decode();
      return {
        source: resolved.src,
        size: (await response.blob()).size,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        retainedUrls: runtime.invitationStimulusObjectUrls.length,
      };
    });

    expect(contentRequests).toBe(1);
    expect(preloaded.source).toMatch(/^blob:/);
    expect(preloaded.size).toBeGreaterThan(0);
    expect(preloaded.naturalWidth).toBe(1);
    expect(preloaded.naturalHeight).toBe(1);
    expect(preloaded.retainedUrls).toBe(1);

    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      const moduleUrl = new URL(
        'js/web-page/experimental_task-updated.js?v=20260919-1',
        window.location.href,
      ).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      await loadAndStartCognitiveTask({
        protocol: shared.runtime.invitationProtocolDefinition,
        autoFinishSession: false,
      });
    });
    await page.locator('#cogStartBtn').click();
    const renderedImage = page.locator('#cogImage');
    await expect(renderedImage).toBeVisible();
    await expect.poll(() => renderedImage.evaluate((element: HTMLImageElement) => ({
      src: element.src,
      naturalWidth: element.naturalWidth,
    }))).toMatchObject({ src: expect.stringMatching(/^blob:/), naturalWidth: 1 });
  });

  test('lets a participant retry then skip an unavailable image without ending the task', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      shared.runtime.invitationStimuliMap = {
        '42': {
          id: '42', name: 'Unavailable upload', mime_type: 'image/png',
          metadata: { url: `${location.origin}/missing-stimulus.png` }
        }
      };
      const moduleUrl = new URL('js/web-page/experimental_task-updated.js?v=20260919-1', location.href).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      await loadAndStartCognitiveTask({
        autoFinishSession: false,
        protocol: {
          version: 'v2-media-recovery-e2e',
          blocks: [{
            id: 'media-recovery', type: 'cognitive_task', taskType: 'emotion_viewing',
            blockConfig: { useFixation: false, stimulusDuration: 1000 },
            trials: [
              { stimulusId: '42', condition: 'unavailable', duration: 1000 },
              { stimulusId: 'std_emo_happy_01', condition: 'happy', duration: 1000 }
            ]
          }]
        }
      });
    });
    await page.locator('#cogStartBtn').click();
    await expect(page.getByRole('button', { name: /Повторить загрузку|Retry loading/ })).toBeVisible();
    await page.getByRole('button', { name: /Повторить загрузку|Retry loading/ }).click();
    await expect(page.getByRole('button', { name: /Пропустить пробу|Skip this trial/ })).toBeVisible();
    await page.getByRole('button', { name: /Пропустить пробу|Skip this trial/ }).click();
    await expect(page.locator('#cogImage')).toBeVisible();
    const result = await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0]);
    expect(result).toMatchObject({ skippedMedia: true, qualityValid: false, correct: false });
    expect(result.qualityIssueCodes).toContain('stimulus_media_load_failed');
  });

  test('preloads and presents an uploaded video in a passive block', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const videoBase64 = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context is unavailable');
      context.fillStyle = '#dc2626';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.start();
      await new Promise(resolve => setTimeout(resolve, 180));
      context.fillStyle = '#2563eb';
      context.fillRect(0, 0, canvas.width, canvas.height);
      recorder.stop();
      await stopped;
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: 'video/webm' });
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    });

    const invitationCode = 'INV-VIDEO-PRELOAD';
    const videoBytes = Buffer.from(videoBase64, 'base64');
    await page.route('**/invitations/by-code/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(`/by-code/${invitationCode}/stimuli/99/content`)) {
        await route.fulfill({ status: 200, contentType: 'video/webm', body: videoBytes });
        return;
      }
      if (url.pathname.endsWith(`/by-code/${invitationCode}/stimuli`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            id: 99,
            name: 'Uploaded passive video',
            mime_type: 'video/webm',
            metadata: {},
            content_url: `/invitations/by-code/${invitationCode}/stimuli/99/content`,
          }]),
        });
        return;
      }
      if (url.pathname.endsWith(`/by-code/${invitationCode}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            invitation_id: 99,
            code: invitationCode,
            protocol_id: 99,
            project_id: 1,
            definition: {
              version: 'v2.0_universal',
              blocks: [{
                id: 'uploaded-video-passive',
                type: 'passive',
                content: {
                  trials: [{ stimulusId: '99', duration: 1000 }],
                  useFixation: false,
                  fullscreenStimulus: false,
                },
              }],
            },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`${PAGE_URL}?code=${invitationCode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(
      (window as any).__WECOG_STATE__?.runtime?.invitationStimuliMap?.['99']?.metadata?.url
    ));
    const media = await page.evaluate(() => {
      const shared = (window as any).__WECOG_STATE__;
      const row = shared.runtime.invitationStimuliMap['99'];
      const resolved = (window as any).StandardStimuli.resolveParticipantStimulus({
        stimulusId: '99',
        meta: row,
      });
      return {
        type: resolved.type,
        source: resolved.src,
        retainedUrls: shared.runtime.invitationStimulusObjectUrls.length,
      };
    });
    expect(media).toEqual({
      type: 'video',
      source: expect.stringMatching(/^blob:/),
      retainedUrls: 1,
    });

    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      const moduleUrl = new URL('js/web-page/experimental_task-updated.js?v=20260919-1', window.location.href).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      await loadAndStartCognitiveTask({
        protocol: shared.runtime.invitationProtocolDefinition,
        autoFinishSession: false,
      });
    });
    await page.locator('#cogStartBtn').click();
    const renderedVideo = page.locator('#cogVideo');
    await expect(renderedVideo).toBeVisible();
    await expect.poll(() => renderedVideo.evaluate((element: HTMLVideoElement) => ({
      source: element.currentSrc || element.src,
      width: element.videoWidth,
      height: element.videoHeight,
    }))).toMatchObject({
      source: expect.stringMatching(/^blob:/),
      width: 4,
      height: 4,
    });
    await expect(page.locator('body')).not.toHaveClass(/cognitive-stimulus-fullscreen/);
  });

  test('passive viewing randomizes trials and applies configured random intervals', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      Math.random = () => 0;
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      const moduleUrl = new URL('js/web-page/experimental_task-updated.js?v=20260919-1', window.location.href).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      await loadAndStartCognitiveTask({
        autoFinishSession: false,
        protocol: {
          version: 'v2.0-passive-randomization-e2e',
          blocks: [{
            id: 'passive-randomized',
            type: 'passive',
            content: {
              trials: [
                { stimulusId: 'std_emo_happy_01', duration: 50 },
                { stimulusId: 'std_emo_sad_01', duration: 50 },
                { stimulusId: 'std_emo_neutral_01', duration: 50 },
              ],
              randomize: true,
              randomInterStimulus: true,
              interStimulusMinMs: 100,
              interStimulusMaxMs: 100,
              useFixation: false,
              fullscreenStimulus: false,
            },
          }],
        },
      });
    });

    await page.locator('#cogStartBtn').click();
    await expect(page.locator('#cogImage')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/cognitive-stimulus-fullscreen/);
    const stage = await page.locator('#cognitiveStimulusArea').boundingBox();
    const viewport = page.viewportSize();
    expect(stage).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(stage!.width).toBeLessThan(viewport!.width);

    await expect.poll(() => page.evaluate(
      () => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length
    )).toBe(3);
    const result = await page.evaluate(() => {
      const shared = (window as any).__WECOG_STATE__;
      return {
        sourceOrder: shared.sessionData.cognitiveResults.map((item: any) => item.sourceTrialIndex),
        intervals: shared.sessionData.events
          .filter((event: any) => event.type === 'trial_start' && event.blockId === 'passive-randomized')
          .map((event: any) => event.randomPreStimulusMs),
      };
    });
    expect(result.sourceOrder).toEqual([1, 2, 0]);
    expect(result.intervals).toEqual([100, 100, 100]);
  });

  test('keeps fullscreen layout stable between passive stimuli', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      const moduleUrl = new URL('js/web-page/experimental_task-updated.js?v=20260919-1', window.location.href).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      await loadAndStartCognitiveTask({
        autoFinishSession: false,
        protocol: {
          version: 'v2.0-passive-fullscreen-e2e',
          blocks: [{
            id: 'passive-fullscreen',
            type: 'passive',
            content: {
              trials: [
                { stimulusId: 'std_emo_happy_01', duration: 120, iti: 350 },
                { stimulusId: 'std_emo_sad_01', duration: 120, iti: 0 },
              ],
              useFixation: false,
              fullscreenStimulus: true,
            },
          }],
        },
      });
    });

    await page.locator('#cogStartBtn').click();
    await expect(page.locator('body')).toHaveClass(/cognitive-stimulus-fullscreen/);
    await expect(page.locator('#cogImage')).toBeVisible();
    await expect(page.locator('#cogImage')).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/cognitive-stimulus-fullscreen/);
    await expect(page.locator('#cogImage')).toBeVisible();
    await expect.poll(() => page.evaluate(
      () => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length
    )).toBe(2);
    await expect(page.locator('body')).not.toHaveClass(/cognitive-stimulus-fullscreen/);
  });

  test('does not replace an API image with a blue shape when preloading fails', async ({ page }) => {
    const invitationCode = 'INV-STIMULUS-DIRECT-FALLBACK';
    await page.route('**/invitations/by-code/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(`/by-code/${invitationCode}/stimuli/77/content`)) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        return;
      }
      if (url.pathname.endsWith(`/by-code/${invitationCode}/stimuli`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            id: 77,
            name: 'Temporarily unavailable image',
            mime_type: 'image/png',
            metadata: {},
            content_url: `/invitations/by-code/${invitationCode}/stimuli/77/content`,
          }]),
        });
        return;
      }
      if (url.pathname.endsWith(`/by-code/${invitationCode}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            invitation_id: 77,
            code: invitationCode,
            protocol_id: 77,
            project_id: 1,
            definition: {
              version: 'v2.0_universal',
              blocks: [{
                id: 'uploaded-image-task',
                type: 'cognitive_task',
                taskType: 'simple_rt',
                trials: [{ stimulusId: 'api:77', condition: 'target', action: 'space' }],
              }],
            },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`${PAGE_URL}?code=${invitationCode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(
      (window as any).__WECOG_STATE__?.runtime?.invitationStimuliMap?.['77']
    ));
    const resolved = await page.evaluate(() => {
      const row = (window as any).__WECOG_STATE__.runtime.invitationStimuliMap['77'];
      const stimulus = (window as any).StandardStimuli.resolveParticipantStimulus({
        stimulusId: 'api:77',
        meta: row,
      });
      return { type: stimulus.type, src: stimulus.src, background: stimulus.style?.backgroundColor };
    });
    expect(resolved.type).toBe('image');
    expect(resolved.src).toContain(`/by-code/${invitationCode}/stimuli/77/content`);
    expect(resolved.background).toBeUndefined();
  });

  test('opens contact and questionnaire immediately after consent without reload', async ({ page }) => {
    const invitationCode = 'INV-QUESTIONNAIRE-E2E';
    await page.route('**/invitations/by-code/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/ingest-token')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ token: 'participant-questionnaire-token' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          invitation_id: 2,
          code: invitationCode,
          protocol_id: 2,
          project_id: 1,
          protocol_name: 'Questionnaire E2E',
          definition: {
            participantShell: {
              consent: true,
              questionnaire: true,
              precheck: true,
              calibration: true,
            },
            blocks: [{
              id: 'instruction-1',
              type: 'instruction',
              content: { title: 'Instruction', text: 'Continue' },
            }],
          },
        }),
      });
    });
    await page.goto(`${PAGE_URL}?code=${invitationCode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationProtocolDefinition));
    await page.locator('#btnStartIntro').click();
    await page.locator('#consentCheck').check();
    await page.locator('#consentBtn').click();
    await expect(page.locator('#step3')).toHaveClass(/active/);
    await page.locator('#step3NextBtn').click();
    await expect(page.locator('#step4')).toHaveClass(/active/);
    await expect(page.locator('#age')).toBeVisible();
  });
  test('keeps protocol instruction buttons enabled and advances on click', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      shared.runtime.invitationProtocolDefinition = {
        version: 'v2-instruction-e2e',
        title: 'Instruction participant test',
        blocks: [{
          id: 'instruction_e2e',
          type: 'instruction',
          content: {
            title: 'Инструкция',
            text: 'Прочитайте условие и продолжайте.',
            buttonText: 'Продолжить',
          },
        }],
      };
      const moduleUrl = new URL(
        'js/web-page/experimental_task-updated.js?v=20260919-1',
        window.location.href,
      ).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      (window as any).__instructionComplete = false;
      await loadAndStartCognitiveTask({
        autoFinishSession: false,
        onComplete: () => { (window as any).__instructionComplete = true; },
      });
    });

    await expect(page.locator('#cogTitle')).toHaveText('Инструкция');
    const continueButton = page.locator('#cogStartBtn');
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toBeEnabled();
    await expect(page.locator('#cogCheckContainer')).toBeHidden();
    await continueButton.click();
    await expect.poll(() => page.evaluate(
      () => (window as any).__instructionComplete
    )).toBe(true);
  });

  test('localizes legacy standard instructions when English is selected', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.currentLang = 'en';
      shared.runtime.sessionRuntime.policyShown = true;
      shared.runtime.invitationProtocolDefinition = {
        version: 'v2-legacy-standard-instruction-e2e',
        blocks: [{
          id: 'legacy_simple_rt_instruction',
          type: 'instruction',
          content: {
            title: 'Инструкция: Simple RT - тренировка',
            text: 'Старый протокол без сохранённых английских полей.',
            buttonText: 'Продолжить',
          },
        }, {
          id: 'legacy_simple_rt_task',
          type: 'cognitive_task',
          taskType: 'simple_rt',
          blockConfig: { responseMode: 'keyboard' },
          trials: [{
            id: 'simple_rt_1',
            correctResponse: 'Space',
            stimulus: { type: 'shape' },
          }],
        }],
      };
      const moduleUrl = new URL(
        'js/web-page/experimental_task-updated.js?v=20260919-1',
        window.location.href,
      ).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      await loadAndStartCognitiveTask({ autoFinishSession: false });
    });

    await expect(page.locator('#cogTitle')).toHaveText('Instruction: Simple RT - practice');
    await expect(page.locator('#cogText')).toContainText('press Space as quickly as possible');
    await expect(page.locator('#cogText')).toContainText('Response method: press Space');
    await expect(page.locator('#cogStartBtn')).toHaveText('Start');
  });

  test('uses the protocol handed off after validation even if runtime state changes', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      shared.runtime.invitationProtocolDefinition = null;
      const moduleUrl = new URL(
        'js/web-page/experimental_task-updated.js?v=20260919-1',
        window.location.href,
      ).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      (window as any).__handoffComplete = false;
      await loadAndStartCognitiveTask({
        protocol: {
          version: 'v2-handoff-e2e',
          title: 'Validation handoff',
          blocks: [{
            id: 'after_validation_instruction',
            type: 'instruction',
            content: {
              title: 'Следующий блок',
              text: 'Протокол продолжается после LOOCV.',
              buttonText: 'Продолжить',
            },
          }],
        },
        autoFinishSession: false,
        onComplete: () => { (window as any).__handoffComplete = true; },
      });
    });

    await expect(page.locator('#cogTitle')).toHaveText('Следующий блок');
    await page.locator('#cogStartBtn').click();
    await expect.poll(() => page.evaluate(
      () => (window as any).__handoffComplete
    )).toBe(true);
  });

  test('does not finish or upload when an invitation protocol has no executable blocks', async ({ page }) => {
    let ingestCalls = 0;
    await page.route('**/ingest', async route => {
      ingestCalls += 1;
      await route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      shared.runtime.invitationProtocolDefinition = null;
      const moduleUrl = new URL(
        'js/web-page/experimental_task-updated.js?v=20260919-1',
        window.location.href,
      ).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      await loadAndStartCognitiveTask({
        protocol: {
          version: 'v2-invalid-e2e',
          title: 'Invalid invitation protocol',
          blocks: [{ id: 'unsupported', type: 'unsupported_type' }],
        },
      });
    });

    await expect(page.locator('#cogTitle')).toContainText(/техническая ошибка|technical error/i);
    await expect(page.locator('#cogText')).toContainText(/сессия не завершена|session is not complete/i);
    await expect(page.locator('#cogStartBtn')).toBeVisible();
    await expect(page.locator('#step7')).not.toHaveClass(/active/);
    expect(ingestCalls).toBe(0);
  });

  test('renders typed survey questions and keeps required validation actionable', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.events = [];
      shared.runtime.sessionRuntime.policyShown = true;
      shared.runtime.invitationProtocolDefinition = {
        version: 'v2-survey-e2e',
        title: 'Survey participant test',
        blocks: [{
          id: 'survey_e2e',
          type: 'survey',
          content: {
            schemaVersion: 'protocol_survey.v1',
            title: 'После задания',
            description: 'Ответьте, опираясь на свои ощущения.',
            questions: [
              { id: 'open', text: 'Что вы заметили?', type: 'open', required: true },
              {
                id: 'single',
                text: 'Выберите один вариант',
                type: 'single',
                required: false,
                options: [{ id: 'yes', label: 'Да' }, { id: 'no', label: 'Нет' }],
              },
              {
                id: 'multiple',
                text: 'Можно выбрать несколько',
                type: 'multiple',
                required: false,
                options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
              },
            ],
          },
        }],
      };
      const moduleUrl = new URL(
        'js/web-page/experimental_task-updated.js?v=20260919-1',
        window.location.href,
      ).href;
      const { loadAndStartCognitiveTask } = await import(moduleUrl);
      (window as any).__surveyComplete = false;
      await loadAndStartCognitiveTask({
        autoFinishSession: false,
        onComplete: () => { (window as any).__surveyComplete = true; },
      });
    });

    await expect(page.locator('#cogText.survey-runtime')).toBeVisible();
    await expect(page.locator('.survey-runtime-question')).toHaveCount(3);
    const continueButton = page.locator('#cogStartBtn');
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(page.locator('.survey-question-error').first())
      .toContainText(/обязательный|required/i);
    expect(await page.evaluate(() => (window as any).__surveyComplete)).toBe(false);

    await page.locator('.survey-runtime-open').fill('Стало легче сосредоточиться');
    await continueButton.click();
    await expect.poll(() => page.evaluate(() => (window as any).__surveyComplete)).toBe(true);
    const surveyEvent = await page.evaluate(() => (
      (window as any).__WECOG_STATE__.sessionData.events
        .find((event: { type?: string }) => event.type === 'survey_response')
    ));
    expect(surveyEvent.category).toBe('block');
    expect(surveyEvent.responses).toEqual([
      { questionId: 'open', responseType: 'open', value: 'Стало легче сосредоточиться' },
      { questionId: 'single', responseType: 'single', value: null },
      { questionId: 'multiple', responseType: 'multiple', value: [] },
    ]);
  });

  test('runs invitation tests in protocol order without exposing Test Hub', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const moduleUrl = new URL(
        'js/gaze-tracker/gaze-tests/index.js',
        window.location.href,
      ).href;
      const { runProtocolTestSequence } = await import(moduleUrl);
      (window as any).__protocolCalls = [];
      (window as any).__protocolSequence = runProtocolTestSequence(
        ['rt', 'tracking'],
        {
          runRTTest: async () => {
            (window as any).__protocolCalls.push('rt');
            return { trialResults: 1 };
          },
          runTrackingTest: async () => {
            (window as any).__protocolCalls.push('tracking');
            return { trackingSamples: 10, averageCameraFps: 30 };
          },
          finishSession: async () => {
            (window as any).__protocolCalls.push('finish');
          },
        },
      );
    });

    const modal = page.locator('#wecog-session-modal');
    for (let index = 0; index < 6; index += 1) {
      if ((await page.evaluate(() => (window as any).__protocolCalls)).includes('finish')) break;
      if (await modal.isVisible()) {
        await page.locator('[data-session-modal-action]').click();
      }
      await page.waitForTimeout(50);
    }
    await expect.poll(() => page.evaluate(
      () => (window as any).__protocolCalls,
    )).toEqual(['rt', 'tracking', 'finish']);
    await page.evaluate(() => (window as any).__protocolSequence);
    await expect(page.locator('#testHubContainer')).toBeHidden();
  });

  test('BPM accepts immutable MediaPipe landmarks and stays background-only', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const result = await page.evaluate(async () => {
      const moduleUrl = new URL(
        'js/session-runtime/continuous-bpm.js',
        window.location.href,
      ).href;
      const { ContinuousBpmCollector } = await import(moduleUrl);
      const errors: string[] = [];
      const collector = new ContinuousBpmCollector({
        onError: (error: Error) => errors.push(error.message),
      });
      const ready = await collector.start();
      const frame = document.createElement('canvas');
      frame.width = 320;
      frame.height = 240;
      Object.defineProperty(frame, 'videoWidth', { value: 320 });
      Object.defineProperty(frame, 'videoHeight', { value: 240 });
      const landmarks = Object.freeze(Array.from({ length: 478 }, (_, index) =>
        Object.freeze({
          x: 0.25 + (index % 20) * 0.025,
          y: 0.2 + (index % 24) * 0.02,
          z: 0,
        })
      ));
      collector.process(frame as any, landmarks as any, performance.now());
      return { ready, errors };
    });
    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);

    const invalidatesBlock = await page.evaluate(async () => {
      const source = await fetch('js/session-runtime/frame-pipeline.js').then(r => r.text());
      return /code:\s*'bpm_module_failed'[\s\S]*?invalidatesBlock:\s*false/.test(source);
    });
    expect(invalidatesBlock).toBe(true);
  });

  test('BPM recovers after repeated frame errors instead of staying unavailable', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const result = await page.evaluate(async () => {
      const moduleUrl = new URL('js/session-runtime/continuous-bpm.js', window.location.href).href;
      const { ContinuousBpmCollector } = await import(moduleUrl);
      const errors: string[] = [];
      let recovered = 0;
      const collector = new ContinuousBpmCollector({
        onError: (error: Error) => errors.push(error.message),
        onRecovered: () => { recovered += 1; },
      });
      await collector.start();
      let calls = 0;
      collector.engine = {
        update: () => {
          calls += 1;
          if (calls <= 3) throw new Error('transient-rppg-frame');
          return null;
        },
      } as any;
      const frame = document.createElement('canvas');
      frame.width = 64;
      frame.height = 48;
      Object.defineProperty(frame, 'videoWidth', { value: 64 });
      Object.defineProperty(frame, 'videoHeight', { value: 48 });
      const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
      for (let index = 0; index < 4; index += 1) {
        collector.process(frame as any, landmarks, index * 33);
      }
      return { errors, recovered, consecutiveErrors: collector.consecutiveErrors };
    });
    expect(result.errors).toEqual(['transient-rppg-frame']);
    expect(result.recovered).toBe(1);
    expect(result.consecutiveErrors).toBe(0);
  });

  test('does not treat a global skin-mask guess as proven face occlusion', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const result = await page.evaluate(async () => {
      const moduleUrl = new URL(
        'js/session-runtime/quality-detector.mjs',
        window.location.href,
      ).href;
      const { SessionQualityDetector } = await import(moduleUrl);
      const detector = new SessionQualityDetector({
        rules: { face_occluded: { holdMs: 0, message: 'occluded' } },
      });
      const frame = {
        face: { detected: true },
        illumination: { status: 'ok' },
        pose: { status: 'ok', isStable: true, isTilted: false },
      };
      const globalOnly = detector.update(frame, {
        faceVisibility: { handDetected: true, issues: ['hand_on_face'] },
        issues: ['hand_on_face'],
      }, 1000);
      const regional = detector.update(frame, {
        faceVisibility: {
          handDetected: true,
          issues: ['left_eye_hand_occluded'],
        },
        issues: ['left_eye_hand_occluded'],
      }, 1001);
      return {
        globalRaised: globalOnly.raised.map((item: any) => item.code),
        regionalRaised: regional.raised.map((item: any) => item.code),
      };
    });
    expect(result.globalRaised).not.toContain('face_occluded');
    expect(result.regionalRaised).toContain('face_occluded');
  });

  test('precheck video has no playback affordance and successful checks expose calibration', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const video = page.locator('#precheckVideo');
    await expect(video).not.toHaveAttribute('controls', /.*/);
    await expect(video).toHaveCSS('pointer-events', 'none');
    const calibrationButton = page.locator('#startCalibBtn');
    await expect(calibrationButton).toHaveClass(/hidden/);
    await expect(calibrationButton).toBeHidden();

    const result = await page.evaluate(async () => {
      document.querySelectorAll('.step').forEach(step => step.classList.remove('active'));
      document.getElementById('step5')?.classList.add('active');
      const precheckUrl = new URL('js/web-page/precheck-updated.js?v=20260919-1', window.location.href).href;
      const stateUrl = new URL('js/web-page/state.js?v=20260919-1', window.location.href).href;
      const [{ checkAllIndicators }, { state, CONSTANTS }] = await Promise.all([
        import(precheckUrl),
        import(stateUrl),
      ]);
      state.indicatorsStatus = {
        illumination: 'passed',
        face: 'passed',
        pose: 'passed',
        visibility: 'passed',
      };
      state.runtime.precheckData = {
        face: { detected: true, bbox: { height: 0.3 } },
      };
      state.runtime.successFrames = CONSTANTS.REQUIRED_SUCCESS_FRAMES - 1;
      checkAllIndicators();
      const button = document.getElementById('startCalibBtn') as HTMLButtonElement;
      return {
        hidden: button.classList.contains('hidden'),
        disabled: button.disabled,
        pass: state.sessionData.precheck.pass_fail,
      };
    });
    expect(result).toEqual({ hidden: false, disabled: false, pass: true });
    await expect(calibrationButton).toBeVisible();
    await expect(calibrationButton).toBeEnabled();
  });

  test('admits after consent, removes invitation from URL, and reloads the admitted session', async ({ page }) => {
    const invitationCode = 'INV-ADMISSION-E2E';
    const lookups: string[] = [];
    let tokenRequests = 0;
    await page.route('**/invitations/by-code/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith('/ingest-token')) {
        tokenRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ token: 'participant-ingest-token', admitted: true }),
        });
        return;
      }
      if (url.pathname.endsWith(`/by-code/${invitationCode}`)) {
        lookups.push(url.search);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            invitation_id: 1,
            code: invitationCode,
            protocol_id: 1,
            project_id: 1,
            protocol_name: 'Admission E2E',
            definition: {
              participantShell: {
                consent: true,
                questionnaire: false,
                precheck: true,
                calibration: false,
              },
              blocks: [],
            },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.addInitScript(() => {
      localStorage.setItem('emocog_dev_auto_precheck', '1');
    });
    await page.goto(`${PAGE_URL}?code=${invitationCode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationProtocolDefinition));
    await expect.poll(() => page.evaluate(
      () => (window as any).__WECOG_STATE__.runtime.invitationParticipantShell
    )).toEqual({
      consent: true,
      questionnaire: true,
      precheck: true,
      calibration: true,
    });
    await page.locator('#btnStartIntro').click();
    await page.locator('#consentCheck').check();
    await page.locator('#consentBtn').click();

    await expect.poll(() => tokenRequests).toBe(1);
    await expect(page).not.toHaveURL(/(?:\?|&)code=/);
    const admittedSessionId = await page.evaluate(
      () => (window as any).__WECOG_STATE__.sessionData.ids.session
    );
    const admittedParticipantId = await page.evaluate(
      () => (window as any).__WECOG_STATE__.sessionData.ids.participant
    );
    expect(admittedSessionId).toBeTruthy();
    expect(admittedSessionId).not.toContain('S-DEV-');
    expect(admittedParticipantId).not.toContain('P-DEV-');

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationProtocolDefinition));
    expect(lookups.some(search => (
      new URLSearchParams(search).get('session_id') === admittedSessionId
    ))).toBe(true);
    await expect(page).not.toHaveURL(/(?:\?|&)code=/);
  });

  test('pause is available only during instructions and resumes by button', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));

    await page.evaluate(async () => {
      const stateModule = await import(new URL(
        'js/web-page/state.js?v=20260919-1',
        window.location.href,
      ).href);
      stateModule.setSessionPhase('cognitive_instruction', { force: true });
      (window as any).__WECOG_STATE__.runtime.sessionRuntime.enterInstruction({
        source: 'playwright-test',
      });
    });
    const pause = page.locator('#wecog-session-pause');
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(page.locator('#wecog-session-modal')).toBeVisible();

    await page.locator('[data-session-modal-action]').click();
    await expect(page.locator('#wecog-session-modal')).not.toBeVisible();

    await page.evaluate(async () => {
      const stateModule = await import(new URL(
        'js/web-page/state.js?v=20260919-1',
        window.location.href,
      ).href);
      stateModule.setSessionPhase('calibration', { force: true });
    });
    await expect(pause).not.toBeVisible();

    const pauseRejected = await page.evaluate(async () => {
      const stateModule = await import(new URL(
        'js/web-page/state.js?v=20260919-1',
        window.location.href,
      ).href);
      stateModule.setSessionPhase('cognitive_stimulus', { force: true });
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.beginBlock({ blockId: 'browser-rt', blockType: 'rt' });
      return runtime.pause();
    });
    expect(pauseRejected.accepted).toBe(false);
    await expect(pause).not.toBeVisible();
  });

  test('quality error marks the current block for repeat', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));

    const decision = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.enterInstruction({ source: 'playwright-test' });
      runtime.beginBlock({ blockId: 'browser-vpc', blockType: 'vpc' });
      runtime.reportIssue({
        kind: 'quality',
        code: 'low_light_test',
        message: 'Недостаточно света',
      });
      return runtime.completeBlock({ success: true });
    });
    expect(decision.repeatRequired).toBe(true);
    await expect(page.locator('#wecog-session-alert')).toContainText('повтор');
    await page.evaluate(() => {
      document.getElementById('fullscreenCalibration')?.classList.add('active');
      const point = document.getElementById('fullscreenCalibPoint') as HTMLElement;
      point.style.display = 'block';
      point.style.left = '50%';
      point.style.top = '24px';
    });
    const clickTarget = await page.evaluate(() => {
      const point = document.getElementById('fullscreenCalibPoint') as HTMLElement;
      const rect = point.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id;
    });
    expect(clickTarget).toBe('fullscreenCalibPoint');
    await page.locator('#wecog-session-alert-close').click();
    await expect(page.locator('#wecog-session-alert')).toBeHidden();
  });

  test('calibration marker moves instantly without leaving a stale target', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });

    const markerState = await page.evaluate(async () => {
      const screen = document.getElementById('fullscreenCalibration') as HTMLElement;
      const point = document.getElementById('fullscreenCalibPoint') as HTMLElement;
      screen.classList.add('active');
      point.style.display = 'block';
      point.style.left = '20%';
      point.style.top = '20%';

      const afterPaint = () => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await afterPaint();

      const firstRect = point.getBoundingClientRect();
      const firstCenter = {
        x: firstRect.left + firstRect.width / 2,
        y: firstRect.top + firstRect.height / 2,
      };

      point.style.left = '80%';
      point.style.top = '80%';
      await afterPaint();

      const secondRect = point.getBoundingClientRect();
      const secondCenter = {
        x: secondRect.left + secondRect.width / 2,
        y: secondRect.top + secondRect.height / 2,
      };
      const style = getComputedStyle(point);

      return {
        markerCount: document.querySelectorAll('#fullscreenCalibPoint').length,
        transitionDuration: style.transitionDuration,
        animationName: style.animationName,
        boxShadow: style.boxShadow,
        staleTarget: document.elementFromPoint(firstCenter.x, firstCenter.y)?.id || '',
        currentTarget: document.elementFromPoint(secondCenter.x, secondCenter.y)?.id || '',
      };
    });

    expect(markerState).toEqual({
      markerCount: 1,
      transitionDuration: '0s',
      animationName: 'none',
      boxShadow: 'none',
      staleTarget: 'fullscreenCalibration',
      currentTarget: 'fullscreenCalibPoint',
    });
  });

  test('acknowledging calibration instructions reveals the first marker', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));

    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.precheck = { pass_fail: true };
      shared.runtime.precheckData = { pass_fail: true };
      shared.runtime.sessionRuntime.startContinuousModules = async () => true;
      const moduleUrl = new URL('js/web-page/tests-updated.js?v=20260919-1', window.location.href).href;
      const { startCalibration } = await import(moduleUrl);
      void startCalibration();
    });

    await expect(page.locator('#calibrationIntro')).toBeVisible();
    await page.locator('#calibrationIntroStartBtn').click();
    await expect(page.locator('#fullscreenCalibration')).toHaveClass(/active/);
    await expect(page.locator('#fullscreenCalibPoint')).toBeVisible();

    const markerState = await page.locator('#fullscreenCalibPoint').evaluate(point => ({
      display: getComputedStyle(point).display,
      left: (point as HTMLElement).style.left,
      top: (point as HTMLElement).style.top,
    }));
    expect(markerState).toEqual({ display: 'block', left: '8%', top: '8%' });
  });

  test('precheck and calibration show only an anonymized reference/current head contour', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const result = await page.evaluate(async () => {
      document.querySelectorAll('.step').forEach(step => step.classList.remove('active'));
      document.getElementById('step5')?.classList.add('active');
      const moduleUrl = new URL('js/gaze-tracker/head-pose-guide.js', window.location.href).href;
      const guide = await import(moduleUrl);
      const frame = {
        face: { detected: true, bbox: { x: 0.32, y: 0.2, width: 0.36, height: 0.54 } },
        pose: { yaw: 1, pitch: -1, roll: 2 },
      };
      guide.updateHeadPoseGuide(frame);
      guide.captureHeadPoseReference(frame);
      guide.showCalibrationHeadPoseGuide(true);
      guide.setCalibrationGuideTarget(5, 5);
      return {
        snapshot: guide.getHeadPoseGuideSnapshot(),
        corner: document.getElementById('calibrationHeadPoseGuide')?.dataset.corner,
      };
    });
    expect(result.snapshot.reference).not.toBeNull();
    expect(result.snapshot.deviation.status).toBe('aligned');
    expect(result.corner).toBe('bottom-right');
    await expect(page.locator('#precheckVideo')).toHaveCSS('opacity', '1');
    await expect(page.locator('#overlayCanvas')).toBeVisible();
    await expect(page.locator('#calibrationHeadPoseGuide')).toHaveCSS('pointer-events', 'none');
  });

  test('explains and repeats only invalid cognitive trials', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    const decision = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.enterInstruction({ source: 'partial-repeat-test' });
      runtime.beginBlock({ blockId: 'rt-partial-browser', blockType: 'cognitive_task' });
      runtime.reportIssue({
        kind: 'quality',
        code: 'low_light',
        message: 'Освещение недостаточно',
      });
      runtime.resolveIssue('low_light');
      return runtime.completeBlock({
        success: true,
        repeatItems: [
          { id: 'trial-2', issueCodes: ['low_light'] },
          { id: 'trial-6', issueCodes: ['low_light'] },
          { id: 'trial-9', issueCodes: ['low_light'] },
        ],
        totalItemCount: 10,
      });
    });
    expect(decision.repeatRequired).toBe(true);
    await expect(page.locator('#wecog-session-alert')).toContainText(
      'Будут повторены только незасчитанные пробы.'
    );

    await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      (window as any).__partialRepeatPrompt = runtime.promptRepeat(
        'rt-partial-browser'
      );
    });
    await expect(page.locator('#wecog-session-modal')).toBeVisible();
    await expect(page.locator('[data-session-modal-body]')).toContainText(
      'Не засчитано 3 пробы из 10'
    );
    await expect(page.locator('[data-session-modal-body]')).toContainText(
      'Слишком темно, необходимо включить лампу или подойти к окну'
    );
    await expect(page.locator('[data-session-modal-note]')).not.toBeVisible();
    await page.locator('[data-session-modal-action]').click();
    await page.evaluate(() => (window as any).__partialRepeatPrompt);
  });

  test('reload restores the session and invalidates only the interrupted block', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      const runtime = shared.runtime.sessionRuntime;
      shared.sessionData.ids.session = 'S-PLAYWRIGHT-RELOAD';
      shared.sessionData.eyeTracking.push(
        { t: 1000, correctedX: 100, correctedY: 120, valid: true },
      );
      shared.sessionData.eyeSignals.push(
        { t: 1000, earAvg: 0.3, bothOpen: true },
      );
      await runtime.saveCheckpoint();
      shared.sessionData.eyeTracking.push(
        { t: 1033, correctedX: 102, correctedY: 121, valid: true },
      );
      shared.sessionData.eyeSignals.push(
        { t: 1033, earAvg: 0.1, bothOpen: false },
      );
      runtime.enterInstruction({ source: 'reload-test' });
      runtime.beginBlock({ blockId: 'reload-vpc', blockType: 'vpc' });
      await runtime.saveCheckpoint();
    });

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => {
      const runtime = (window as any).__WECOG_STATE__?.runtime?.sessionRuntime;
      return runtime?.machine?.activeIssues
        && [...runtime.machine.activeIssues.values()]
          .some((issue: any) => issue.code === 'page_reloaded');
    });
    const restored = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return runtime.machine.snapshot();
    });
    expect(restored.currentBlock).toBeNull();
    expect(restored.repeatQueue).toHaveLength(1);
    expect(restored.repeatQueue[0].blockId).toBe('reload-vpc');
    expect(restored.blockAttempts['reload-vpc']).toBe(1);
    const restoredSamples = await page.evaluate(() => {
      const shared = (window as any).__WECOG_STATE__;
      return {
        gaze: shared.sessionData.eyeTracking,
        eyes: shared.sessionData.eyeSignals,
      };
    });
    expect(restoredSamples.gaze).toHaveLength(2);
    expect(restoredSamples.eyes).toHaveLength(2);
    expect(restoredSamples.gaze[1].correctedX).toBe(102);
    expect(restoredSamples.eyes[1].bothOpen).toBe(false);
    await expect(page.locator('#wecog-session-modal')).toBeVisible();
    await page.locator('[data-session-modal-action]').click();
    await expect(page.locator('#step5')).toHaveClass(/active/);
    await page.waitForFunction(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return ![...runtime.machine.activeIssues.values()]
        .some((issue: any) => issue.code === 'page_reloaded');
    });
  });

  test('offline is recoverable and does not invalidate a locally recorded block', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.enterInstruction({ source: 'offline-test' });
      runtime.beginBlock({ blockId: 'offline-rt', blockType: 'rt' });
    });
    await page.context().setOffline(true);
    await page.waitForFunction(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return [...runtime.machine.activeIssues.values()]
        .some((issue: any) => issue.code === 'network_offline');
    });
    const whileOffline = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return {
        block: runtime.getCurrentBlock(),
        issue: [...runtime.machine.activeIssues.values()]
          .find((item: any) => item.code === 'network_offline'),
      };
    });
    expect(whileOffline.issue.invalidatesBlock).toBe(false);
    expect(whileOffline.block.invalid).toBe(false);

    await page.context().setOffline(false);
    await page.waitForFunction(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return ![...runtime.machine.activeIssues.values()]
        .some((issue: any) => issue.code === 'network_offline');
    });
  });

  test('technical module failure invalidates and repeats the affected block', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    const decision = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.enterInstruction({ source: 'module-error-test' });
      runtime.beginBlock({ blockId: 'module-tracking', blockType: 'tracking' });
      runtime.reportIssue({
        kind: 'technical',
        code: 'tracking_module_failed',
        message: 'Tracking module failed',
        recoverable: false,
      });
      return runtime.completeBlock({ success: false, reason: 'tracking_module_failed' });
    });
    expect(decision.repeatRequired).toBe(true);
    expect(decision.block.blockId).toBe('module-tracking');
    expect(decision.block.issueIds.length).toBe(1);
  });

  test('blink dynamics and PERCLOS use the whole measured session', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const metrics = await page.evaluate(async () => {
      const url = new URL(
        'js/gaze-tracker/attention-metrics.js',
        window.location.href,
      ).href;
      const { buildAttentionMetrics } = await import(url);
      const eyeSignals = [];
      for (let t = 0; t <= 3300; t += 33) {
        const firstBlink = t >= 900 && t <= 1080;
        const secondBlink = t >= 2100 && t <= 2280;
        const closed = firstBlink || secondBlink;
        eyeSignals.push({
          t: 1_000_000 + t,
          phase: t < 1700 ? 'calibration' : 'tracking_test',
          leftEAR: closed ? 0.09 : 0.3,
          rightEAR: closed ? 0.09 : 0.3,
          earAvg: closed ? 0.09 : 0.3,
          bothOpen: !closed,
        });
      }
      return buildAttentionMetrics({ eyeSignals, eyeTracking: [] });
    });
    expect(metrics.scope).toBe('whole_measured_session');
    expect(metrics.global.blinkDynamics.blinkCount).toBe(2);
    expect(metrics.postCalibration.blinkDynamics.blinkCount).toBe(1);
    expect(metrics.global.blinkDynamics.durationMs.mean).toBeGreaterThan(70);
    expect(metrics.global.blinkDynamics.amplitude.mean).toBeGreaterThan(0.4);
    expect(metrics.global.blinkDynamics.openingSpeed.mean).toBeGreaterThan(0);
    expect(metrics.global.perclos.windows['30s']).toBeTruthy();
  });

  test('emotion summary remains session-wide when raw samples are trimmed', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const summary = await page.evaluate(async () => {
      const url = new URL('js/emotion/public-api.js', window.location.href).href;
      const { appendEmotionSample, getEmotionSummary } = await import(url);
      const localState: any = {
        sessionData: {
          startTime: 1000,
          emotionSamples: [],
          emotionAccumulator: null,
        },
      };
      for (let i = 0; i < 10; i++) {
        appendEmotionSample(localState, {
          valence: i / 10,
          arousal: 0.5,
          dominant: 'neutral',
        }, 1000 + i * 100);
      }
      localState.sessionData.emotionSamples = [];
      return getEmotionSummary(localState.sessionData);
    });
    expect(summary.n).toBe(10);
    expect(summary.valence_mean).toBeCloseTo(0.45, 4);
    expect(summary.arousal_mean).toBe(0.5);
  });

  test('terminal checkpoint cannot be overwritten by an in-flight periodic save', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    const states = await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      const runtime = shared.runtime.sessionRuntime;
      shared.sessionData.ids.session = 'S-PLAYWRIGHT-CHECKPOINT-RACE';
      await runtime.saveCheckpoint();

      const writes: string[] = [];
      let releaseFirstWrite: () => void = () => {};
      const firstWriteGate = new Promise<void>(resolve => {
        releaseFirstWrite = resolve;
      });
      let firstWrite = true;
      runtime.checkpoints.save = async (
        _sessionId: string,
        _sessionData: unknown,
        snapshot: { state: string },
      ) => {
        writes.push(snapshot.state);
        if (firstWrite) {
          firstWrite = false;
          await firstWriteGate;
        }
        return true;
      };

      runtime.enterInstruction({ source: 'checkpoint-race-test' });
      await new Promise(resolve => setTimeout(resolve, 0));
      const finish = runtime.beginFinish();
      const completion = runtime.completeFinish(
        { source: 'checkpoint-race-test' },
        { clearCheckpoint: false },
      );
      releaseFirstWrite();
      await completion;
      return { writes, finishAccepted: finish.accepted, machine: runtime.machine.state };
    });

    expect(states.finishAccepted).toBe(true);
    expect(states.machine).toBe('completed');
    expect(states.writes.at(-1)).toBe('completed');
    expect(states.writes.slice(states.writes.lastIndexOf('completed') + 1)).toHaveLength(0);
  });

  test('finish stops camera and retries final ingest idempotently', async ({ page }) => {
    const idempotencyKeys: string[] = [];
    let ingestCalls = 0;
    await page.route('**/invitations/by-code/FINISH-TEST/ingest-token', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'participant-ingest-token' }),
      });
    });
    await page.route('**/ingest', async route => {
      ingestCalls += 1;
      idempotencyKeys.push(route.request().headers()['idempotency-key'] || '');
      await route.fulfill({
        status: ingestCalls === 1 ? 400 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          ingestCalls === 1
            ? { error: 'synthetic first-attempt rejection' }
            : { ok: true },
        ),
      });
    });

    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));

    const result = await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.ids.session = 'S-PLAYWRIGHT-FINISH';
      shared.sessionData.ids.participant = 'P-PLAYWRIGHT-FINISH';
      shared.sessionData.ids.invitationCode = 'FINISH-TEST';
      (window as any).__cameraTrackStops = 0;
      shared.runtime.cameraStream = {
        getTracks: () => [{
          stop: () => {
            (window as any).__cameraTrackStops += 1;
          },
        }],
      };

      // Resolved by the browser from the application origin, not the TS project.
      const { finishSession } = await import(
        // @ts-expect-error The production JS module intentionally has no .d.ts file.
        '/apps/participant-web/js/web-page/tests-updated.js?v=20260919-1'
      );
      const first = await finishSession();
      const firstFinishAttemptId = shared.sessionData.lifecycle.finishAttemptId;
      const second = await finishSession();
      const third = await finishSession();
      const runtime = shared.runtime.sessionRuntime;
      return {
        first,
        second,
        third,
        firstFinishAttemptId,
        finalFinishAttemptId: shared.sessionData.lifecycle.finishAttemptId,
        lifecycleState: runtime.machine.state,
        cameraTrackStops: (window as any).__cameraTrackStops,
        cameraStreamCleared: shared.runtime.cameraStream === null,
        moduleStatuses: runtime.moduleStatus,
      };
    });

    expect(result.first.ok).toBe(false);
    expect(result.second.ok).toBe(true);
    expect(result.third.ok).toBe(true);
    expect(result.third.idempotent).toBe(true);
    expect(result.lifecycleState).toBe('completed');
    expect(result.cameraTrackStops).toBe(1);
    expect(result.cameraStreamCleared).toBe(true);
    expect(Object.keys(result.moduleStatuses)).toEqual([
      'gaze',
      'blinks',
      'rt',
      'bpm',
      'emotion',
      'bodyPose',
      'audio',
      'multimodal',
    ]);
    expect(Object.values(result.moduleStatuses).every(status => status === 'stopped')).toBe(true);
    expect(ingestCalls).toBe(2);
    expect(idempotencyKeys[0]).toBeTruthy();
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(result.finalFinishAttemptId).toBe(result.firstFinishAttemptId);
    await expect(page.locator('#step7')).toHaveClass(/active/);
  });
});
