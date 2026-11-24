import { createWecogRecording } from '../../participant-web/js/emotion/atlas/wecog-frame.mjs';

const catalogUrl = new URL('../../participant-web/js/emotion/atlas/catalog.json', import.meta.url);

function element(tag, text = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
}
function labelled(parent, title, node) {
    const label = element('label', title + ' ');
    label.append(node);
    label.style.cssText = 'display:inline-block;margin:4px 12px 6px 0';
    parent.append(label);
    return node;
}
function button(parent, title) {
    const node = element('button', title);
    node.type = 'button'; node.style.margin = '4px 8px 4px 0'; parent.append(node);
    return node;
}

function paintRegions(canvas, regionFrame, video) {
    const width = video.clientWidth, height = video.clientHeight;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    if (!regionFrame || !width || !height) return;
    // The diagnostic video uses object-fit:cover, centred; the canvas uses its CSS mirror.
    const scale = Math.max(width / regionFrame.width, height / regionFrame.height);
    const w = scale * regionFrame.width, h = scale * regionFrame.height;
    ctx.strokeStyle = '#a4ffdc'; ctx.lineWidth = 1.4;
    for (const box of Object.values(regionFrame.boxes)) {
        ctx.strokeRect((width - w) / 2 + box.xMin*w, (height - h) / 2 + box.yMin*h,
            (box.xMax-box.xMin)*w, (box.yMax-box.yMin)*h);
    }
}

