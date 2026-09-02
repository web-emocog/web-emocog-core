import { state, recordSessionEvent } from '../web-page/state.js';
import {
    ERROR_KINDS,
    EVENT_CATEGORIES,
    SESSION_STATES
} from './contracts.mjs';
import { SessionStateMachine } from './session-state-machine.mjs';
import { SessionCheckpointStore } from './checkpoint-store.mjs';
import { SessionRuntimeUI } from './runtime-ui.js';
import { SessionFramePipeline } from './frame-pipeline.js';
import { ensureMeasurementStart } from './measurement-clock.mjs';
import { resolveSessionFeatureFlags } from './feature-flags.mjs';
import { SessionAudioCollector } from '../audio/session-audio.js';
import { MultimodalSessionCollector } from '../multimodal/session-collector.js';
import { createMonotonicClock } from '../../../../packages/shared/multimodal/timebase.mjs';

const CHECKPOINT_INTERVAL_MS = 5000;

function replaceObject(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
}

function randomId(prefix) {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    if (globalThis.crypto?.getRandomValues) {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        return `${prefix}-${value}`;
    }
    throw new Error('Secure random ID generation is unavailable');
}

class ParticipantSessionRuntime {
    constructor() {
        this.checkpoints = new SessionCheckpointStore();
        this.checkpointTimer = null;
        this.checkpointPromise = null;
        this.checkpointRequested = false;
        this.framePipeline = null;
        this.featureFlags = resolveSessionFeatureFlags();
        this.sessionClock = null;
        this.audioCollector = null;
        this.audioStartPromise = null;
        this.multimodalCollector = null;
        this.stopModulesPromise = null;
        this.moduleStatus = {
            gaze: 'idle',
            blinks: 'idle',
            rt: 'idle',
            bpm: 'idle',
            emotion: 'idle',
            bodyPose: 'idle',
            audio: 'idle',
            multimodal: 'idle'
        };
        this.policyShown = false;
        this.reloadRecovery = null;
        this.initialized = false;
        this.rtListenersActive = false;
        this.ui = new SessionRuntimeUI({
            getLanguage: () => state.currentLang,
            onPause: () => this.pause(),
            onResume: () => this.resume()
        });
        this.machine = new SessionStateMachine({
            onTransition: (transition, snapshot) => this._onTransition(transition, snapshot)
        });
        this.boundOffline = () => this.reportIssue({
            kind: ERROR_KINDS.TECHNICAL,
            code: 'network_offline',
            message: 'Соединение с сетью потеряно. Данные сохраняются локально.',
            recoverable: true,
            invalidatesBlock: false
        });
        this.boundOnline = () => this.resolveIssue('network_offline');
        this.boundVisibility = () => {
            if (document.visibilityState === 'hidden') this.saveCheckpoint();
        };
        this.boundRtInput = event => this._recordRtInput(event);
    }

