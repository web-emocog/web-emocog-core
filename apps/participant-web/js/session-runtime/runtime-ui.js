import { ERROR_KINDS, SESSION_STATES } from './contracts.mjs';
import { setHeadPoseGuideMode } from '../gaze-tracker/head-pose-guide.js';
import { translations } from '../../translations.js?v=20260828-2';

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
        recoveryAction: 'Перейти к проверке камеры',
        blockInstructionTitle: 'Инструкция',
        blockInstructionAction: 'Начать',
        blockCompleteTitle: 'Блок завершён',
        blockCompleteBody: 'Данные блока сохранены. Далее будет показана инструкция следующего блока.',
        blockCompleteAction: 'Далее'
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
        recoveryAction: 'Go to camera check',
        blockInstructionTitle: 'Instructions',
        blockInstructionAction: 'Start',
        blockCompleteTitle: 'Block completed',
        blockCompleteBody: 'The block data has been saved. Instructions for the next block will follow.',
        blockCompleteAction: 'Continue'
    }
};

function langText(getLanguage) {
    const lang = translations[getLanguage()] ? getLanguage() : 'en';
    const pack = translations[lang] || translations.en;
    const fallback = POLICY_TEXT[lang] || POLICY_TEXT.en;
    return {
        lang,
        title: pack.runtime_policy_title || fallback.title,
        body: pack.runtime_policy_body || fallback.body,
        note: pack.runtime_policy_note || fallback.note,
        continue: pack.runtime_continue || fallback.continue,
        pause: pack.runtime_pause || fallback.pause,
        resume: pack.runtime_resume || fallback.resume,
        repeat: pack.runtime_repeat_block_action || fallback.repeat,
        repeatTrials: pack.runtime_repeat_trials_action || fallback.repeatTrials,
        repeatLimit: pack.runtime_repeat_limit_action || fallback.repeatLimit,
        recoveryTitle: pack.runtime_recovery_title || fallback.recoveryTitle,
        recoveryBody: pack.runtime_recovery_body || fallback.recoveryBody,
        recoveryAction: pack.runtime_recovery_action || fallback.recoveryAction,
        blockInstructionTitle: pack.runtime_instruction_title || fallback.blockInstructionTitle,
        blockInstructionAction: pack.runtime_instruction_action || fallback.blockInstructionAction,
        blockCompleteTitle: pack.runtime_block_complete_title || fallback.blockCompleteTitle,
        blockCompleteBody: pack.runtime_block_complete_body || fallback.blockCompleteBody,
        blockCompleteAction: pack.runtime_block_complete_action || fallback.blockCompleteAction,
        dismiss: pack.runtime_dismiss || 'Dismiss notification',
        genericTechnical: pack.runtime_generic_technical || 'A technical analysis error occurred.',
        genericQuality: pack.runtime_generic_quality || 'Measurement conditions do not meet the requirements.',
        repeatTrialsTitle: pack.runtime_repeat_trials_title || 'Some trials must be repeated',
        repeatBlockTitle: pack.runtime_repeat_block_title || 'Block must be repeated',
        repeatReasonPrefix: pack.runtime_repeat_reason_prefix || 'Reasons',
        repeatTrialsSuffix: pack.runtime_repeat_trials_suffix || 'Only the invalid trials will be repeated.',
        repeatBlockBody: pack.runtime_repeat_block_body || 'The previous attempt was not accepted.',
        repeatLimitTitle: pack.runtime_repeat_limit_title || 'Repeat limit reached',
        repeatLimitBody: pack.runtime_repeat_limit_body || 'The session will continue without another repeat.'
    };
}

const ISSUE_TRANSLATION_KEYS = Object.freeze({
    continuous_modules_not_started: 'runtime_continuous_start_failed',
    face_missing: 'tip_face_not_found',
    low_light: 'tip_light_dark',
    head_pose: 'tip_pose_unstable',
    face_occluded: 'tip_face_occluded',
    low_fps: 'issue_low_fps_time',
    page_reloaded: 'runtime_recovery_body'
});

