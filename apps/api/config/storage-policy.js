const MiB = 1024 * 1024;

function readStoragePolicy(env = process.env) {
  const positive = (name, fallback, max = Number.MAX_SAFE_INTEGER) => {
    if (env[name] === undefined || env[name] === '') return fallback;
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
      throw new Error(`${name} must be a positive safe integer no greater than ${max}`);
    }
    return value;
  };
  return Object.freeze({
    organizationBytes: positive('MEDIA_ORGANIZATION_QUOTA_BYTES', 10 * 1024 * MiB),
    maxUserUploads: positive('MEDIA_MAX_USER_UPLOADS', 2, 32),
    maxActiveUploads: positive('MEDIA_MAX_ACTIVE_UPLOADS', 8, 128),
    minFreeBytes: positive('MEDIA_MIN_FREE_BYTES', 1024 * MiB),
    conversionWorkingBytes: positive('MEDIA_CONVERSION_WORKING_BYTES', 768 * MiB),
    reservationTtlMs: positive('MEDIA_RESERVATION_TTL_MS', 15 * 60 * 1000, 24 * 60 * 60 * 1000),
    previewBytes: 2 * MiB,
    conversionOutputBytes: 256 * MiB,
  });
}

module.exports = { readStoragePolicy };