    async init() {
        if (this.initialized) return this;
        this.initialized = true;
        this.ui.init();
        state.runtime.sessionRuntime = this;

        let restored = null;
        try {
            restored = await this.checkpoints.load();
        } catch (error) {
            console.warn('[SessionRuntime] checkpoint restore failed:', error);
        }

        if (restored?.sessionData && restored?.machineSnapshot?.state !== SESSION_STATES.COMPLETED) {
            const resumeInterruptedFinish = restored.machineSnapshot.state === SESSION_STATES.FINISHING;
            replaceObject(state.sessionData, restored.sessionData);
            this.machine.restore(restored.machineSnapshot);
            if (resumeInterruptedFinish) {
                this._scheduleFinalUploadRetry();
            } else {
                const interruptedBlock = this.machine.currentBlock
                    ? { ...this.machine.currentBlock }
                    : null;
                const restoredShellStep = Number(state.sessionData?.shellStep);
                const requiresPrompt = !!interruptedBlock || restoredShellStep >= 5;
                if (requiresPrompt) {
                    this.reportIssue({
                        kind: ERROR_KINDS.TECHNICAL,
                        code: 'page_reloaded',
                        message: 'Страница была перезагружена. Проверка камеры и калибровка будут запущены заново.',
                        recoverable: true
                    });
                }
                let repeatDecision = null;
                if (interruptedBlock) {
                    repeatDecision = this.completeBlock({
                        success: false,
                        reason: 'page_reloaded'
                    });
                    for (const result of state.sessionData.cognitiveResults || []) {
                        if (
                            String(result?.blockId || '') === interruptedBlock.blockId
                            && Number(result?.attempt) === Number(interruptedBlock.attempt)
                        ) {
                            result.qualityValid = false;
                            result.invalidationReason = 'page_reloaded';
                        }
                    }
                }
                this.reloadRecovery = {
                    restoredAt: Date.now(),
                    interruptedBlock,
                    repeatRequired: repeatDecision?.repeatRequired === true,
                    requiresPrompt,
                    shellStep: Number.isFinite(restoredShellStep) ? restoredShellStep : null
                };
                recordSessionEvent('session_restored_after_reload', {
                    category: EVENT_CATEGORIES.LIFECYCLE,
                    severity: 'warning',
                    blockId: interruptedBlock?.blockId || null,
                    repeatRequired: this.reloadRecovery.repeatRequired,
                    requiresPrompt
                });
            }
        } else if (restored?.sessionData && restored?.sessionData?.upload?.ok !== true) {
            replaceObject(state.sessionData, restored.sessionData);
            this.machine.restore(restored.machineSnapshot);
            recordSessionEvent('session_final_upload_restore', {
                category: EVENT_CATEGORIES.UPLOAD,
                severity: 'warning'
            });
            this._scheduleFinalUploadRetry();
        } else {
            this.machine.start();
        }

        if (this.machine.state !== SESSION_STATES.COMPLETED) {
            window.addEventListener('offline', this.boundOffline);
            window.addEventListener('online', this.boundOnline);
            document.addEventListener('visibilitychange', this.boundVisibility);
            this._startCheckpointTimer();
        }
        return this;
    }

    _scheduleFinalUploadRetry() {
        setTimeout(() => {
            import('../web-page/tests-updated.js?v=20260828-2')
                .then(module => module.finishSession())
                .catch(error => console.warn('[SessionRuntime] final upload retry failed:', error));
        }, 0);
    }

    _removeSessionListeners() {
        window.removeEventListener('offline', this.boundOffline);
        window.removeEventListener('online', this.boundOnline);
        document.removeEventListener('visibilitychange', this.boundVisibility);
    }

    _onTransition(transition, snapshot) {
        if (transition.state === SESSION_STATES.PAUSED) {
            this.audioCollector?.pause?.().catch(error => {
                console.warn('[SessionRuntime] audio pause failed:', error);
            });
        } else if (transition.previousState === SESSION_STATES.PAUSED) {
            this.audioCollector?.resume?.().catch(error => {
                console.warn('[SessionRuntime] audio resume failed:', error);
            });
        }
        state.sessionData.lifecycle = this.machine.lifecycle({
            modules: { ...this.moduleStatus },
            finishAttemptId: state.sessionData.lifecycle?.finishAttemptId || null
        });
        recordSessionEvent('session_state_transition', {
            category: EVENT_CATEGORIES.LIFECYCLE,
            previousState: transition.previousState,
            state: transition.state,
            reason: transition.reason,
            details: transition.details
        });
        this.ui.updateState(snapshot);
        this.saveCheckpoint();
    }

    _startCheckpointTimer() {
        if (this.checkpointTimer) return;
        this.checkpointTimer = setInterval(() => this.saveCheckpoint(), CHECKPOINT_INTERVAL_MS);
    }

