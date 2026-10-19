import { test, expect, Page } from '@playwright/test';

const base = 'http://127.0.0.1:4173';
const participant = `${base}/apps/participant-web/mvp_with_precheck_1-updated.html`;

async function openTrials(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('emocog_protocol_step_draft', '3');
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{
      id: 'custom-keys', type: 'cognitive_task', label: 'Custom keys', content: {
        taskType: 'simple_rt', responseMode: 'keypress', rtMin: 100, rtWindow: 2000, trials: ['space', 'KeyX', 'Period'].map(action => ({
          stimulusId: 'std_simple_black_square', action, duration: 1000, repetitions: 1
        }))
      }
    }]));
  });
  await page.goto(`${base}/apps/web/researcher.html?analyticsPreview=1#/experiments/builder`);
  await page.locator('.open-trials-btn').click();
}

test('captures a physical custom key, cancels without changes, and preserves the confirmed choice', async ({ page }) => {
  await openTrials(page);
  await page.locator('.t-action').first().selectOption('__custom__');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.save-key')).toBeDisabled();
  await page.keyboard.press('Control+d');
  await expect(dialog.locator('.save-key')).toBeDisabled();
  await page.keyboard.press('KeyD');
  await expect(dialog.locator('.captured-key')).toContainText('В / D');
  await dialog.locator('.captured-key').evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', repeat: true, bubbles: true })));
  await expect(dialog.locator('.save-key')).toBeEnabled();
  await dialog.locator('.cancel-key').click();
  await expect(page.locator('.t-action').first()).toHaveValue('space');
  await page.locator('.t-action').first().selectOption('__custom__');
  await page.keyboard.press('KeyD');
  await dialog.locator('.save-key').click();
  await expect(page.locator('.t-action').first()).toHaveValue('KeyD');
  await page.locator('#trialSaveBtn').click();
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('.t-action').first()).toHaveValue('KeyD');
  await page.locator('.t-action').first().selectOption('__custom__');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.t-action').first()).toHaveValue('KeyD');
});

test('allows keyboard-only confirmation of Enter while keeping numpad keys distinct', async ({ page }) => {
  await openTrials(page);
  await page.locator('.t-action').first().selectOption('__custom__');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.captured-key')).toContainText('Enter');
  await dialog.locator('.save-key').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.t-action').first()).toHaveValue('Enter');
  await page.locator('.t-action').nth(1).selectOption('__custom__');
  await page.keyboard.press('Numpad1');
  await expect(dialog.locator('.captured-key')).toContainText('Numpad 1');
  await dialog.locator('.save-key').click();
  await expect(page.locator('.t-action').nth(1)).toHaveValue('Numpad1');
});

test('binds only checked trials and offers all five CVBNM presets', async ({ page }) => {
  await openTrials(page);
  for (const code of ['KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM']) {
    await expect(page.locator('.t-action').first().locator(`option[value="${code}"]`)).toHaveCount(1);
  }
  await page.locator('.trial-select').nth(0).check();
  await page.locator('.trial-select').nth(2).check();
  await page.locator('#bulkResponseAction').selectOption('__custom__');
  await page.keyboard.press('Digit7');
  await page.getByRole('dialog').locator('.save-key').click();
  expect(await page.locator('.t-action').evaluateAll(items => items.map(item => (item as HTMLSelectElement).value))).toEqual(['Digit7', 'KeyX', 'Digit7']);
  await page.locator('#bulkResponseAction').selectOption('');
  await page.locator('#applyBulkResponse').click();
  await expect(page.locator('#responseModeSel')).toHaveValue('keypress');
  expect(await page.locator('.t-action').evaluateAll(items => items.map(item => (item as HTMLSelectElement).value))).toEqual(['', 'KeyX', '']);
  await page.locator('#selectAllTrials').check();
  await page.locator('#bulkResponseAction').selectOption('KeyM');
  await page.locator('#applyBulkResponse').click();
  await page.locator('#trialSaveBtn').click();
  await page.locator('.open-trials-btn').click();
  expect(await page.locator('.t-action').evaluateAll(items => items.map(item => (item as HTMLSelectElement).value))).toEqual(['KeyM', 'KeyM', 'KeyM']);
});

for (const [code, ru] of [['KeyD', 'в'], ['KeyC', 'с'], ['KeyV', 'м'], ['KeyB', 'и'], ['KeyN', 'т'], ['KeyM', 'ь']]) {
  for (const layout of ['en', 'ru']) {
    test(`custom response ${code} in ${layout} is instructed and recorded correctly`, async ({ page }) => {
      await page.goto(participant);
      await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
      await page.evaluate(async ({ code }) => {
        const shared = (window as any).__WECOG_STATE__;
        shared.currentLang = 'en';
        shared.runtime.sessionRuntime.policyShown = true;
        const { loadAndStartCognitiveTask } = await import(new URL('js/web-page/experimental_task-updated.js?v=20261019-5', location.href).href);
        await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'custom-keys-test', blocks: [
          { id: 'instructions', type: 'instruction', content: { titleEn: 'Custom response', textEn: 'When the stimulus appears, press Space quickly. Keep looking at the center.' } },
          { id: 'keys', type: 'cognitive_task', taskType: 'simple_rt', blockConfig: { responseMode: 'keypress', useFixation: false },
            trials: [{ stimulusId: 'std_simple_black_square', action: code, duration: 5000 }] }
        ] } });
      }, { code });
      await expect(page.locator('#cogText')).toContainText(code.slice(-1));
      await expect(page.locator('#cogText')).not.toContainText('{response}');
      await expect(page.locator('#cogText')).not.toContainText('Space');
      await expect(page.locator('#cogText')).toContainText('Keep looking at the center.');
      await page.locator('#cogStartBtn').click();
      if (await page.locator('#cogStartBtn').isVisible()) await page.locator('#cogStartBtn').click();
      await expect(page.locator('#cogShape')).toBeVisible();
      await page.waitForTimeout(180);
      if (layout === 'en') await page.keyboard.press(code);
      else await page.evaluate(({ code, key }) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
      }, { code, key: ru });
      await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
      const result = await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0]);
      expect(result).toMatchObject({ response: code, expectedResponse: code, correct: true });
      expect(result.rt).toBeGreaterThan(0);
    });
  }
}

test('stable entry loads media using the resolved immutable invitation, not the old entry code', async ({ page }) => {
  const requests: string[] = [];
  await page.route('http://127.0.0.1:3000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const headers = { 'Access-Control-Allow-Origin': base };
    if (path === '/invitations/by-code/stable-entry') return route.fulfill({ headers, json: {
      code: 'version-two', invitation_id: 2, protocol_id: 1, project_id: 1, publication_version: 2,
      definition: { version: 'test', blocks: [{ type: 'passive', trials: [{ stimulusId: '42' }] }] }
    } });
    if (path === '/invitations/by-code/version-two/stimuli') return route.fulfill({ headers, json: [{ id: 42, name: 'Text', mime_type: 'text/plain', metadata: { text: 'Version two' } }] });
    return route.fulfill({ headers, json: {} });
  });
  await page.goto(`${participant}?code=stable-entry`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationProtocolMeta?.code === 'version-two');
  expect(requests).toContain('/invitations/by-code/version-two/stimuli');
  expect(requests).not.toContain('/invitations/by-code/stable-entry/stimuli');
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.invitationCode)).toBe('version-two');
});
