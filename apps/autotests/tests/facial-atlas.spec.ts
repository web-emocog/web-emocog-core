import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// UI/recording tests with a synthetic host. No camera, model or accuracy claims.
const host = `
export function mountProtocolDiagnostic() {
 const runner={video:document.getElementById('video'),pipeline:null,timer:null,state:null};
 window.atlasHost=runner;
 document.getElementById('btnStart').onclick=async()=>{
  const catalog=await (await fetch('/apps/participant-web/js/emotion/atlas/catalog.json')).json();
  const pipeline=runner.pipeline={active:true,profile:{id:'fixture'},schedule:{targetIntervalMs:33}};
  runner.state={runtime:{}};
  runner.timer=setInterval(()=>{
   const frame={timestamp:performance.now(),frameSize:{width:640,height:480},
    face:{detected:true,status:'optimal'},illumination:{status:'optimal'},
    pose:{status:'stable',isTilted:false,yaw:0,pitch:0,roll:0},
    landmarks:Array.from({length:478},(_,i)=>({x:.2+.6*((i*31)%478)/478,y:.2+.6*((i*7)%478)/478})),
    blendShapes:Object.fromEntries(catalog.channels.map(c=>[c.name,c.name==='mouthSmileLeft' ? (window.smile ?? .1) : .1]))};
   if(window.missingRight) delete frame.blendShapes.mouthSmileRight;
   runner.state.runtime.lastPrecheckResult=frame;
   pipeline.onAtlasFrame?.(frame,true);
  },50);
 };
 runner.stop=()=>{clearInterval(runner.timer);runner.timer=null;if(runner.pipeline)runner.pipeline.active=false;runner.pipeline=null;};
 document.getElementById('btnStop').onclick=runner.stop;
 return runner;
}`;

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.route('**/protocol-diagnostic-page.mjs*', r=>r.fulfill({contentType:'text/javascript',body:host}));
  await page.route('**/auth-guard.js*', r=>r.fulfill({contentType:'text/javascript',body:
    'window.EmocogAuthGuard={ensureProtectedPage:()=>Promise.resolve({ok:true,user:{id:1,role:"developer"}})};'}));
  for (const path of ['staff-session.js','account-storage.js','developer-shell.js']) {
    await page.route(`**/${path}*`,r=>r.fulfill({contentType:'text/javascript',body:''}));
  }
  await page.goto('/apps/web/developer/facial-atlas-test.html');
  await expect(page.getByText('Наблюдаемый канал', {exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Запустить камеру',exact:true}).click();
  await page.waitForFunction(()=>!!(window as any).atlasHost.timer);
  await page.clock.runFor(300);
  await page.getByLabel('Проверка стороны входа модели').selectOption('normal');
});

test('calibration, signed signal, stop and local download retain provenance without landmarks',async({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'Начать нейтральную запись',exact:true}).click();
  await page.clock.runFor(5500);
  await expect(page.getByRole('button',{name:'Начать пробу',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Начать пробу',exact:true}).click();
  await page.evaluate(()=>{(window as any).smile=.6;});
  await page.clock.runFor(2500);
  await expect(page.getByText(/Коэффициент 0.600 · нейтральный уровень 0.100 · изменение 0.500/)).toBeVisible();
  await page.getByRole('button',{name:'Остановить камеру',exact:true}).click();
  await page.clock.runFor(300);
  await expect(page.getByRole('button',{name:'Скачать JSONL',exact:true})).toBeEnabled();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Скачать JSONL',exact:true}).click();
  const download=await downloadPromise;
  const text=await readFile((await download.path())!,'utf8');
  const rows=text.trim().split('\n').map(JSON.parse);
  expect(rows[0].stopReason).toBe('camera_or_session_ended');
  expect(rows[0].calibration.frozen).toBe(true);
  expect(rows[0].provenance.expectedFps).toBe(20);
  expect(rows.at(-1).observations.find((o:any)=>o.channel==='mouthSmileLeft').delta).toBeCloseTo(.5);
  expect(text).not.toMatch(/"landmarks"|"pixels"/);
  expect(errors).toEqual([]);
});

test('one missing mandatory channel prevents task start and pagehide detaches observer',async({page})=>{
  await page.evaluate(()=>{(window as any).missingRight=true;});
  await page.getByRole('button',{name:'Начать нейтральную запись',exact:true}).click();
  await page.clock.runFor(5500);
  await expect(page.getByRole('button',{name:'Начать пробу',exact:true})).toBeDisabled();
  await expect(page.locator('tbody')).toContainText('missing_channel');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  expect(await page.evaluate(()=> (window as any).atlasHost.pipeline.onAtlasFrame)).toBeNull();
});