    async saveCheckpoint() {
        const sessionId = state.sessionData?.ids?.session;
        if (!sessionId || this.machine.state === SESSION_STATES.COMPLETED) return false;
        this.checkpointRequested = true;
        if (this.checkpointPromise) return this.checkpointPromise;

        this.checkpointPromise = (async () => {
            let saved = false;
            while (this.checkpointRequested) {
                this.checkpointRequested = false;
                const currentSessionId = state.sessionData?.ids?.session;
                if (!currentSessionId || this.machine.state === SESSION_STATES.COMPLETED) continue;
                await this.checkpoints.save(
                    currentSessionId,
                    state.sessionData,
                    this.machine.snapshot()
                );
                saved = true;
            }
            return saved;
        })();

        try {
            return await this.checkpointPromise;
        } catch (error) {
            console.warn('[SessionRuntime] checkpoint save failed:', error);
            return false;
        } finally {
            this.checkpointPromise = null;
        }
    }

    enterInstruction(details = {}) {
        return this.machine.enterInstruction(details);
    }

    beginBlock(block) {
        const run = this.machine.beginBlock(block);
        recordSessionEvent('session_block_attempt_start', {
            category: EVENT_CATEGORIES.BLOCK,
            blockId: run.blockId,
            blockType: run.blockType,
            attempt: run.attempt
        });
        return run;
    }

    completeBlock(result = {}) {
        const decision = this.machine.completeBlock(result);
        if (decision.completed) {
            recordSessionEvent('session_block_attempt_complete', {
                category: EVENT_CATEGORIES.BLOCK,
                blockId: decision.block.blockId,
                blockType: decision.block.blockType,
                attempt: decision.block.attempt,
                accepted: !decision.repeatRequired,
                repeatRequired: decision.repeatRequired,
                issueIds: decision.block.issueIds
            });
        }
        return decision;
    }

    getCurrentBlock() {
        return this.machine.snapshot().currentBlock;
    }

    getActiveIssues() {
        return this.machine.snapshot().activeIssues
            .filter(issue => issue.invalidatesBlock !== false);
    }

    pause() {
        const phase = state.runtime?.currentPhase
            || document.documentElement?.dataset?.sessionPhase
            || null;
        if (phase !== 'cognitive_instruction' && phase !== 'protocol_instruction') {
            recordSessionEvent('session_pause_rejected', {
                category: EVENT_CATEGORIES.LIFECYCLE,
                severity: 'warning',
                reason: 'pause_not_allowed_in_phase',
                phase
            });
            return { accepted: false, reason: 'pause_not_allowed_in_phase' };
        }
        const result = this.machine.requestPause();
        if (!result.accepted) {
            recordSessionEvent('session_pause_rejected', {
                category: EVENT_CATEGORIES.LIFECYCLE,
                severity: 'warning',
                reason: result.reason
            });
        }
        return result;
    }

    resume() {
        return this.machine.resume();
    }

    reportIssue(issue) {
        if (
            this.machine.state === SESSION_STATES.COMPLETED
            || this.machine.state === SESSION_STATES.FAILED
            || this.machine.state === SESSION_STATES.FINISHING
        ) {
            return null;
        }
        const existing = [...this.machine.activeIssues.values()]
            .find(activeIssue => activeIssue.code === issue?.code);
        if (existing) return existing;
        const created = this.machine.reportIssue(issue);
        if (!created) return null;
        recordSessionEvent('session_issue_raised', {
            category: created.kind === ERROR_KINDS.TECHNICAL
                ? EVENT_CATEGORIES.TECHNICAL
                : EVENT_CATEGORIES.QUALITY,
            severity: created.severity,
            issue: created
        });
        this.ui.showIssue(
            created,
            created.invalidatesBlock !== false && this.machine.currentBlock?.stage === 'trial',
            this.machine.currentBlock?.blockType
        );
        return created;
    }

    resolveIssue(issueIdOrCode) {
        const issue = [...this.machine.activeIssues.values()]
            .find(item => item.issueId === issueIdOrCode || item.code === issueIdOrCode);
        const resolved = this.machine.resolveIssue(issueIdOrCode);
        if (!resolved) return false;
        recordSessionEvent('session_issue_resolved', {
            category: issue?.kind === ERROR_KINDS.TECHNICAL
                ? EVENT_CATEGORIES.TECHNICAL
                : EVENT_CATEGORIES.QUALITY,
            issueIdOrCode
        });
        if (this.machine.activeIssues.size === 0) this.ui.hideIssue();
        return true;
    }

