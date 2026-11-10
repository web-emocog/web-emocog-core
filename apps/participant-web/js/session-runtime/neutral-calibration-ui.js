export function prepareNeutralCalibration(pipeline, language = 'ru') {
    const calibration = pipeline?.neutralCalibration;
    if (!calibration || ['ready', 'skipped'].includes(calibration.status)) return Promise.resolve(true);
    if (pipeline.neutralPreparationPromise) return pipeline.neutralPreparationPromise;
    const en = language !== 'ru';
    const promise = new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.id = 'emotionNeutralCalibration';
        dialog.setAttribute('aria-labelledby', 'emotionNeutralTitle');
        dialog.style.cssText = 'max-width:560px;width:calc(100% - 40px);box-sizing:border-box;padding:28px;border:1px solid #ccd5cf;border-radius:18px;background:#fff;color:#10251d;';
        const title = document.createElement('h2');
        title.id = 'emotionNeutralTitle'; title.textContent = en ? 'Neutral facial expression' : 'Настройка нейтральной мимики';
        const text = document.createElement('p');
        text.textContent = en
            ? 'Look at the screen with a relaxed face for at least five seconds. You may blink naturally. Stay silent; no special expression is needed.'
            : 'Не менее пяти секунд спокойно смотрите на экран с расслабленным лицом. Можно естественно моргать. Не разговаривайте; изображать какую-либо эмоцию не нужно.';
        const progress = document.createElement('p'); progress.id = 'emotionNeutralProgress';
        progress.setAttribute('aria-live', 'polite');
        const begin = document.createElement('button'); begin.id = 'emotionNeutralStart';
        begin.textContent = en ? 'Start' : 'Начать';
        const skip = document.createElement('button'); skip.id = 'emotionNeutralSkip';
        skip.textContent = en ? 'Continue without facial-expression estimates' : 'Продолжить без оценки мимики';
        for (const button of [begin, skip]) button.style.cssText = 'margin:8px 8px 0 0;padding:12px;border-radius:10px;cursor:pointer;';
        dialog.append(title, text, progress, begin, skip);
        document.body.appendChild(dialog);
        let settled = false;
        const save = () => {
            const snapshot = calibration.snapshot(performance.now());
            pipeline.state.runtime.emotionCalibration = snapshot;
            pipeline.state.sessionData.tech.emotionCalibration = snapshot;
        };
        const finish = value => {
            if (settled) return;
            settled = true; clearInterval(timer);
            window.removeEventListener('pagehide', cancelled);
            save();
            if (dialog.open) dialog.close();
            dialog.remove(); resolve(value);
        };
        const cancelled = () => finish(false);
        const refresh = () => {
            if (!pipeline.isRunning()) { finish(false); return; }
            const snapshot = calibration.add(null, performance.now());
            save();
            if (snapshot.status === 'ready') { finish(true); return; }
            if (snapshot.status === 'timeout') {
                progress.textContent = en ? 'Not enough usable measurements. Check the lighting and camera, then try again.'
                    : 'Не хватает качественных измерений. Проверьте свет и камеру, затем попробуйте ещё раз.';
                begin.disabled = false; begin.textContent = en ? 'Try again' : 'Попробовать ещё раз';
            } else if (snapshot.status === 'collecting') {
                const seconds = Math.max(0, Math.ceil((snapshot.minDurationMs - snapshot.elapsedMs) / 1000));
                progress.textContent = en ? `Usable measurements: ${snapshot.acceptedSamples}/${snapshot.requiredSamples}. At least ${seconds} s remaining.`
                    : `Качественных измерений: ${snapshot.acceptedSamples}/${snapshot.requiredSamples}. Осталось не менее ${seconds} с.`;
            }
        };
        begin.onclick = () => { calibration.begin(performance.now()); begin.disabled = true; refresh(); };
        skip.onclick = () => { calibration.skip(); finish(true); };
        dialog.addEventListener('cancel', event => { event.preventDefault(); calibration.skip(); finish(true); });
        const timer = setInterval(refresh, 100);
        window.addEventListener('pagehide', cancelled, { once: true });
        try { dialog.showModal(); begin.focus(); }
        catch (_) { finish(false); }
    });
    pipeline.neutralPreparationPromise = promise;
    return promise.finally(() => { pipeline.neutralPreparationPromise = null; });
}
