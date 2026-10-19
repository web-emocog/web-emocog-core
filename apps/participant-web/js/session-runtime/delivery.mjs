// One cumulative snapshot in flight; final ingest always supersedes checkpoints.
export class SessionDelivery {
    constructor({ sessionData, build, send, changed = () => {}, now = () => Date.now() }) {
        Object.assign(this, { sessionData, build, send, changed, now });
        this.pending = null;
        this.closed = false;
    }
    next(kind) {
        const sequence = Math.max(0, Number(this.sessionData.deliverySequence) || 0) + 1;
        this.sessionData.deliverySequence = sequence;
        return { schemaVersion: 'session_delivery.v1', sequence, kind };
    }
    checkpoint() {
        if (this.closed || this.sessionData.admissionPending || !this.sessionData.consent?.informed_consent?.accepted || !this.sessionData.ids?.invitationCode) return Promise.resolve(null);
        if (this.pending) return this.pending;
        this.pending = Promise.resolve().then(async () => {
            const packet = await this.build();
            if (this.closed) return null;
            packet.delivery = this.next('checkpoint');
            await this.changed({ ...(this.sessionData.serverBackup || {}), status: 'saving', sequence: packet.delivery.sequence });
            if (this.closed) return null;
            packet.lifecycle = { ...packet.lifecycle, state: packet.lifecycle?.state || 'instruction', status: 'in_progress', completedAt: null, finishAttemptId: null };
            const sequence = packet.delivery.sequence;
            const result = await this.send(packet);
            if (!this.closed) {
                this.sessionData.serverBackup = { ...(this.sessionData.serverBackup || {}), status: result.ok ? 'saved' : 'failed',
                    sequence, lastSuccessAt: result.ok ? this.now() : this.sessionData.serverBackup?.lastSuccessAt || null,
                    errorCode: result.ok ? null : result.code || 'network', httpStatus: result.status || null };
                await Promise.resolve().then(() => this.changed(this.sessionData.serverBackup)).catch(() => {});
            }
            return result;
        }).catch(async () => {
            if (!this.closed) {
                this.sessionData.serverBackup = { ...(this.sessionData.serverBackup || {}), status: 'failed', errorCode: 'prepare' };
                await Promise.resolve().then(() => this.changed(this.sessionData.serverBackup)).catch(() => {});
            }
            return { ok: false, code: 'prepare' };
        }).finally(() => { this.pending = null; });
        return this.pending;
    }
    finish() { this.closed = true; return this.next('final'); }
}
