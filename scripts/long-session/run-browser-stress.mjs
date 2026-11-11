import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modulePath = process.env.WECOG_PLAYWRIGHT_MODULE || path.resolve(root,
    'apps/autotests/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(modulePath));
const wallMs = Number(process.env.LONG_SESSION_WALL_MS || 25000);
const minutes = (process.env.LONG_SESSION_MINUTES || '40,125').split(',').filter(Boolean).map(Number);
if (wallMs < 5000 || wallMs > 120000 || minutes.some(n => !Number.isInteger(n) || n < 1 || n > 240)) throw new Error('Invalid bounded stress duration');
const server = http.createServer(async (req, res) => {
    try {
        if (req.url === '/__long-session.html') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><title>Isolated long-session technical test</title>Local synthetic data only');
            return;
        }
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const filename = path.resolve(root, '.' + pathname);
        if (!filename.startsWith(root + path.sep) || !/\.(mjs|js)$/.test(filename)) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'no-store');
        res.end(await fs.readFile(filename));
    } catch (_) { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'emocog-long-session-'));
let context;
const result = { schemaVersion: 'long_session_technical_evidence.v1', executedAt: new Date().toISOString(),
    sensors: false, network: 'loopback static files only; no API or server DB', accelerated: [] };
const launch = () => chromium.launchPersistentContext(profile, { headless: true, args: ['--enable-precise-memory-info'] });
const pageReady = async () => {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(120000);
    await page.goto(origin + '/__long-session.html');
    await page.evaluate(async () => { globalThis.stress = await import('/scripts/long-session/browser-stress.mjs'); });
    return page;
};
try {
    context = await launch();
    let page = await pageReady();
    result.browserVersion = context.browser()?.version() || 'persistent Chromium';
    for (const duration of minutes) {
        console.log(`Accelerating ${duration} minutes through actual IndexedDB...`);
        result.accelerated.push(await page.evaluate(n => stress.accelerated(n), duration));
    }
    result.faults = await page.evaluate(() => stress.faults());
    result.versionChange = await page.evaluate(() => stress.versionChange());
    const cdp = await context.newCDPSession(page);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1024 * 1024 });
    console.log('Quota override:', await cdp.send('Storage.getUsageAndQuota', { origin }));
    result.quota = await page.evaluate(() => stress.quota('long-session-isolated-quota'));
    await cdp.send('Storage.overrideQuotaForOrigin', { origin });
    await page.evaluate(() => { sessionStorage.clear(); indexedDB.deleteDatabase('long-session-isolated-quota'); });
    console.log(`Running ${wallMs} ms real-clock stability with a bounded actual main-thread stall...`);
    await page.evaluate(() => stress.realtimeStart());
    await new Promise(resolve => setTimeout(resolve, wallMs / 3));
    await page.evaluate(() => { const until = performance.now() + 2500; while (performance.now() < until) {} });
    await new Promise(resolve => setTimeout(resolve, wallMs * 2 / 3 - 2500));
    result.realtime = await page.evaluate(() => stress.realtimeFinish());
    const restartName = 'long-session-isolated-restart';
    const expected = await page.evaluate(name => stress.seedRestart(name), restartName);
    await context.close();
    context = await launch();
    page = await pageReady();
    result.restart = await page.evaluate(({ name, expected }) => stress.verifyRestart(name, expected), { name: restartName, expected });
    result.limitations = [
        'Accelerated synthetic capture-clock samples, not 40-minute or 2-hour physical-camera validation.',
        'Real-clock run includes a 2.5-second busy main-thread stall, not OS sleep or mobile power management; visibility transitions are deterministic tests.',
        'Chromium reported the CDP quota override active but accepted bounded over-quota writes; quota recovery uses labeled QuotaExceededError injection.',
        'No API, working server database, physical sensors or full end-to-end participant workflow exercised.',
        'Source eyeSignals remain unbounded until an exact streaming attention accumulator is integrated upstream.'
    ];
    const output = process.env.LONG_SESSION_REPORT || path.join(root, 'docs/reports/2026-11-05-long-session-stress.json');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
} finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
}
