const WORKER_URL = new URL('./vision-worker.js?v=20261025-1', import.meta.url);

export class VisionWorkerClient {
    static supported() {
        return typeof Worker === 'function' && typeof createImageBitmap === 'function'
            && typeof OffscreenCanvas === 'function';
    }

    constructor(task, { workerFactory = url => new Worker(url), timeoutMs = 5000 } = {}) {
        this.task = task;
        this.workerFactory = workerFactory;
        this.timeoutMs = timeoutMs;
        this.worker = null;
        this.pending = null;
        this.capturePending = null;
        this.sequence = 0;
        this.closed = false;
        this.busy = false;
    }

    async start(options = {}) {
        this.worker = this.workerFactory(WORKER_URL);
        this.worker.onmessage = ({ data }) => {
            if (!this.pending || data?.id !== this.pending.id) return;
            const { resolve, reject, timer } = this.pending;
            clearTimeout(timer);
            this.pending = null;
            if (data.error) reject(new Error(data.error));
            else resolve(data.result);
        };
        this.worker.onerror = () => this.dispose(new Error('vision_worker_failed'));
        this.worker.onmessageerror = () => this.dispose(new Error('vision_worker_message_failed'));
        try {
            return await this._request({ type: 'init', task: this.task, options }, [], 30000);
        } catch (error) {
            this.dispose(error);
            throw error;
        }
    }

    _request(message, transfer = [], timeoutMs = this.timeoutMs) {
        if (this.closed || !this.worker) return Promise.reject(new Error('vision_worker_closed'));
        if (this.pending) return Promise.reject(new Error('vision_worker_busy'));
        return new Promise((resolve, reject) => {
            const id = ++this.sequence;
            const timer = setTimeout(() => this.dispose(new Error('vision_worker_timeout')), timeoutMs);
            this.pending = { id, timer, resolve, reject };
            try { this.worker.postMessage({ ...message, id }, transfer); }
            catch (error) { this.dispose(error); }
        });
    }

    async analyze(source, context = {}) {
        if (this.busy || this.closed) throw new Error('vision_worker_unavailable');
        this.busy = true;
        let bitmap;
        try {
            const timestamp = performance.now();
            const wallTimestamp = Date.now();
            bitmap = await this._capture(source);
            if (this.closed) throw new Error('vision_worker_closed');
            return await this._request({ type: 'frame', bitmap, timestamp, wallTimestamp, ...context }, [bitmap]);
        } finally {
            bitmap?.close();
            this.busy = false;
        }
    }

    _capture(source) {
        return new Promise((resolve, reject) => {
            const capture = { reject, timer: setTimeout(() => this.dispose(new Error('vision_bitmap_timeout')), this.timeoutMs) };
            this.capturePending = capture;
            Promise.resolve().then(() => createImageBitmap(source)).then(bitmap => {
                if (this.capturePending !== capture || this.closed) { bitmap.close(); return; }
                clearTimeout(capture.timer); this.capturePending = null; resolve(bitmap);
            }, error => {
                if (this.capturePending !== capture) return;
                clearTimeout(capture.timer); this.capturePending = null; reject(error);
            });
        });
    }

    reset() {
        if (!this.closed) this.worker?.postMessage({ type: 'reset' });
    }

    dispose(error = new Error('vision_worker_closed')) {
        this.closed = true;
        this.worker?.terminate();
        this.worker = null;
        if (this.capturePending) {
            clearTimeout(this.capturePending.timer);
            this.capturePending.reject(error);
            this.capturePending = null;
        }
        if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending.reject(error);
            this.pending = null;
        }
    }
}