function localizedIssueMessage(issue, getLanguage) {
    const text = langText(getLanguage);
    const pack = translations[text.lang] || translations.en;
    const key = ISSUE_TRANSLATION_KEYS[issue?.code];
    if (key && pack[key]) return pack[key];
    if (text.lang === 'ru' && issue?.message) return issue.message;
    return issue?.kind === ERROR_KINDS.TECHNICAL
        ? text.genericTechnical
        : text.genericQuality;
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
        this.alertMessage = null;
        this.alertClose = null;
        this.pauseButton = null;
        this.modal = null;
        this.modalResolve = null;
        this.lastSnapshot = null;
        this.currentPhase = null;
        this.boundPhaseChange = event => {
            this.currentPhase = event?.detail?.phase || null;
            this._renderPauseButton();
        };
    }

    init() {
        if (typeof document === 'undefined' || this.root) return;
        const style = document.createElement('style');
        style.id = 'wecog-session-runtime-style';
        style.textContent = `
          #wecog-session-runtime{position:fixed;inset:0;z-index:10050;pointer-events:none;font-family:inherit}
          #wecog-session-alert{position:absolute;left:50%;top:18px;transform:translateX(-50%);width:min(680px,calc(100% - 32px));padding:12px 48px 12px 16px;border:1px solid #d97706;border-radius:12px;background:#fffbeb;color:#7c2d12;box-shadow:0 12px 30px rgba(15,23,42,.18);display:none;pointer-events:none}
          #wecog-session-alert[data-kind="technical"]{border-color:#dc2626;background:#fef2f2;color:#7f1d1d}
          #wecog-session-alert-close{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:currentColor;font:700 22px/1 sans-serif;cursor:pointer;pointer-events:auto}
          #wecog-session-alert-close:hover,#wecog-session-alert-close:focus-visible{background:rgba(15,23,42,.08);outline:none}
          #wecog-session-pause{position:absolute;right:20px;bottom:20px;display:none;padding:10px 16px;border:1px solid #0f172a;border-radius:10px;background:#fff;color:#0f172a;font-weight:700;pointer-events:auto;cursor:pointer}
          html:not([data-session-phase="cognitive_instruction"]):not([data-session-phase="protocol_instruction"]) #wecog-session-pause{display:none!important}
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
          <div id="wecog-session-alert" role="status" aria-live="assertive">
            <span data-session-alert-message></span>
            <button id="wecog-session-alert-close" type="button" aria-label="Закрыть уведомление">×</button>
          </div>
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
        this.alertMessage = this.alert.querySelector('[data-session-alert-message]');
        this.alertClose = this.alert.querySelector('#wecog-session-alert-close');
        this.pauseButton = this.root.querySelector('#wecog-session-pause');
        this.modal = this.root.querySelector('#wecog-session-modal');
        this.pauseButton.onclick = () => this.onPause();
        this.alertClose.onclick = () => this.hideIssue();
        window.addEventListener('wecog:session-phase-change', this.boundPhaseChange);
        this.currentPhase = document.documentElement.dataset.sessionPhase || null;
        this._refreshText();
    }

    _refreshText() {
        if (!this.root) return;
        const text = langText(this.getLanguage);
        this.pauseButton.textContent = text.pause;
        this.alertClose.setAttribute(
            'aria-label',
            text.dismiss
        );
    }

    updateState(snapshot) {
        this.init();
        this._refreshText();
        this.lastSnapshot = snapshot || null;
        this._renderPauseButton();

        const guideMode = snapshot?.state === SESSION_STATES.INSTRUCTION
            ? 'instruction'
            : (snapshot?.state === SESSION_STATES.PAUSED
                ? 'paused'
                : ([SESSION_STATES.QUALITY_ERROR, SESSION_STATES.TECHNICAL_ERROR]
                    .includes(snapshot?.state) ? 'locked' : 'hidden'));
        setHeadPoseGuideMode(guideMode);

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

    _renderPauseButton() {
        if (!this.pauseButton) return;
        const phase = this.currentPhase
            || document.documentElement.dataset.sessionPhase
            || null;
        const isBlockInstruction = phase === 'cognitive_instruction'
            || phase === 'protocol_instruction';
        const pauseAllowed = this.lastSnapshot?.state === SESSION_STATES.INSTRUCTION
            && this.lastSnapshot?.currentBlock?.stage !== 'trial'
            && isBlockInstruction;
        this.pauseButton.style.display = pauseAllowed ? 'block' : 'none';
    }

    showIssue(issue, duringTest, blockType = null) {
        this.init();
        this.alert.dataset.kind = issue?.kind || ERROR_KINDS.QUALITY;
        const text = langText(this.getLanguage);
        const repeatsTrial = ['cognitive_task', 'rt', 'rt_gonogo'].includes(
            String(blockType || '').toLowerCase()
        );
        const repeatText = duringTest
            ? (repeatsTrial
                ? ` ${text.repeatTrialsSuffix}`
                : ` ${text.repeatBlockTitle}.`)
            : '';
        this.alertMessage.textContent = `${localizedIssueMessage(issue, this.getLanguage)}${repeatText}`;
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
        const reasons = issues
            .map(issue => localizedIssueMessage(issue, this.getLanguage))
            .filter(Boolean)
            .join('; ');
        const hasTrials = count > 0;
        const body = text.lang === 'ru'
            ? (hasTrials
                ? `Не засчитано ${count} ${russianTrialWord(count)}${total ? ` из ${total}` : ''}.${reasons ? ` ${text.repeatReasonPrefix}: ${reasons}.` : ''} ${text.repeatTrialsSuffix}`
                : text.repeatBlockBody)
            : (hasTrials
                ? `${count}${total ? ` / ${total}` : ''}.${reasons ? ` ${text.repeatReasonPrefix}: ${reasons}.` : ''} ${text.repeatTrialsSuffix}`
                : text.repeatBlockBody);
        return this._showModal({
            title: hasTrials ? text.repeatTrialsTitle : text.repeatBlockTitle,
            body,
            note: hasTrials ? '' : text.note,
            action: hasTrials ? text.repeatTrials : text.repeat
        });
    }

    async showRepeatLimit(repeat) {
        const count = Number(repeat?.repeatItemCount) || 0;
        const text = langText(this.getLanguage);
        return this._showModal({
            title: text.repeatLimitTitle,
            body: `${count || ''}${count ? '. ' : ''}${text.repeatLimitBody}`,
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

    async showBlockInstruction(details = {}) {
        const text = langText(this.getLanguage);
        return this._showModal({
            title: details.title || text.blockInstructionTitle,
            body: details.body || '',
            note: details.note || text.note,
            action: details.action || text.blockInstructionAction
        });
    }

    async showBlockComplete(details = {}) {
        const text = langText(this.getLanguage);
        return this._showModal({
            title: details.title || text.blockCompleteTitle,
            body: details.body || text.blockCompleteBody,
            note: '',
            action: details.action || text.blockCompleteAction
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
