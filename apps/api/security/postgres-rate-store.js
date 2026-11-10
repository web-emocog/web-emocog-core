const { createHmac } = require('node:crypto');
const { HttpError } = require('./http-error');
const { logUnexpectedError } = require('./error-log');

class PostgresRateStore {
  constructor(queryable, secret, options = {}) {
    if (!queryable?.query || typeof secret !== 'string' || secret.length < 32) throw new Error('Invalid shared limiter configuration');
    this.queryable = queryable;
    this.secret = secret;
    this.localKeys = false;
    this.windowMs = options.windowMs || 60_000;
    this.now = options.now || Date.now;
    this.nextCleanup = 0;
    this.nextErrorLog = 0;
  }

  init(options) {
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1000 || options.windowMs > 3_600_000) {
      throw new Error('Invalid shared limiter window');
    }
    this.windowMs = options.windowMs;
  }

  digest(key) {
    if (typeof key !== 'string' || key.length > 512) throw new Error('Invalid limiter key');
    return createHmac('sha256', this.secret).update('http-rate.v1\0').update(key).digest('hex');
  }

  async query(sql, values) {
    try { return await this.queryable.query(sql, values); }
    catch (error) {
      if (this.now() >= this.nextErrorLog) {
        this.nextErrorLog = this.now() + 30_000;
        logUnexpectedError(error, 'rate-limit');
      }
      throw new HttpError(503, 'Request protection is temporarily unavailable', 'rate_limit_store_unavailable');
    }
  }

  async increment(key) {
    // All API instances use the database clock and one atomic row update.
    const result = await this.query(`INSERT INTO http_rate_windows(key_hash, hits, expires_at)
      VALUES($1, 1, clock_timestamp() + $2 * interval '1 millisecond')
      ON CONFLICT(key_hash) DO UPDATE SET
        hits = CASE WHEN http_rate_windows.expires_at <= clock_timestamp() THEN 1 ELSE http_rate_windows.hits + 1 END,
        expires_at = CASE WHEN http_rate_windows.expires_at <= clock_timestamp()
          THEN clock_timestamp() + $2 * interval '1 millisecond' ELSE http_rate_windows.expires_at END
      RETURNING hits, expires_at`, [this.digest(key), this.windowMs]);
    const totalHits = Number(result.rows[0]?.hits);
    const resetTime = new Date(result.rows[0]?.expires_at);
    if (!Number.isSafeInteger(totalHits) || totalHits < 1 || !Number.isFinite(resetTime.getTime())) {
      throw new HttpError(503, 'Request protection is temporarily unavailable', 'rate_limit_store_unavailable');
    }
    if (this.now() >= this.nextCleanup) {
      this.nextCleanup = this.now() + 60_000;
      // Keep cleanup bounded and outside the count operation; no background timers.
      void this.query(`DELETE FROM http_rate_windows WHERE expires_at < clock_timestamp() - interval '1 minute' AND key_hash IN
        (SELECT key_hash FROM http_rate_windows WHERE expires_at < clock_timestamp() - interval '1 minute'
          ORDER BY expires_at LIMIT 1000)`, []).catch(() => {});
    }
    return { totalHits, resetTime };
  }

  async decrement(key) {
    await this.query('UPDATE http_rate_windows SET hits = GREATEST(0, hits - 1) WHERE key_hash = $1', [this.digest(key)]);
  }

  async resetKey(key) {
    await this.query('DELETE FROM http_rate_windows WHERE key_hash = $1', [this.digest(key)]);
  }

  async get(key) {
    const result = await this.query(`SELECT hits, expires_at FROM http_rate_windows
      WHERE key_hash = $1 AND expires_at > clock_timestamp()`, [this.digest(key)]);
    if (!result.rows[0]) return undefined;
    return { totalHits: Number(result.rows[0].hits), resetTime: new Date(result.rows[0].expires_at) };
  }
}

module.exports = { PostgresRateStore };
