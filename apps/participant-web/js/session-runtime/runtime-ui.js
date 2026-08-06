import { ERROR_KINDS, SESSION_STATES } from './contracts.mjs';

const POLICY_TEXT = {
    ru: {
        title: 'Условия проведения',
        body: 'Не проходите исследование в движущемся транспорте, в темноте, при ярком свете за спиной, лёжа или с закрытым лицом. Допустимы краткие естественные движения головы и небольшие изменения освещения. Если качество станет недостаточным, система предупредит вас и повторит затронутый блок.',
        note: 'Пауза доступна только на экране инструкции. Во время задания остановка запрещена.',
        continue: 'Понятно, продолжить',
        pause: 'Пауза',
        resume: 'Продолжить сессию',
        repeat: 'Условия восстановлены, повторить блок',
        repeatTrials: 'Начать повтор проб',
        repeatLimit: 'Продолжить сессию',
        recoveryTitle: 'Сессия восстановлена',
        recoveryBody: 'Страница была перезагружена. Камеру и персональную калибровку необходимо запустить заново; прерванное испытание будет повторено.',
        recoveryAction: 'Перейти к проверке камеры'
    },
    en: {
        title: 'Test conditions',
        body: 'Do not take the study in a moving vehicle, in darkness, with strong backlight, while lying down, or with your face covered. Brief natural head movements and small lighting changes are allowed. If quality becomes insufficient, the affected block will be repeated.',
        note: 'Pause is available only on instruction screens and is disabled during a task.',
        continue: 'Continue',
        pause: 'Pause',
        resume: 'Resume session',
        repeat: 'Conditions restored, repeat block',
        repeatTrials: 'Repeat invalid trials',
        repeatLimit: 'Continue session',
        recoveryTitle: 'Session restored',
        recoveryBody: 'The page was reloaded. Camera analysis and personal calibration must be started again; the interrupted task will be repeated.',
        recoveryAction: 'Go to camera check'
    }
};

function langText(getLanguage) {
    const lang = getLanguage() === 'en' ? 'en' : 'ru';
    return POLICY_TEXT[lang];
}

function russianTrialWord(value) {
    const count = Math.abs(Number(value) || 0);
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'проб';
    if (last === 1) return 'проба';
    if (last >= 2 && last <= 4) return 'пробы';
    return 'проб';
}

export class SessionRuntimeUI {
    constructor(options = {}) {
        this.getLanguage = options.getLanguage || (() => 'ru');
        this.onPause = options.onPause || (() => {});
        this.onResume = options.onResume || (() => {});
        this.root = null;
        this.alert = null;
        this.pauseButton = null;
        this.modal = null;
        this.modalResolve = null;
    }

    init() {
        if (typeof document === 'undefined' || this.root) return;
        const style = document.createElement('style');
        style.id = 'wecog-session-runtime-style';
        style.textContent = `
          #wecog-session-runtime{position:fixed;inset:0;z-index:10050;pointer-events:none;font-family:inherit}
          #wecog-session-alert{position:absolute;left:50%;top:18px;transform:translateX(-50%);width:min(680px,calc(100% - 32px));padding:12px 16px;border:1px solid #d97706;border-radius:12px;background:#fffbeb;color:#7c2d12;box-shadow:0 12px 30px rgba(15,23,42,.18);display:none;pointer-events:auto}
          #wecog-session-alert[data-kind="technical"]{border-color:#dc2626;background:#fef2f2;color:#7f1d1d}
          #wecog-session-pause{position:absolute;right:20px;bottom:20px;display:none;padding:10px 16px;border:1px solid #0f172a;border-radius:10px;background:#fff;color:#0f172a;font-weight:700;pointer-events:auto;cursor:pointer}
          #wecog-session-modal{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.68);pointer-events:auto}
          .wecog-session-card{width:min(600px,100%);padding:28px;border-radius:18px;background:#fff;color:#0f172a;box-shadow:0 24px 80px rgba(0,0,0,.3)}
          .wecog-session-card h2{margin:0 0 12px;font-size:25px}
          .wecog-session-card p{margin:0 0 12px;line-height:1.55;color:#334155}
          .wecog-session-card .note{padding:12px;border-radius:10px;background:#f1f5f9;color:#0f172a;font-weight:600}
          .wecog-session-card button{width:100%;margin-top:18px;padding:12px 18px;border:0;border-radius:10px;background:#0f172a;color:#fff;font-weight:700;cursor:pointer}
        `;
        document.head.appendChild(style);

        this.root = document.createElement('div');
        this.root.id = 'wecog-session-runtime';
        this.root.innerHTML = `
          <div id="wecog-session-alert" role="status" aria-live="assertive"></div>
          <button id="wecog-session-pause" type="button"></button>
          <div id="wecog-session-modal" role="dialog" aria-modal="true">
            <div class="wecog-session-card">
              <h2 data-session-modal-title></h2>
              <p data-session-modal-body></p>
              <p class="note" data-session-modal-note></p>
              <button type="button" data-session-modal-action></button>
            </div>
          </div>
        `;
        document.body.appendChild(this.root);
        this.alert = this.root.querySelector('#wecog-session-alert');
        this.pauseButton = this.root.querySelector('#wecog-session-pause');
        this.modal = this.root.querySelector('#wecog-session-modal');
        this.pauseButton.onclick = () => this.onPause();
        this._refreshText();
    }

