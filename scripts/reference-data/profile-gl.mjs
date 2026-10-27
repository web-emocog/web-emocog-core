// Test-harness-only hooks around native calls. No arguments, pixels, GL objects
// or return values are retained. Timing overhead disqualifies FPS acceptance.
export function installGlProfiler(scope) {
  const names = ['readPixels', 'getBufferSubData', 'getError', 'getParameter', 'checkFramebufferStatus',
    'texImage2D', 'texSubImage2D', 'drawArrays', 'drawElements', 'drawArraysInstanced',
    'drawElementsInstanced', 'clientWaitSync', 'finish', 'flush'];
  let stats = {};
  const originals = [];
  const seen = new Set();
  for (const constructor of [scope.WebGLRenderingContext, scope.WebGL2RenderingContext]) {
    if (!constructor || seen.has(constructor.prototype)) continue;
    seen.add(constructor.prototype);
    for (const name of names) {
      const prototype = constructor.prototype;
      if (!Object.prototype.hasOwnProperty.call(prototype, name) || typeof prototype[name] !== 'function') continue;
      const original = prototype[name];
      function timed(...args) {
        const start = scope.performance.now();
        try { return original.apply(this, args); }
        finally {
          const elapsed = scope.performance.now() - start;
          const row = stats[name] ||= { calls: 0, totalMs: 0, maxMs: 0 };
          row.calls++; row.totalMs += elapsed; row.maxMs = Math.max(row.maxMs, elapsed);
        }
      }
      prototype[name] = timed;
      originals.push(() => { if (prototype[name] === timed) prototype[name] = original; });
    }
  }
  return { reset() { stats = {}; }, read() { return structuredClone(stats); },
    restore() { originals.reverse().forEach(restore => restore()); originals.length = 0; } };
}

export function profileWorkerGl(source) {
  const before = 'const frame = await analyzer.analyzeFrame(bitmap, data);';
  if (source.split(before).length !== 2) throw new Error('reference_gl_source_changed');
  return `const replayGlProfile = (${installGlProfiler.toString()})(self);\n${source.replace(before,
    'replayGlProfile.reset();\n                const frame = await analyzer.analyzeFrame(bitmap, data);\n                frame.replayGl = replayGlProfile.read();')}`;
}
