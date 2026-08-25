function resolveIdempotencyKey(headerValue, lifecycle) {
  const headerKey = headerValue ? String(headerValue) : null;
  const payloadKey = lifecycle && lifecycle.finishAttemptId
    ? String(lifecycle.finishAttemptId)
    : null;
  if (headerKey && payloadKey && headerKey !== payloadKey) {
    return {
      ok: false,
      status: 409,
      error: 'Idempotency key does not match lifecycle.finishAttemptId',
    };
  }
  return {
    ok: true,
    key: headerKey || payloadKey,
  };
}

function getIngestSuccessStatus(existingSession) {
  return existingSession ? 200 : 201;
}

function resolveExistingFinish(existingKey, incomingKey) {
  const stored = existingKey ? String(existingKey) : null;
  const incoming = incomingKey ? String(incomingKey) : null;
  if (!stored) {
    return {
      action: 'conflict',
      status: 409,
      error: 'Completed session is sealed and has no replay idempotency key',
    };
  }
  if (stored !== incoming) {
    return {
      action: 'conflict',
      status: 409,
      error: 'Session was already completed with a different idempotency key',
    };
  }
  return { action: 'replay' };
}

function requireFinishIdempotencyKey(lifecycle, key) {
  if (lifecycle && lifecycle.status === 'completed' && !key) {
    return {
      ok: false,
      status: 400,
      error: 'Completed lifecycle requires finishAttemptId or Idempotency-Key',
    };
  }
  return { ok: true };
}

module.exports = {
  resolveIdempotencyKey,
  getIngestSuccessStatus,
  resolveExistingFinish,
  requireFinishIdempotencyKey,
};