    _refreshText() {
        if (!this.root) return;
        const text = langText(this.getLanguage);
        this.pauseButton.textContent = text.pause;
    }

    updateState(snapshot) {
        this.init();
        this._refreshText();
        const pauseAllowed = snapshot?.state === SESSION_STATES.INSTRUCTION
            && snapshot?.currentBlock?.stage !== 'trial';
        this.pauseButton.style.display = pauseAllowed ? 'block' : 'none';

        if (snapshot?.state === SESSION_STATES.PAUSED && !this.modalResolve) {
            const text = langText(this.getLanguage);
            this._showModal({
                title: text.pause,
                body: '',
                note: text.note,
                action: text.resume
            }).then(() => this.onResume());
        }
    }

    showIssue(issue, duringTest, blockType = null) {
        this.init();
        this.alert.dataset.kind = issue?.kind || ERROR_KINDS.QUALITY;
        const repeatsTrial = ['cognitive_task', 'rt', 'rt_gonogo'].includes(
            String(blockType || '').toLowerCase()
        );
        const repeatText = duringTest
            ? (this.getLanguage() === 'en'
                ? (repeatsTrial
                    ? ' The current trial will be repeated.'
                    : ' The current block will be repeated.')
                : (repeatsTrial
                    ? ' Текущая проба будет повторена.'
                    : ' Текущий блок будет повторён.'))
            : '';
        this.alert.textContent = `${issue?.message || 'Ошибка качества.'}${repeatText}`;
        this.alert.style.display = 'block';
    }

    hideIssue() {
        if (this.alert) this.alert.style.display = 'none';
    }

    async showPolicy() {
        const text = langText(this.getLanguage);
        return this._showModal({
            title: text.title,
            body: text.body,
            note: text.note,
            action: text.continue
        });
    }

    async showRepeat(repeat) {
        const text = langText(this.getLanguage);
        const reason = repeat?.reason || 'quality_or_technical_issue';
        const count = Number(repeat?.repeatItemCount) || 0;
        const total = Number(repeat?.totalItemCount) || 0;
        const issues = Array.isArray(repeat?.issues)
            ? [...new Map(repeat.issues.map(issue => [issue.code || issue.issueId, issue])).values()]
            : [];
        const reasons = issues.map(issue => issue.message).filter(Boolean).join('; ');
        const hasTrials = count > 0;
        const body = this.getLanguage() === 'en'
            ? (
                hasTrials
                    ? `${count}${total ? ` of ${total}` : ''} trials were not accepted.${reasons ? ` Reasons: ${reasons}.` : ''} Only these ${count} trials will now be repeated.`
                    : `The previous attempt was not accepted (${reason}). Correct the conditions before continuing.`
            )
            : (
                hasTrials
                    ? `Не засчитано ${count} ${russianTrialWord(count)}${total ? ` из ${total}` : ''}.${reasons ? ` Причины: ${reasons}.` : ''} Сейчас будут повторены только незасчитанные пробы (${count}).`
                    : `Предыдущая попытка не принята (${reason}). Исправьте условия перед продолжением.`
            );
        return this._showModal({
            title: this.getLanguage() === 'en'
                ? (hasTrials ? 'Some trials must be repeated' : 'Block must be repeated')
                : (hasTrials ? 'Часть проб необходимо повторить' : 'Блок необходимо повторить'),
            body,
            note: hasTrials ? '' : text.note,
            action: hasTrials ? text.repeatTrials : text.repeat
        });
    }

    async showRepeatLimit(repeat) {
        const count = Number(repeat?.repeatItemCount) || 0;
        const text = langText(this.getLanguage);
        return this._showModal({
            title: this.getLanguage() === 'en'
                ? 'Quality limit reached'
                : 'Достигнут лимит повторов',
            body: this.getLanguage() === 'en'
                ? `${count || 'Some'} trials still do not meet the quality criteria. Their data will remain marked invalid; the session will continue without another loop.`
                : `Незасчитанные пробы (${count || 'несколько'}) всё ещё не соответствуют критериям качества. Их данные останутся помечены как невалидные, но сессия продолжится без нового цикла.`,
            note: '',
            action: text.repeatLimit
        });
    }

    async showReloadRecovery() {
        const text = langText(this.getLanguage);
        return this._showModal({
            title: text.recoveryTitle,
            body: text.recoveryBody,
            note: text.note,
            action: text.recoveryAction
        });
    }

    _showModal(content) {
        this.init();
        if (this.modalResolve) return Promise.resolve(false);
        const title = this.modal.querySelector('[data-session-modal-title]');
        const body = this.modal.querySelector('[data-session-modal-body]');
        const note = this.modal.querySelector('[data-session-modal-note]');
        const action = this.modal.querySelector('[data-session-modal-action]');
        title.textContent = content.title || '';
        body.textContent = content.body || '';
        body.style.display = content.body ? 'block' : 'none';
        note.textContent = content.note || '';
        note.style.display = content.note ? 'block' : 'none';
        action.textContent = content.action || 'OK';
        this.modal.style.display = 'flex';
        this.pauseButton.style.display = 'none';
        return new Promise(resolve => {
            this.modalResolve = resolve;
            action.onclick = () => {
                action.onclick = null;
                this.modal.style.display = 'none';
                const done = this.modalResolve;
                this.modalResolve = null;
                done(true);
            };
        });
    }
}