    async requireQualityInstruction() {
        if (this.policyShown) return;
        this.enterInstruction({ source: 'quality_policy' });
        await this.ui.showPolicy();
        this.policyShown = true;
        recordSessionEvent('quality_policy_acknowledged', {
            category: EVENT_CATEGORIES.LIFECYCLE
        });
    }

    async promptBlockInstruction(details = {}) {
        this.enterInstruction({
            source: 'block_instruction',
            blockId: details.blockId || null,
            blockType: details.blockType || null
        });
        await this.ui.showBlockInstruction(details);
        recordSessionEvent('session_block_instruction_acknowledged', {
            category: EVENT_CATEGORIES.BLOCK,
            blockId: details.blockId || null,
            blockType: details.blockType || null
        });
        return true;
    }

    async notifyBlockComplete(details = {}) {
        this.enterInstruction({
            source: 'block_complete_message',
            blockId: details.blockId || null,
            blockType: details.blockType || null
        });
        await this.ui.showBlockComplete(details);
        recordSessionEvent('session_block_complete_acknowledged', {
            category: EVENT_CATEGORIES.BLOCK,
            blockId: details.blockId || null,
            blockType: details.blockType || null
        });
        return true;
    }

    async promptRepeat(blockId) {
        const repeat = this.machine.consumeRepeat(blockId);
        if (!repeat) return false;
        this.enterInstruction({ source: 'block_repeat', blockId });
        await this.ui.showRepeat(repeat);
        recordSessionEvent('session_block_repeat_acknowledged', {
            category: EVENT_CATEGORIES.BLOCK,
            blockId,
            failedAttempt: repeat.failedAttempt,
            reason: repeat.reason,
            repeatItemCount: repeat.repeatItemCount || 0,
            repeatItems: repeat.repeatItems || []
        });
        return repeat;
    }

    async notifyRepeatLimit(repeat) {
        this.enterInstruction({
            source: 'block_repeat_limit',
            blockId: repeat?.blockId || null
        });
        await this.ui.showRepeatLimit(repeat);
        recordSessionEvent('session_block_repeat_limit_reached', {
            category: EVENT_CATEGORIES.BLOCK,
            blockId: repeat?.blockId || null,
            failedAttempt: repeat?.failedAttempt || null,
            repeatItemCount: repeat?.repeatItemCount || 0
        });
        return true;
    }

    async promptReloadRecovery() {
        if (!this.reloadRecovery) return false;
        const recovery = this.reloadRecovery;
        if (recovery.requiresPrompt !== false) {
            await this.ui.showReloadRecovery();
            this.resolveIssue('page_reloaded');
            this.enterInstruction({ source: 'reload_recovery_acknowledged' });
        }
        recordSessionEvent('session_reload_recovery_acknowledged', {
            category: EVENT_CATEGORIES.LIFECYCLE,
            blockId: recovery.interruptedBlock?.blockId || null,
            repeatRequired: recovery.repeatRequired,
            requiresPrompt: recovery.requiresPrompt !== false
        });
        this.reloadRecovery = null;
        await this.saveCheckpoint();
        return true;
    }

    discardRepeat(blockId) {
        return this.machine.consumeRepeat(blockId);
    }

    _ensureSessionPlugins() {
        this.featureFlags = resolveSessionFeatureFlags(
            state.runtime?.invitationProtocolDefinition || null
        );
        ensureMeasurementStart(state.sessionData);
        if (!this.sessionClock) {
            this.sessionClock = createMonotonicClock({
                startedMonotonicMs: Number(state.sessionData.startTime) || undefined
            });
            state.runtime.sessionClock = this.sessionClock;
            state.runtime.sessionFeatureFlags = this.featureFlags;
        }
        if (!this.audioCollector) {
            this.audioCollector = new SessionAudioCollector({
                state,
                clock: this.sessionClock,
                enabled: this.featureFlags.audio,
                recordEvent: (type, payload) => recordSessionEvent(type, {
                    category: EVENT_CATEGORIES.MODULE,
                    ...payload
                })
            });
        }
        if (!this.multimodalCollector) {
            this.multimodalCollector = new MultimodalSessionCollector({
                state,
                clock: this.sessionClock,
                enabled: this.featureFlags.multimodal,
                bodyEnabled: this.featureFlags.bodyMovement,
                gamerMode: this.featureFlags.gamerMode
            });
            const started = this.multimodalCollector.start();
            this.setModuleStatus('multimodal', started ? 'running' : 'disabled');
        }
    }

