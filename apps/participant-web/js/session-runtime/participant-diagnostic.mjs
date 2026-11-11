function emit(level, scope, event, details) {
    try {
        const diagnostic = globalThis.WECOG_DEBUG;
        if (diagnostic?.enabled && typeof diagnostic[level] === 'function') {
            diagnostic[level](scope, event, typeof details === 'function' ? details() : details);
        }
    } catch (_) { /* Optional diagnostics must not affect a study. */ }
}

export function participantDebug(scope, event, details) {
    emit('log', scope, event, details);
}

export function participantDebugError(scope, event, details) {
    emit('error', scope, event, details);
}

const reportedErrors = new WeakMap();

export function participantDebugErrorOnce(owner, scope, event) {
    try {
        if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) return;
        const sink = globalThis.WECOG_DEBUG;
        if (!sink?.enabled || typeof sink.error !== 'function') return;
        const key = scope + ':' + event;
        let reported = reportedErrors.get(owner);
        if (reported?.has(key)) return;
        if (!reported) { reported = new Set(); reportedErrors.set(owner, reported); }
        // Latch before calling an optional sink, which may itself throw.
        reported.add(key);
        emit('error', scope, event);
    } catch (_) { /* Diagnostics must not change the model lifecycle. */ }
}

export function resetParticipantDiagnostics(owner) {
    reportedErrors.delete(owner);
}

export function notifyParticipantCallback(callback, receiver, args, scope, event) {
    try {
        if (typeof callback !== 'function') return;
        const result = callback.apply(receiver, args);
        // Synchronous observers add no promise to a model's critical path.
        if (result && typeof result.then === 'function') {
            void Promise.resolve(result).catch(() => participantDebugErrorOnce(receiver, scope, event));
        }
    } catch (_) {
        participantDebugErrorOnce(receiver, scope, event);
    }
}
