class HttpError extends Error {
  constructor(status, message, code, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code || 'request_failed';
    this.details = details;
  }
}

module.exports = { HttpError };