    startAudioModule() {
        this._ensureSessionPlugins();
        if (this.audioStartPromise) return this.audioStartPromise;
        this.setModuleStatus('audio', this.featureFlags.audio ? 'initializing' : 'disabled');
        this.audioStartPromise = this.audioCollector.start().then(started => {
            if (this.stopModulesPromise) return started;
            const status = started
                ? 'running'
                : (this.audioCollector.status || (this.featureFlags.audio ? 'failed' : 'disabled'));
            this.setModuleStatus('audio', status);
            return started;
        });
        return this.audioStartPromise;
    }

    captureMultimodalFrame(input) {
        return this.multimodalCollector?.captureFrame(input) || null;
    }

    async startContinuousModules() {
        if (this.framePipeline?.isRunning()) return true;
        this._ensureSessionPlugins();
        // Start the permission request before the first await so this method can
        // be called directly from the participant's click gesture.
        this.startAudioModule();
        const video = document.getElementById('precheckVideo');
        this.framePipeline = new SessionFramePipeline({
            state,
            controller: this,
            video
        });
        // Microphone permission is optional and its browser prompt may remain
        // unanswered. It must never delay camera analysis or protocol progress.
        const started = await this.framePipeline.start();
        if (!started) {
            this.reportIssue({
                kind: ERROR_KINDS.TECHNICAL,
                code: 'continuous_modules_not_started',
                message: 'Continuous camera analysis could not start.',
                recoverable: true,
                invalidatesBlock: false,
                details: {
                    hasVideoStream: Boolean(video?.srcObject),
                    hasAnalyzer: Boolean(state.runtime.localAnalyzer)
                }
            });
            return false;
        }
        this.resolveIssue('continuous_modules_not_started');
        this.setModuleStatus('gaze', 'running');
        this.setModuleStatus('blinks', 'running');
        this.setModuleStatus('rt', 'running');
        this._startRtListener();
        recordSessionEvent('continuous_modules_started', {
            category: EVENT_CATEGORIES.MODULE,
            modules: [
                'gaze',
                'blinks',
                'rt',
                'bpm',
                'emotion',
                'bodyPose',
                'audio',
                'multimodal'
            ],
            featureFlags: this.featureFlags
        });
        return true;
    }

    isAnalysisRunning() {
        return this.framePipeline?.isRunning() === true;
    }

    setModuleStatus(moduleName, status) {
        this.moduleStatus[moduleName] = status;
        state.sessionData.lifecycle = this.machine.lifecycle({
            modules: { ...this.moduleStatus },
            finishAttemptId: state.sessionData.lifecycle?.finishAttemptId || null
        });
    }

    getBpmSnapshot() {
        return this.framePipeline?.getBpmSnapshot() || {
            ready: false,
            sampleCount: 0,
            bpmMean: null,
            respRateMean: null,
            lastSample: null
        };
    }

    _startRtListener() {
        if (this.rtListenersActive) return;
        this.rtListenersActive = true;
        document.addEventListener('keydown', this.boundRtInput, true);
        document.addEventListener('pointerdown', this.boundRtInput, true);
    }

