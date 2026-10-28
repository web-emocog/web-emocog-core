function cancelled() {
  return Object.assign(new Error('Diagnostic run cancelled'), { code: 'diagnostic_cancelled' });
}

function timedOut() {
  return Object.assign(new Error('Diagnostic stage timed out'), { code: 'diagnostic_timeout' });
}

function safely(cleanup) {
  try { cleanup(); } catch (_) { /* Teardown must continue without logging raw device errors. */ }
}

// A stopped run owns late native results too: getUserMedia/MediaPipe cannot be aborted directly.
export class DiagnosticRun {
  constructor() {
    this.controller = new AbortController();
    this.cleanups = new Set();
  }

  get signal() { return this.controller.signal; }

  check() { if (this.signal.aborted) throw cancelled(); }

  onStop(cleanup) {
    if (this.signal.aborted) safely(cleanup);
    else this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }

  stop() {
    if (this.signal.aborted) return;
    this.controller.abort();
    for (const cleanup of this.cleanups) safely(cleanup);
    this.cleanups.clear();
  }

  wait(factory, { timeoutMs = 30000, release } = {}) {
    this.check();
    if (typeof factory !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
      throw new TypeError('Invalid diagnostic stage');
    }
    const deadline = performance.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(cancelled());
      const timeout = () => { finish(timedOut()); this.stop(); };
      const timer = setTimeout(() => {
        timeout();
      }, timeoutMs);
      this.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => {
        this.check();
        if (performance.now() >= deadline) { timeout(); throw timedOut(); }
        return factory();
      }).then(value => {
        if (settled || this.signal.aborted) {
          if (release) safely(() => release(value));
          if (!settled) finish(cancelled());
          return;
        }
        // A synchronous native call may have blocked the timer; expired output is still rejected.
        if (performance.now() >= deadline) {
          if (release) safely(() => release(value));
          timeout();
          return;
        }
        if (release) this.onStop(() => release(value));
        finish(null, value);
      }, error => { if (!settled && performance.now() >= deadline) timeout(); else finish(error); });
    });
  }
}

// Logical cancellation cannot stop native initialization. Do not launch another one in parallel.
export class SerialDiagnosticStage {
  constructor() { this.pending = null; this.waiters = new Set(); }

  request(run, factory, { release, timeoutMs = 30000 } = {}) {
    return run.wait(async () => {
      while (this.pending) {
        // Unlike a growing Promise.then chain, cancelled waiters can be removed immediately.
        await new Promise((resolve, reject) => {
          const cleanup = () => { this.waiters.delete(ready); run.signal.removeEventListener('abort', abort); };
          const ready = () => { cleanup(); resolve(); };
          const abort = () => { cleanup(); reject(cancelled()); };
          this.waiters.add(ready);
          run.signal.addEventListener('abort', abort, { once: true });
          if (run.signal.aborted) abort();
        });
      }
      run.check();
      const work = Promise.resolve().then(async () => {
        run.check();
        const value = await factory();
        // Adopt/close before the queue advances, not in a later await continuation.
        if (release) run.onStop(() => release(value));
        run.check();
        return value;
      });
      this.pending = work;
      const clear = () => {
        if (this.pending !== work) return;
        this.pending = null;
        for (const ready of [...this.waiters]) ready();
      };
      work.then(clear, clear);
      return work;
    }, { timeoutMs });
  }
}

export async function waitForDiagnosticVideo(video, run, { timeoutMs = 10000 } = {}) {
  let cleanup = () => {};
  try {
    await run.wait(() => new Promise((resolve, reject) => {
      const ready = () => { if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) resolve(); };
      const failed = () => reject(Object.assign(new Error('Diagnostic video unavailable'), { code: 'diagnostic_video_failed' }));
      cleanup = () => {
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('loadedmetadata', ready);
        video.removeEventListener('error', failed);
      };
      video.addEventListener('loadeddata', ready);
      video.addEventListener('loadedmetadata', ready);
      video.addEventListener('error', failed);
      ready();
    }), { timeoutMs });
  } finally { cleanup(); }
}
