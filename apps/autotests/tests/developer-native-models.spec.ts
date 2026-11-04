import { test, expect } from '@playwright/test';

test('developer diagnostics start and release the real local vision models and camera track', async ({ page, baseURL, browserName }, info) => {
  await page.route('http://127.0.0.1:3000/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': baseURL!, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ headers, json: new URL(route.request().url()).pathname === '/auth/me'
      ? { id: 1, role: 'developer', email: 'synthetic@example.test', csrf_token: 'synthetic-csrf' } : {} });
  });

  await page.addInitScript(() => {
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify({ id: 1, role: 'developer', email: 'synthetic@example.test' }));
    const workers = new Map<Worker, { task: string; ready: boolean; terminated: boolean }>();
    const { postMessage, terminate } = Worker.prototype;
    Worker.prototype.postMessage = function(message, ...args) {
      if (message?.type === 'init' && ['face', 'segment', 'pose'].includes(message.task)) {
        const row = { task: message.task, ready: false, terminated: false };
        workers.set(this, row);
        const listener = ({ data }: MessageEvent) => {
          if (data?.id !== message.id) return;
          row.ready = data.result === true || data.result?.ready === true;
          this.removeEventListener('message', listener);
        };
        this.addEventListener('message', listener);
      }
      Reflect.apply(postMessage, this, [message, ...args]);
    };
    Worker.prototype.terminate = function() {
      const row = workers.get(this);
      if (row) row.terminated = true;
      terminate.call(this);
    };

    // Exercise real browser video/frame capture without opening a physical camera.
    const tracks: MediaStreamTrack[] = [];
    const getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      const paint = () => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
      paint();
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0];
      const interval = window.setInterval(paint, 33);
      const stop = track.stop.bind(track);
      track.stop = () => { window.clearInterval(interval); stop(); };
      tracks.push(track);
      return stream;
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.assign(window, { diagnosticEvidence: () => ({
      tracks: tracks.map(track => track.readyState),
      videoAttached: Boolean(document.querySelector('video')?.srcObject),
      workers: [...workers.values()],
    }) });
  });

  const evidence = () => page.evaluate(() => (window as any).diagnosticEvidence());
  await page.goto('/apps/web/developer/bpm-test.html');
  try {
    await page.locator('#btnStart').click();
    await expect(page.locator('#screen')).toHaveClass(/running/, { timeout: 70_000 });
    const running = await evidence();
    expect(running).toMatchObject({ tracks: ['live'], videoAttached: true });
    expect(running.workers).toContainEqual({ task: 'face', ready: true, terminated: false });
    if (browserName !== 'webkit') {
      expect(running.workers).toContainEqual({ task: 'segment', ready: true, terminated: false });
    }
    await page.locator('#btnStop').click();
    await expect.poll(evidence).toMatchObject({ tracks: ['ended'], videoAttached: false });
    expect((await evidence()).workers.every((worker: { terminated: boolean }) => worker.terminated)).toBe(true);
  } finally {
    await info.attach('developer-vision-lifecycle', {
      body: JSON.stringify({ status: await page.locator('#status').textContent(), ...await evidence() }),
      contentType: 'application/json',
    });
  }
});