    _recordRtInput(event) {
        const block = this.machine.currentBlock;
        if (!block || block.stage !== 'trial') return;
        recordSessionEvent('rt_input_observed', {
            category: EVENT_CATEGORIES.INPUT,
            blockId: block.blockId,
            attempt: block.attempt,
            inputType: event.type === 'keydown' ? 'keyboard' : 'pointer',
            code: event.type === 'keydown' ? event.code : null,
            button: event.type === 'pointerdown' ? event.button : null,
            clientX: event.type === 'pointerdown' ? event.clientX : null,
            clientY: event.type === 'pointerdown' ? event.clientY : null
        });
    }

    async stopContinuousModules(reason = 'session_finish') {
        if (this.stopModulesPromise) return this.stopModulesPromise;
        this.stopModulesPromise = (async () => {
            const bpmRun = this.framePipeline?.stop(reason) || null;
            if (bpmRun) {
                if (!Array.isArray(state.sessionData.bpmRuns)) state.sessionData.bpmRuns = [];
                state.sessionData.bpmRuns.push(bpmRun);
                if (!Array.isArray(state.sessionData.respirationRuns)) state.sessionData.respirationRuns = [];
                state.sessionData.respirationRuns.push({
                    mode: bpmRun.mode,
                    reason: bpmRun.reason,
                    durationMs: bpmRun.durationMs,
                    sampleCount: bpmRun.sampleCount,
                    respRateMean: bpmRun.respRateMean,
                    rppgSession: bpmRun.rppgSession
                });
            }
            await this.audioCollector?.stop(reason);
            this.multimodalCollector?.stop();
            if (this.rtListenersActive) {
                document.removeEventListener('keydown', this.boundRtInput, true);
                document.removeEventListener('pointerdown', this.boundRtInput, true);
                this.rtListenersActive = false;
            }
            for (const name of Object.keys(this.moduleStatus)) this.setModuleStatus(name, 'stopped');
            return bpmRun;
        })();
        return this.stopModulesPromise;
    }

    beginFinish() {
        const finishAttemptId = state.sessionData.lifecycle?.finishAttemptId || randomId('finish');
        const accepted = this.machine.beginFinish(finishAttemptId);
        state.sessionData.lifecycle = this.machine.lifecycle({
            modules: { ...this.moduleStatus },
            finishAttemptId
        });
        return { accepted, finishAttemptId };
    }

    async completeFinish(details = {}, options = {}) {
        this.machine.completeFinish(details);
        state.sessionData.lifecycle = this.machine.lifecycle({
            modules: { ...this.moduleStatus },
            finishAttemptId: state.sessionData.lifecycle?.finishAttemptId || null,
            completedAt: new Date(this.machine.completedAt).toISOString()
        });
        if (this.checkpointTimer) clearInterval(this.checkpointTimer);
        this.checkpointTimer = null;
        this._removeSessionListeners();
        if (options.clearCheckpoint === false) {
            await this.persistCompletedCheckpoint();
        } else {
            await this.clearCompletedCheckpoint();
        }
    }

    async persistCompletedCheckpoint() {
        const sessionId = state.sessionData?.ids?.session;
        if (!sessionId) return;
        if (this.checkpointPromise) {
            try {
                await this.checkpointPromise;
            } catch (_) {
                // Still attempt the terminal checkpoint after a periodic write failure.
            }
        }
        await this.checkpoints.save(sessionId, state.sessionData, this.machine.snapshot());
    }

    async clearCompletedCheckpoint() {
        if (this.checkpointTimer) clearInterval(this.checkpointTimer);
        this.checkpointTimer = null;
        this._removeSessionListeners();
        if (this.checkpointPromise) {
            try {
                await this.checkpointPromise;
            } catch (_) {
                // Clearing stale state remains required after a failed write.
            }
        }
        await this.checkpoints.clear(state.sessionData?.ids?.session);
    }

    failFinish(error) {
        this.machine.failFinish(error);
    }
}

let singleton = null;

export async function initSessionRuntime() {
    if (!singleton) singleton = new ParticipantSessionRuntime();
    await singleton.init();
    return singleton;
}

export function getSessionRuntime() {
    return singleton || state.runtime.sessionRuntime || null;
}

export function isContinuousSessionAnalysisRunning() {
    return getSessionRuntime()?.isAnalysisRunning() === true;
}
