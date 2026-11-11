import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAutomation } from '../reference-data/automation.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { engines, version } = await loadAutomation(root);
const allowed = new Set([
    'scripts/long-session/physiology-browser.mjs', 'scripts/long-session/physiology-fixtures.mjs',
    'apps/participant-web/js/session-runtime/physiology-intervals.mjs',
    'apps/participant-web/js/session-runtime/checkpoint-store.mjs',
    'apps/participant-web/js/session-runtime/long-session-retention.mjs'
]);
const server = http.createServer(async (req, res) => {
    const origin = 'http://127.0.0.1:' + server.address().port;
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)
        || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local physiology recovery tests</title>'); return; }
    const relative = pathname.slice(1);
    if (!allowed.has(relative)) { res.writeHead(404).end(); return; }
    try {
        res.setHeader('Content-Type', 'text/javascript');
        const data = await fs.readFile(path.join(root, relative)); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (_) { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
const report = { schemaVersion: 'physiology_browser_recovery.v1', at: new Date().toISOString(), automationVersion: version,
    physicalSensors: false, network: 'loopback only, isolated randomly named IndexedDB databases', browsers: [],
    limitations: ['Accelerated estimates, not physical capture or thermal/performance acceptance.',
        'Store re-instantiation models reload; full process restart is covered separately, not by this harness.',
        'No API, PostgreSQL, real participant UI or physiological ground truth.'] };
let browser;
try {
    for (const engine of ['chromium', 'firefox', 'webkit']) {
        browser = await engines[engine].launch({ headless: true });
        const context = await browser.newContext({ permissions: [] });
        await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
        const page = await context.newPage(); page.setDefaultTimeout(120000);
        await page.goto(origin);
        await page.evaluate(async () => { globalThis.audit = await import('/scripts/long-session/physiology-browser.mjs'); });
        const row = { engine, version: browser.version(), accelerated: [] };
        for (const minutes of [40, 125]) row.accelerated.push(await page.evaluate(n => audit.runPhysiologyBrowser(n), minutes));
        row.faults = await page.evaluate(() => audit.physiologyFaults());
        report.browsers.push(row);
        console.log(engine, JSON.stringify(row));
        await browser.close(); browser = null;
    }
    const output = path.resolve(process.env.PHYSIOLOGY_BROWSER_REPORT || path.join(root, 'docs/reports/2026-11-06-physiology-browser-recovery.json'));
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(output);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
