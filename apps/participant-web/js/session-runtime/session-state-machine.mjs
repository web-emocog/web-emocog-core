import {
    ERROR_KINDS,
    SESSION_STATES,
    buildLifecycleContract,
    createSessionIssue
} from './contracts.mjs';

const TERMINAL_STATES = new Set([SESSION_STATES.COMPLETED, SESSION_STATES.FAILED]);

function copy(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class SessionStateMachine {
    constructor(options = {}) {
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.onTransition = typeof options.onTransition === 'function'
            ? options.onTransition
            : () => {};
        this.state = SESSION_STATES.IDLE;
        this.startedAt = null;
        this.lastTransitionAt = null;
        this.completedAt = null;
        this.currentBlock = null;
        this.repeatQueue = [];
        this.activeIssues = new Map();
        this.blockAttempts = new Map();
        this.previousActiveState = SESSION_STATES.INSTRUCTION;
    }

    _transition(nextState, reason, details = {}) {
        if (TERMINAL_STATES.has(this.state) && nextState !== this.state) {
            throw new Error(`Cannot leave terminal session state ${this.state}`);
        }
        const previousState = this.state;
        this.state = nextState;
        this.lastTransitionAt = this.now();
        const transition = {
            previousState,
            state: nextState,
            reason,
            timestamp: this.lastTransitionAt,
            details: copy(details)
        };
        this.onTransition(transition, this.snapshot());
        return transition;
    }

    start() {
        if (this.state !== SESSION_STATES.IDLE) return this.snapshot();
        this.startedAt = this.now();
        this._transition(SESSION_STATES.STARTING, 'session_start');
        return this.snapshot();
    }

    _activeErrorState() {
        const issues = [...this.activeIssues.values()];
        if (issues.some(issue => issue.kind === ERROR_KINDS.TECHNICAL)) {
            return SESSION_STATES.TECHNICAL_ERROR;
        }
        if (issues.length > 0) return SESSION_STATES.QUALITY_ERROR;
        return null;
    }

    enterInstruction(details = {}) {
        if (TERMINAL_STATES.has(this.state) || this.state === SESSION_STATES.FINISHING) {
            return false;
        }
        this.previousActiveState = SESSION_STATES.INSTRUCTION;
        this._transition(SESSION_STATES.INSTRUCTION, 'enter_instruction', details);
        return true;
    }

    beginBlock(block = {}) {
        if (TERMINAL_STATES.has(this.state) || this.state === SESSION_STATES.FINISHING) {
            throw new Error(`Cannot begin block while session is ${this.state}`);
        }
        const blockId = String(block.blockId || block.id || 'anonymous-block');
        const attempt = (this.blockAttempts.get(blockId) || 0) + 1;
        this.blockAttempts.set(blockId, attempt);
        const invalidatingIssues = [...this.activeIssues.values()]
            .filter(issue => issue.invalidatesBlock !== false);
        this.currentBlock = {
            blockId,
            blockType: block.blockType || block.type || 'unknown',
            attempt,
            startedAt: this.now(),
            stage: 'trial',
            invalid: invalidatingIssues.length > 0,
            issueIds: invalidatingIssues.map(issue => issue.issueId),
            issues: invalidatingIssues.map(issue => copy(issue))
        };
        this.previousActiveState = SESSION_STATES.RUNNING;
        this._transition(SESSION_STATES.RUNNING, 'block_start', this.currentBlock);
        return copy(this.currentBlock);
    }

    requestPause(reason = 'participant_request') {
        if (this.state !== SESSION_STATES.INSTRUCTION || this.currentBlock?.stage === 'trial') {
            return { accepted: false, reason: 'pause_not_allowed_during_test' };
        }
        this._transition(SESSION_STATES.PAUSED, reason);
        return { accepted: true };
    }

    resume(reason = 'participant_resume') {
        if (this.state !== SESSION_STATES.PAUSED) {
            return { accepted: false, reason: 'session_not_paused' };
        }
        this.previousActiveState = SESSION_STATES.INSTRUCTION;
        this._transition(this._activeErrorState() || SESSION_STATES.INSTRUCTION, reason);
        return { accepted: true };
    }

    reportIssue(issueInput) {
        if (TERMINAL_STATES.has(this.state) || this.state === SESSION_STATES.FINISHING) return null;
        const issue = createSessionIssue(issueInput);
        const existing = [...this.activeIssues.values()].find(item => item.code === issue.code);
        if (existing) return copy(existing);

        this.activeIssues.set(issue.issueId, issue);
        if (this.currentBlock?.stage === 'trial' && issue.invalidatesBlock !== false) {
            if (!Array.isArray(this.currentBlock.issueIds)) this.currentBlock.issueIds = [];
            if (!Array.isArray(this.currentBlock.issues)) this.currentBlock.issues = [];
            this.currentBlock.invalid = true;
            this.currentBlock.issueIds.push(issue.issueId);
            this.currentBlock.issues.push(copy(issue));
        }

        if (this.state !== SESSION_STATES.PAUSED) {
            this.previousActiveState = this.currentBlock
                ? SESSION_STATES.RUNNING
                : SESSION_STATES.INSTRUCTION;
            const errorState = this._activeErrorState();
            this._transition(errorState, 'issue_reported', issue);
        }
        return copy(issue);
    }

    resolveIssue(issueIdOrCode) {
        const entry = [...this.activeIssues.entries()].find(
            ([id, issue]) => id === issueIdOrCode || issue.code === issueIdOrCode
        );
        if (!entry) return false;
        this.activeIssues.delete(entry[0]);
        if (
            this.state === SESSION_STATES.QUALITY_ERROR
            || this.state === SESSION_STATES.TECHNICAL_ERROR
        ) {
            const nextState = this._activeErrorState() || this.previousActiveState;
            if (nextState !== this.state) {
                this._transition(nextState, 'issue_resolved', entry[1]);
            }
        }
        return true;
    }

    completeBlock(result = {}) {
        if (!this.currentBlock) {
            return { repeatRequired: false, completed: false };
        }
        const completed = {
            ...copy(this.currentBlock),
            completedAt: this.now(),
            success: result.success !== false
        };
        const hasExplicitRepeatItems = Object.prototype.hasOwnProperty.call(result, 'repeatItems');
        const repeatItems = Array.isArray(result.repeatItems)
            ? result.repeatItems
                .filter(item => item && item.id != null)
                .map(item => ({
                    id: String(item.id),
                    issueCodes: Array.isArray(item.issueCodes)
                        ? [...new Set(item.issueCodes.map(String))]
                        : []
                }))
            : [];
        const repeatRequired = result.success === false
            || repeatItems.length > 0
            || (!hasExplicitRepeatItems && completed.invalid);
        if (repeatRequired) {
            this.repeatQueue.push({
                blockId: completed.blockId,
                blockType: completed.blockType,
                failedAttempt: completed.attempt,
                issueIds: [...completed.issueIds],
                issues: copy(completed.issues || []),
                repeatItems,
                repeatItemCount: repeatItems.length,
                repeatItemLabel: result.repeatItemLabel || null,
                totalItemCount: Number.isFinite(result.totalItemCount)
                    ? result.totalItemCount
                    : null,
                reason: result.reason || (
                    repeatItems.length
                        ? 'trial_quality_issue'
                        : (completed.invalid ? 'quality_or_technical_issue' : 'block_failed')
                )
            });
        }
        this.currentBlock = null;
        this.previousActiveState = SESSION_STATES.INSTRUCTION;
        this._transition(this._activeErrorState() || SESSION_STATES.INSTRUCTION, 'block_complete', {
            ...completed,
            repeatRequired
        });
        return { repeatRequired, completed: true, block: completed };
    }

    consumeRepeat(blockId) {
        const index = this.repeatQueue.findIndex(item => item.blockId === String(blockId));
        if (index < 0) return null;
        return this.repeatQueue.splice(index, 1)[0];
    }

    beginFinish(finishAttemptId) {
        if (this.state === SESSION_STATES.COMPLETED) return false;
        if (this.state === SESSION_STATES.FINISHING) return false;
        if (this.currentBlock || this.repeatQueue.length > 0) return false;
        this._transition(SESSION_STATES.FINISHING, 'session_finish_start', { finishAttemptId });
        return true;
    }

    completeFinish(details = {}) {
        if (this.state === SESSION_STATES.COMPLETED) return this.snapshot();
        if (this.state !== SESSION_STATES.FINISHING) {
            throw new Error(`Cannot complete finish while session is ${this.state}`);
        }
        this.completedAt = this.now();
        this._transition(SESSION_STATES.COMPLETED, 'session_finish_complete', details);
        return this.snapshot();
    }

    failFinish(error) {
        if (this.state !== SESSION_STATES.FINISHING) return false;
        this._transition(SESSION_STATES.TECHNICAL_ERROR, 'session_finish_failed', {
            message: error?.message || String(error)
        });
        return true;
    }

    restore(snapshot = {}) {
        this.state = snapshot.state || SESSION_STATES.STARTING;
        this.startedAt = snapshot.startedAt || this.now();
        this.lastTransitionAt = snapshot.lastTransitionAt || this.now();
        this.completedAt = snapshot.completedAt || null;
        this.currentBlock = snapshot.currentBlock ? copy(snapshot.currentBlock) : null;
        this.repeatQueue = Array.isArray(snapshot.repeatQueue) ? copy(snapshot.repeatQueue) : [];
        this.activeIssues = new Map(
            (Array.isArray(snapshot.activeIssues) ? snapshot.activeIssues : [])
                .map(issue => [issue.issueId, copy(issue)])
        );
        this.blockAttempts = new Map(Object.entries(snapshot.blockAttempts || {}));
        if (this.currentBlock && this.state !== SESSION_STATES.COMPLETED) {
            this.currentBlock.invalid = true;
            if (!Array.isArray(this.currentBlock.issueIds)) this.currentBlock.issueIds = [];
            if (!Array.isArray(this.currentBlock.issues)) this.currentBlock.issues = [];
        }
        this.onTransition({
            previousState: null,
            state: this.state,
            reason: 'session_restore',
            timestamp: this.now(),
            details: {}
        }, this.snapshot());
        return this.snapshot();
    }

    snapshot() {
        return {
            state: this.state,
            startedAt: this.startedAt,
            lastTransitionAt: this.lastTransitionAt,
            completedAt: this.completedAt,
            currentBlock: copy(this.currentBlock),
            repeatQueue: copy(this.repeatQueue),
            activeIssues: copy([...this.activeIssues.values()]),
            blockAttempts: Object.fromEntries(this.blockAttempts)
        };
    }

    lifecycle(patch = {}) {
        return buildLifecycleContract(this.snapshot(), patch);
    }
}