export async function mountAtlasPanel(runner, parent) {
    const response = await fetch(catalogUrl, {cache:'no-cache'});
    if (!response.ok) throw new Error('Atlas catalog unavailable');
    const catalog = await response.json();
    if (!catalog.version || !catalog.zones?.length || !catalog.channels?.length) throw new Error('Invalid atlas catalog');
    parent.querySelector('#atlasLoadStatus').textContent = '';
    const note = element('p', 'Запустите камеру сверху. Проверьте сторону модели, задайте код участника и блока, выберите зоны и начните отдельную нейтральную запись. Файл с признаками сохраняется по вашей команде.');
    const settings = element('fieldset'), legend = element('legend','Параметры блока');
    settings.style.padding = '10px'; settings.append(legend);
    const id = labelled(settings,'Код участника',element('input'));
    id.maxLength = 80; id.value = 'P-' + crypto.randomUUID().slice(0,8);
    const block = labelled(settings,'Код блока',element('input'));
    block.maxLength = 80; block.value = 'B-' + crypto.randomUUID().slice(0,8);
    const orientation = labelled(settings,'Проверка стороны входа модели',element('select'));
    for (const [value, title] of [['','Проверить сторону'],['normal','Левому глазу соответствует Left'],
        ['flipped','Левому глазу соответствует Right']]) {
        const option = element('option',title); option.value=value; orientation.append(option);
    }
    settings.append(element('p','Закройте только свой левый глаз и сравните два коэффициента ниже. Если сторона неразличима, повторите проверку. Зеркало предварительного просмотра влияет только на изображение.'));
    const sideReadout = element('p'); settings.append(sideReadout);
    const pad = labelled(settings,'Расширение рамок, % размера зоны',element('input'));
    pad.type = 'number'; pad.min = '0'; pad.max = '100'; pad.step = '1'; pad.value = '8';
    const hz = labelled(settings,'Целевая частота записи, Гц',element('input'));
    hz.type='number'; hz.min='5'; hz.max='30'; hz.step='1'; hz.value='20';
    const duration = labelled(settings,'Окно нейтрали, секунд',element('input'));
    duration.type='number'; duration.min='5'; duration.max='20'; duration.step='1'; duration.value='5';
    settings.append(element('p','Пилотные настройки: минимум 25 пригодных отсчётов на каждый выбранный канал. При недостаточной частоте завершите блок, скачайте его и увеличьте окно нейтрали перед новой записью. Через 30 секунд без перехода к пробе запись завершается.'));
    const checks = element('div'), zoneInputs = [];
    for (const z of catalog.zones) {
        const input = element('input');
        input.type = 'checkbox'; input.checked = ['mouth_left','mouth_right'].includes(z.id); input.value = z.id;
        const label = element('label'); label.style.cssText = 'display:inline-block;margin:4px 10px 4px 0';
        label.append(input, ' ' + (z.label_ru || z.id)); checks.append(label);
        zoneInputs.push(input);
    }
    settings.append(checks);
    const controls = element('div'), begin = button(controls,'Начать нейтральную запись'),
        task = button(controls,'Начать пробу'), stop = button(controls,'Завершить блок'),
        save = button(controls,'Скачать JSONL');
    const line = element('p'); line.setAttribute('role','status');
    const inspection = element('div');
    const pick = labelled(inspection,'Наблюдаемый канал',element('select'));
    const byName = new Map(catalog.channels.map(c => [c.name,c]));
    const key = au => au ? String(au).replace(/^AU0+/, 'AU') : null;
    const byAU = new Map(catalog.anatomy.map(a => [key(a.au), a]));
    for (const channel of catalog.channels.filter(c => c.name !== '_neutral')) {
        const option = element('option', channel.movement_ru + ' · ' + channel.name);
        option.value = channel.name; pick.append(option);
    }
    pick.value = 'mouthSmileLeft';
    const anatomyLine = element('p'), signalLine = element('p');
    function showReference() {
        const channel = byName.get(pick.value);
        const anatomy = byAU.get(key(channel?.actionUnit));
        anatomyLine.textContent = anatomy
            ? 'Гипотеза ' + channel.actionUnit + ' · ' + anatomy.action_ru + '. Возможное участие: ' + anatomy.muscles_ru +
              '. Анатомическая иннервация: ' + anatomy.branch_ru + '. ' + channel.caveat_ru
            : 'Канал движения. ' + (channel?.caveat_ru || '');
    }
    pick.addEventListener('change',showReference);
    showReference(); inspection.append(anatomyLine,signalLine);
    const graph = element('canvas'); graph.width=800; graph.height=180;
    graph.style.cssText='width:100%;height:180px;border:1px solid #778';
    graph.setAttribute('aria-label','Изменение выбранного канала относительно нейтрали, от −1 до 1');
    inspection.append(element('p','График Δ выбранного канала (−1…1); разрывы не соединяются.'),graph);
    const summary = element('p'); inspection.append(summary);
    const table = element('table'); table.style.width='100%';
    const heading=element('tr');
    for(const text of ['Канал / сторона','Коэффициент','База','Δ','Нейтраль: n / MAD','Статус / причина']) heading.append(element('th',text));
    const thead=element('thead'); thead.append(heading); table.append(thead);
    const tbody=element('tbody'); table.append(tbody);
    const tableWrap=element('div'); tableWrap.style.overflowX='auto'; tableWrap.append(table); inspection.append(tableWrap);
    parent.append(note,settings,controls,line,inspection);
    const canvas = element('canvas');
    canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;transform:scaleX(-1);pointer-events:none';
    runner.video.parentElement.append(canvas);
    let session = null, owner = null, downloaded = false, label = '', hint = '';
    function detach(reason) {
        if (owner && owner.onAtlasFrame === listener) owner.onAtlasFrame = null;
        owner = null;
        session?.stop(reason);
    }
    function listener(frame, segmented) {
        try {
            session.observe(frame, segmented, {visible:document.visibilityState !== 'hidden', now:performance.now()});
        } catch (_) {
            detach('observer_error');
        }
    }
    function refresh() {
        const now = performance.now();
        if (owner && (!runner.timer || runner.pipeline !== owner || !owner.active)) detach('camera_or_session_ended');
        const s = session?.status(now);
        if (s?.phase === 'stopped' && owner) detach(s.stopReason);
        const active = !!owner, camera = !!(runner.pipeline?.active && runner.timer && !runner.blocked);
        const last = runner.state?.runtime?.lastPrecheckResult;
        const scores = camera && Number.isFinite(last?.timestamp) && now-last.timestamp < 500 ? last.blendShapes : null;
        const value = number => Number.isFinite(number) ? number.toFixed(3) : '—';
        sideReadout.textContent = 'Закрытие века по данным модели  ·  Left ' + value(scores?.eyeBlinkLeft) + ' / Right ' + value(scores?.eyeBlinkRight);
        const latest = s?.observations.find(o => o.channel === pick.value);
        const obs = latest;
        signalLine.textContent = 'Коэффициент ' + value(obs?.absolute) +
            ' · нейтральный уровень ' + value(obs?.baseline) + ' · изменение ' + value(obs?.delta) +
            (latest?.reasons?.length ? ' · ' + latest.reasons.join(', ') : '');
        begin.disabled = !camera || active || (!!session && !downloaded);
        settings.disabled = active;
        task.disabled = !active || s?.phase !== 'neutral' || !s.ready?.readyRequired;
        stop.disabled = !active; save.disabled = !session || s.phase !== 'stopped';
        paintRegions(canvas,s?.latestBoxes,runner.video);
        const bases=s?.ready?.channels ?? s?.calibration?.channels ?? {};
        tbody.replaceChildren();
        for(const o of s?.observations ?? []) {
            const row=element('tr'), base=bases[o.channel];
            for(const text of [o.channel+' / '+o.side,value(o.absolute),value(o.baseline),value(o.delta),
                `${base?.n ?? 0} / ${value(base?.mad)}`, [...new Set([...o.reasons,...(base?.reasons ?? [])])].join(', ') || o.status]) row.append(element('td',text));
            tbody.append(row);
        }
        const win=s?.window?.channels?.find(c=>c.channel===pick.value);
        summary.textContent=s ? `Частота записи: ${value(s.observedFps)} Гц; целевая: ${s.expectedFps} Гц. Окно 2 с: медиана Δ ${value(win?.medianDelta)}, MAD ${value(win?.madDelta)}, n ${win?.n ?? 0}/${win?.nExpected ?? '—'}, покрытие ${value(win ? win.coverage*100 : null)} %, максимальный разрыв ${value(win?.largestGapMs)} мс. ${win?.reasons?.join(', ') ?? ''}` : '';
        const ctx=graph.getContext('2d'); ctx.clearRect(0,0,graph.width,graph.height);
        ctx.strokeStyle='#889'; ctx.beginPath(); ctx.moveTo(0,90); ctx.lineTo(800,90); ctx.stroke();
        const points=session?.series(pick.value) ?? [], first=points[0]?.timestampMs, lastTime=points.at(-1)?.timestampMs;
        ctx.strokeStyle='#9cce35'; ctx.lineWidth=2; ctx.beginPath(); let previous=null;
        for(const p of points) {
            if(!Number.isFinite(p.delta)||!Number.isFinite(p.timestampMs)){previous=null;continue;}
            const x=(p.timestampMs-first)/Math.max(1,lastTime-first)*800, y=(1-p.delta)*90;
            if(previous !== null && p.timestampMs-previous<=Math.max(250,2500/(s?.expectedFps ?? 20))) ctx.lineTo(x,y); else ctx.moveTo(x,y);
            previous=p.timestampMs;
        }
        ctx.stroke();
        if (hint) { line.textContent = hint; return; }
        if (!s) { line.textContent = (camera ? 'Камера готова к записи блока.' : 'Ожидание запуска камеры и завершения подготовки WECog.'); return; }
        if (s.phase === 'neutral') {
            line.textContent = 'Нейтральное лицо. Принято кадров с пригодным сигналом: ' + s.accepted +
                '. Готовых каналов: ' + s.ready.readyCount + '/' + s.ready.totalChannels +
                (s.quality.length ? '. Ограничения кадра: ' + s.quality.join(', ') : '.');
        } else if (s.phase === 'task') {
            line.textContent = 'Идёт проба. Записано кадров вместе с нейтральной фазой: ' + s.count + '.';
        } else {
            line.textContent = 'Блок завершён (' + s.stopReason + '), кадров: ' + s.count +
                (downloaded ? '. Можно начать следующий блок.' : '. Скачайте файл перед началом следующего блока.');
        }
    }
    begin.addEventListener('click', () => {
        const p = runner.pipeline;
        if (!p?.active || !runner.timer || runner.blocked || owner || (session && !downloaded)) return;
        const enabledZones = zoneInputs.filter(input => input.checked).map(input => input.value);
        if (!orientation.value || !id.value.trim() || !block.value.trim() || !pad.checkValidity() || !pad.value ||
            !hz.checkValidity() || !hz.value || !duration.checkValidity() || !duration.value ||
            !catalog.channels.some(c=>c.name !== '_neutral' && enabledZones.includes(c.zone))) {
            hint = 'Укажите сторону, непустые коды, допустимое расширение и хотя бы одну зону с сигналом.'; refresh(); return;
        }
        if (p.onAtlasFrame) { hint = 'К потоку уже подключён локальный наблюдатель.'; refresh(); return; }
        const fps = Number(hz.value);
        session = createWecogRecording(catalog, {participantId:id.value.trim(),blockId:block.value.trim(),enabledZones,
            neutralStartMs:performance.now(),expectedFps:fps,neutralDurationMs:Number(duration.value)*1000,
            inputMirrored:orientation.value === 'flipped',paddingFraction:Number(pad.value)/100,profileId:p.profile.id});
        label = block.value.replace(/[^a-zA-Zа-яА-Я0-9_-]/g,'_').slice(0,60);
        downloaded = false; owner = p; owner.onAtlasFrame = listener; hint=''; refresh();
    });
    task.addEventListener('click',() => { if (owner) session.startTask(performance.now()); refresh(); });
    stop.addEventListener('click',() => { detach('operator'); refresh(); });
    save.addEventListener('click',() => {
        if (!session || owner || runner.blocked) return;
        const blob = new Blob(session.exportLines(),{type:'application/x-ndjson'});
        const url = URL.createObjectURL(blob), a = element('a');
        a.href=url; a.download='wecog-atlas-'+label+'.jsonl';
        document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        if (!downloaded) block.value = 'B-' + crypto.randomUUID().slice(0,8);
        downloaded = true; refresh();
    });
    const timer = setInterval(refresh,250);
    const cleanup = () => { clearInterval(timer); detach('page_ended'); session = null; canvas.remove(); };
    window.addEventListener('pagehide', cleanup,{once:true});
    window.addEventListener('wecog:staffsessionblocked', () => { cleanup(); settings.disabled=true;
        for (const b of [begin,task,stop,save]) b.disabled=true;
        line.textContent='Сеанс доступа завершён.'; },{once:true});
    refresh();
}
