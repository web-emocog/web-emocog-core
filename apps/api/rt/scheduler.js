const { performance } = require('node:perf_hooks');

class RtAnalysisError extends Error {
  constructor(code) {
    super(`RT analysis ${code}`);
    this.code = `rt_analyzer_${code}`;
  }
}

// A deadline includes queue wait, preparation and the child process. Active jobs
// retain their slot until cancellation has actually reaped the child process.
class RtScheduler {
  constructor({ concurrency = 1, maxQueue = 8, timeoutMs = 60_000 } = {}) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.timeoutMs = timeoutMs;
    this.active = 0;
    this.queue = [];
  }

  run(task, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(new RtAnalysisError('cancelled'));
    if (this.active >= this.concurrency && this.queue.length >= this.maxQueue) {
      return Promise.reject(new RtAnalysisError('busy'));
    }
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const deadline = performance.now() + this.timeoutMs;
      const job = { started: false, task, controller, resolve, reject, deadline, failure: null };
      const cancel = code => {
        if (job.failure) return;
        job.failure = new RtAnalysisError(code);
        controller.abort();
        if (!job.started) {
          const index = this.queue.indexOf(job);
          if (index >= 0) this.queue.splice(index, 1);
          job.cleanup();
          reject(job.failure);
        }
      };
      const abort = () => cancel('cancelled');
      const timer = setTimeout(() => cancel('timeout'), this.timeoutMs);
      job.cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(job);
      if (signal?.aborted) abort();
      this.drain();
    });
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      job.started = true;
      this.active++;
      Promise.resolve().then(async () => {
        if (job.failure) throw job.failure;
        const result = await job.task({ signal: job.controller.signal,
          remainingMs: () => Math.max(1, Math.ceil(job.deadline - performance.now())) });
        if (job.failure) throw job.failure;
        if (performance.now() >= job.deadline) throw new RtAnalysisError('timeout');
        return result;
      }).then(job.resolve, error => job.reject(job.failure || error)).finally(() => {
        job.cleanup();
        this.active--;
        this.drain();
      });
    }
  }
}

module.exports = { RtScheduler, RtAnalysisError };
