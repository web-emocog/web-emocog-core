import { test, expect } from '@playwright/test';

const root = 'http://127.0.0.1:4173';

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto(`${root}/apps/web/developer/login.html`);
});

test('real dedicated worker preserves new and already-open-page checkpoint requests', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const base = '/apps/participant-web/js/session-runtime/';
    // @ts-ignore Browser-native ESM loaded from the static test server.
    const { createCheckpointRequest, isCheckpointResponse } = await import(`${base}checkpoint-messages.mjs?v=20261019-5`);
    const source = { ids: { session: 'synthetic-worker-session', participant: 'synthetic-participant' },
      checkpointViewport: { width: 1280, height: 720 }, events: [] };
    const worker = new Worker(`${base}aggregate-worker.mjs?v=20261019-5`, { type: 'module' });
    const exchange = (request: any) => new Promise<any>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('worker-response-timeout')), 5000);
      worker.onmessage = event => { clearTimeout(deadline); resolve({ data: event.data, trusted: event.isTrusted }); };
      worker.onerror = () => { clearTimeout(deadline); reject(new Error('worker-failed')); };
      worker.postMessage(request);
    });
    try {
      const request = createCheckpointRequest(source);
      const current = await exchange(request);
      const legacy = await exchange(source);
      return { currentValid: isCheckpointResponse(current.data, request), trusted: current.trusted,
        currentSession: current.data.packet?.ids?.session, legacySession: legacy.data.packet?.ids?.session,
        legacyRequestId: legacy.data.requestId };
    } finally { worker.terminate(); }
  });
  expect(result).toEqual({ currentValid: true, trusted: true, currentSession: 'synthetic-worker-session',
    legacySession: 'synthetic-worker-session', legacyRequestId: null });
});

test('importing the worker entry in a page never installs a window message handler', async ({ page }) => {
  const unchanged = await page.evaluate(async () => {
    const before = window.onmessage;
    // @ts-ignore Browser-native ESM loaded from the static test server.
    await import('/apps/participant-web/js/session-runtime/aggregate-worker.mjs?v=20261019-5');
    return window.onmessage === before;
  });
  expect(unchanged).toBe(true);
});
