const path = require('node:path');
const { spawn } = require('node:child_process');

class NativeProcessError extends Error {
  constructor(code) {
    super(`Native process ${code}`);
    this.code = code;
  }
}

function runNativeProcess(command, args, options = {}) {
  if (typeof command !== 'string' || !command || command.includes('\0') || command.length > 4096
      || !Array.isArray(args) || args.length > 512
      || args.some(value => typeof value !== 'string' || value.includes('\0') || value.length > 32768)) {
    return Promise.reject(new NativeProcessError('invalid_invocation'));
  }
  const timeoutMs = options.timeoutMs || 45_000;
  const maxOutputBytes = options.maxOutputBytes || 64 * 1024;
  const input = options.input == null ? null : Buffer.from(options.input);
  if (input && input.length > (options.maxInputBytes || 64 * 1024)) {
    return Promise.reject(new NativeProcessError('input_limit'));
  }
  if (options.signal?.aborted) return Promise.reject(new NativeProcessError('cancelled'));
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'FONTCONFIG_PATH']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { LANG: 'C', LC_ALL: 'C', ...(options.env || {}) });
  const limited = options.resourceLimits === true && process.platform === 'linux';
  const invocation = limited ? Buffer.from(JSON.stringify({ command, args })) : null;
  if (invocation?.length > 65536) return Promise.reject(new NativeProcessError('input_limit'));
  return new Promise((resolve, reject) => {
    // Converter arguments are data on a dedicated descriptor, never Python
    // interpreter arguments. stdin remains owned by the RT analyzer's input.
    const spawnOptions = { cwd: options.cwd, env, detached: process.platform !== 'win32',
      stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe', ...(limited ? ['pipe'] : [])], shell: false };
    const child = limited
      ? spawn('python3', [path.join(__dirname, '../scripts/conversion-runner.py'),
        String(Math.max(1, Math.ceil(timeoutMs / 1000)))], spawnOptions)
      : spawn(command, args, spawnOptions);
    let settled = false;
    let failure = null;
    const output = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    const fail = code => {
      if (settled || failure) return;
      failure = code;
      clearTimeout(timer);
      // A decoder can spawn subprocesses which inherit its stdio handles.
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
      // Wait for close before releasing a bounded worker/decoder slot.
    };
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    const abort = () => fail('cancelled');
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      if (settled || failure) return;
      sizes[stream] += chunk.length;
      if (sizes[stream] > maxOutputBytes) return fail('output_limit');
      output[stream].push(chunk);
    });
    child.once('error', () => fail('unavailable'));
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure || code !== 0) {
        return reject(new NativeProcessError(failure || (limited && code === 127 ? 'unavailable' : 'failed')));
      }
      resolve({ stdout: Buffer.concat(output.stdout).toString('utf8'),
        stderr: Buffer.concat(output.stderr).toString('utf8') });
    });
    if (input) {
      child.stdin.on('error', () => fail('failed'));
      child.stdin.end(input);
    }
    if (invocation) {
      child.stdio[3].on('error', () => fail('failed'));
      child.stdio[3].end(invocation);
    }
  });
}

module.exports = { NativeProcessError, runNativeProcess };
