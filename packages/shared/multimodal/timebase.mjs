export const MULTIMODAL_TIMEBASE_VERSION = 'multimodal_timebase.v1';

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function defaultPerformance() {
  return globalThis.performance || null;
}

export function resolveMonotonicEpochMs(sample, fallback = null) {
  const direct = finite(sample?.monotonicMs ?? sample?.tMonoMs);
  if (direct != null) return direct;
  const frameTimestamp = finite(sample?.frameTimestamp);
  const timeOrigin = finite(sample?.timeOriginMs);
  if (frameTimestamp != null && timeOrigin != null) return timeOrigin + frameTimestamp;
  const timestamp = finite(sample?.timestamp ?? sample?.t);
  return timestamp ?? finite(fallback);
}

export function createMonotonicClock(options = {}) {
  const performanceObject = options.performanceObject || defaultPerformance();
  const initialNow = finite(performanceObject?.now?.()) ?? 0;
  const timeOriginMs = finite(performanceObject?.timeOrigin)
    ?? (finite(options.wallNow?.()) ?? Date.now()) - initialNow;
  const requestedStart = finite(options.startedMonotonicMs);
  const startedMonotonicMs = requestedStart ?? timeOriginMs + initialNow;
  let lastMonotonicMs = startedMonotonicMs;

  function now(context = {}) {
    const perfNow = finite(context.performanceNowMs)
      ?? finite(performanceObject?.now?.())
      ?? Math.max(0, (finite(options.wallNow?.()) ?? Date.now()) - timeOriginMs);
    const candidate = timeOriginMs + perfNow;
    lastMonotonicMs = Math.max(lastMonotonicMs, candidate);
    return {
      schemaVersion: MULTIMODAL_TIMEBASE_VERSION,
      timeOriginMs,
      monotonicMs: lastMonotonicMs,
      sessionTimeMs: Math.max(0, lastMonotonicMs - startedMonotonicMs),
    };
  }

  return {
    schemaVersion: MULTIMODAL_TIMEBASE_VERSION,
    timeOriginMs,
    startedMonotonicMs,
    now,
    snapshot() {
      return {
        schemaVersion: MULTIMODAL_TIMEBASE_VERSION,
        timeOriginMs,
        startedMonotonicMs,
        lastMonotonicMs,
      };
    },
  };
}

export function nearestSample(samples, targetTimeMs, maxDeltaMs = 100) {
  const target = finite(targetTimeMs);
  if (target == null || !Array.isArray(samples) || !samples.length) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const sample of samples) {
    const sampleTime = resolveMonotonicEpochMs(sample);
    if (sampleTime == null) continue;
    const delta = Math.abs(sampleTime - target);
    if (delta < bestDelta) {
      best = sample;
      bestDelta = delta;
    }
  }
  if (!best || bestDelta > maxDeltaMs) return null;
  return { sample: best, deltaMs: bestDelta };
}

export function percentile(values, quantile) {
  const sorted = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * Number(quantile || 0)) - 1),
  );
  return sorted[index];
}
